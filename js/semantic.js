// Moteur sémantique côté navigateur : pilote le Web Worker, change de modèle à chaud,
// met en cache l'index des enseignes (un par modèle) et calcule la carte passion la plus adaptée.
import { normalize } from './keyword.js';
import { MODEL_BY_ID, DEFAULT_MODEL, LOCAL_MODELS, isApi } from './models.js';
import { GeminiEmbedder, getGeminiKey } from './gemini.js';
import { idbGet, idbSet, idbKeys } from './idb.js';

const params = new URLSearchParams(location.search);
export const DEVICE = params.get('device') || 'wasm';

const b64 = {
  enc(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str) { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; },
};
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function initialModelId() {
  const fromUrl = params.get('model');
  if (fromUrl && MODEL_BY_ID[fromUrl]) return fromUrl;
  try { const saved = localStorage.getItem('gc-model'); if (saved && MODEL_BY_ID[saved]) return saved; } catch { /* ignore */ }
  return DEFAULT_MODEL;
}

export class SemanticEngine extends EventTarget {
  constructor(enseignes, passions) {
    super();
    this.enseignes = enseignes;
    this.passions = passions;
    this.bySlug = Object.fromEntries(passions.map((p) => [p.slug, p]));
    this.pending = new Map();
    this.seq = 0;
    this.modelId = null;      // modèle demandé
    this.ready = false;       // modèle demandé chargé et indexé
    this.statsByModel = {};   // statistiques par modèle
    this.cacheMap = {};       // modèle déjà présent dans le cache du navigateur ?
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    this.worker.onerror = (e) => this.#fail(new Error(e.message || 'Erreur du Web Worker'));
    this.worker.postMessage({ type: 'cache-check', models: LOCAL_MODELS });
    this.idxKeys = new Set();   // index d'enseignes présents dans IndexedDB
    this.keysReady = this.#loadKeys();
  }

  /** Liste les index en cache (IndexedDB) et migre ceux d'anciennes versions stockés dans localStorage. */
  async #loadKeys() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith('gc-semantic-index:') || k.endsWith(':partial')) continue;
        try {
          const o = JSON.parse(localStorage.getItem(k));
          await idbSet(k, { dim: o.dim, v: new Float32Array(b64.dec(o.v)), ms: o.ms, waitMs: o.waitMs, at: o.at });
        } catch { /* entrée illisible : ignorée */ }
        localStorage.removeItem(k);
      }
    } catch { /* localStorage indisponible */ }
    (await idbKeys()).forEach((k) => this.idxKeys.add(String(k)));
    this.#emit('cache', this.cacheMap);
  }
  #putIndex(key, entry) { this.idxKeys.add(key); return idbSet(key, entry); }

  get model() { return MODEL_BY_ID[this.modelId]; }
  get stats() { return this.statsByModel[this.modelId] || {}; }
  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  #st(id) { return (this.statsByModel[id] ||= { modelMs: 0, modelBytes: 0, fromCache: false, indexMs: 0, indexCached: false, dim: 0 }); }

  docText(e, m) {
    const univers = e.passions.map((p) => this.bySlug[p].label).join(', ');
    return `${m.passage}${e.name}. ${e.desc} Univers : ${univers}. ${e.tags.join(', ')}.`;
  }
  passionText(p, m) {
    return `${m.passage}Carte cadeau ${p.label} : ${p.tagline} ${p.covers.join(', ')}.`;
  }

  /** Textes indexés pour un modèle (préfixes compris) et clé de l'index en cache. */
  indexKey(m) {
    const texts = [...this.enseignes.map((e) => this.docText(e, m)), ...this.passions.map((p) => this.passionText(p, m))];
    const k = isApi(m) ? `gc-semantic-index:${m.apiModel}:${m.dims}:${hash(texts.join('|'))}` : `gc-semantic-index:${m.repo}:${m.dtype}:${hash(texts.join('|'))}`;
    return { key: k, count: texts.length };
  }
  isIndexCached(m) { return this.idxKeys.has(this.indexKey(m).key); }
  partialIndex(m) { try { const p = JSON.parse(localStorage.getItem(`${this.indexKey(m).key}:partial`) || 'null'); return p ? p.done : 0; } catch { return 0; } }

  /**
   * Charge (si besoin) puis active un modèle. Résout quand il est prêt à chercher.
   * opts.cold : ignore l'index en cache et le recalcule, pour mesurer le temps d'indexation réel.
   */
  use(id, opts = {}) {
    const m = MODEL_BY_ID[id];
    if (!m) return Promise.reject(new Error(`Modèle inconnu : ${id}`));
    this.forceIndex = !!opts.cold;
    if (id === this.modelId && this.ready && !opts.cold) return Promise.resolve(this.stats);
    if (id === this.modelId && this.loading) return this.loading.promise;
    if (this.loading) this.loading.reject(Object.assign(new Error('Changement de modèle'), { superseded: true }));
    this.modelId = id; this.ready = false;
    try { localStorage.setItem('gc-model', id); } catch { /* ignore */ }
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.catch(() => {});
    this.loading = { id, promise, resolve, reject, t0: performance.now() };
    this.#emit('switching', { model: m });
    if (isApi(m)) this.#useApi(m);
    else this.worker.postMessage({ type: 'load', cfg: m, device: DEVICE });
    return promise;
  }

  /** Modèle distant (API Gemini) : rien à télécharger, l'index est calculé par l'API puis mis en cache. */
  async #useApi(m) {
    const still = () => this.loading && this.loading.id === m.id;
    const key = getGeminiKey();
    if (!key) { this.#fail(Object.assign(new Error('clé API Gemini manquante'), { code: 'NO_KEY' }), m.id); return; }
    const st = this.#st(m.id);
    Object.assign(st, { modelMs: 0, modelBytes: 0, fromCache: true, loadSource: 'api' });
    this.api = { id: m.id, embedder: new GeminiEmbedder(m, key) };
    this.#emit('model-ready', { model: m });
    const texts = [...this.enseignes.map((e) => this.docText(e, m)), ...this.passions.map((p) => this.passionText(p, m))];
    const idxKey = `gc-semantic-index:${m.apiModel}:${m.dims}:${hash(texts.join('|'))}`;
    const t0 = performance.now();
    try {
      let vecs = null; let cached = null;
      if (!this.forceIndex) { await this.keysReady; cached = (await idbGet(idxKey)) || null; }
      let measured;
      let waitMs = 0; let resumedFrom = 0;
      if (cached) { vecs = cached.v; measured = cached.ms; waitMs = cached.waitMs || 0; }
      else {
        // Reprise d'une indexation interrompue (quota) : les textes déjà vectorisés ne sont pas renvoyés à Google.
        const partialKey = `${idxKey}:partial`;
        let resume = null;
        if (!this.forceIndex) { try { const p = JSON.parse(localStorage.getItem(partialKey) || 'null'); if (p) resume = { done: p.done, data: new Float32Array(b64.dec(p.v)) }; } catch { resume = null; } }
        else { try { localStorage.removeItem(partialKey); } catch { /* ignore */ } }
        const r = await this.api.embedder.embedMany(texts, 'RETRIEVAL_DOCUMENT', {
          resume,
          onProgress: (done, total) => { if (still()) this.#emit('index-progress', { done, total, model: m }); },
          onWait: (sec, why) => { if (still()) this.#emit('api-wait', { model: m, sec, why, phase: 'index' }); },
          onChunk: (done, data) => { try { localStorage.setItem(partialKey, JSON.stringify({ done, v: b64.enc(data.slice().buffer) })); } catch { /* quota */ } },
        });
        vecs = r.data; waitMs = r.waitMs; resumedFrom = r.resumedFrom;
        measured = performance.now() - t0 - waitMs; // temps de calcul hors attente de quota
        try { localStorage.removeItem(partialKey); } catch { /* ignore */ }
        await this.#putIndex(idxKey, { dim: m.dims, v: vecs, ms: resumedFrom ? null : measured, waitMs: resumedFrom ? 0 : waitMs, at: Date.now() });
      }
      this.forceIndex = false;
      if (!still()) return;
      Object.assign(this.api, { index: vecs, dim: m.dims, count: texts.length });
      // Après une reprise, le temps mesuré ne couvre qu'une partie de l'index : on ne l'affiche pas comme un temps complet.
      Object.assign(st, { dim: m.dims, indexMs: cached ? 0 : measured, indexMeasuredMs: resumedFrom ? null : measured, indexWaitMs: waitMs, indexResumed: !!resumedFrom || (cached && cached.ms == null), indexCount: texts.length, indexCached: !!cached, readyMs: performance.now() - this.loading.t0 });
      const l = this.loading; this.loading = null; this.ready = true;
      l.resolve(st);
      this.#emit('ready', { ...st, model: m });
    } catch (err) {
      if (still()) this.#fail(err, m.id);
    }
  }

  #fail(err, id) {
    if (this.loading && (!id || id === this.loading.id)) {
      const l = this.loading; this.loading = null;
      l.reject(err);
      this.#emit('error', { message: err.message, model: MODEL_BY_ID[l.id] });
    } else this.#emit('error', { message: err.message });
  }

  #onMessage(m) {
    const target = this.loading && this.loading.id;
    switch (m.type) {
      case 'cache-map': this.cacheMap = { ...this.cacheMap, ...m.map }; this.#emit('cache', this.cacheMap); break;
      case 'cache-status': if (m.id === target) this.#st(m.id).fromCache = m.fromCache; break;
      case 'progress': if (m.id === target) this.#emit('progress', { ...m, model: MODEL_BY_ID[m.id] }); break;
      case 'loaded':
        if (m.id !== target) break;
        if (m.inMemory) this.#st(m.id).loadSource = 'memory'; // modèle déjà chargé : on garde le temps mesuré au 1er chargement
        else Object.assign(this.#st(m.id), { modelMs: m.ms, modelBytes: m.bytes || this.#st(m.id).modelBytes, fromCache: m.fromCache, loadSource: m.fromCache ? 'cache' : 'download' });
        this.cacheMap[m.id] = true; this.#emit('cache', this.cacheMap);
        this.#emit('model-ready', { model: MODEL_BY_ID[m.id] });
        this.#index(MODEL_BY_ID[m.id]);
        break;
      case 'index-progress': if (m.id === target) this.#emit('index-progress', { ...m, model: MODEL_BY_ID[m.id] }); break;
      case 'indexed': {
        if (m.id !== target) break;
        const st = this.#st(m.id);
        Object.assign(st, { dim: m.dim, indexMs: m.ms, indexCached: !!m.cached, indexCount: m.count, indexMeasuredMs: m.cached ? this.cachedIndexMs : m.ms });
        if (m.vectors) this.#putIndex(this.cacheKey, { dim: m.dim, v: new Float32Array(m.vectors), ms: m.ms, at: Date.now() });
        st.readyMs = performance.now() - this.loading.t0;
        const l = this.loading; this.loading = null; this.ready = true;
        l.resolve(st);
        this.#emit('ready', { ...st, model: MODEL_BY_ID[m.id] });
        break;
      }
      case 'results': { const p = this.pending.get(m.id); this.pending.delete(m.id); if (p) p.resolve(m); break; }
      case 'error': {
        const p = m.id != null && this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); p.reject(new Error(m.message)); }
        else this.#fail(new Error(m.message), m.model);
        break;
      }
      default: break;
    }
  }

  async #index(model) {
    this.texts = [...this.enseignes.map((e) => this.docText(e, model)), ...this.passions.map((p) => this.passionText(p, model))];
    const key = `gc-semantic-index:${model.repo}:${model.dtype}:${hash(this.texts.join('|'))}`;
    this.cacheKey = key;
    let cached = null;
    const force = this.forceIndex;
    this.forceIndex = false;
    if (!force) { await this.keysReady; cached = (await idbGet(key)) || null; }
    if (!this.loading || this.loading.id !== model.id) return; // changement de modèle pendant la lecture du cache
    this.cachedIndexMs = cached ? cached.ms : undefined; // temps mesuré lors du calcul initial de cet index
    if (cached) this.worker.postMessage({ type: 'set-index', dim: cached.dim, vectors: cached.v.buffer.slice(0) });
    else this.worker.postMessage({ type: 'index', texts: this.texts });
  }

  async search(query, k = 8) {
    if (!this.ready) throw new Error('Modèle en cours de chargement');
    const model = this.model;
    const t0 = performance.now();
    let m;
    if (isApi(model)) {
      // La requête part vers l'API Google ; la comparaison avec l'index reste locale.
      const { embedder, index, dim, count } = this.api;
      const { vec: qv, waitMs } = await embedder.embedOne(model.query + query, 'RETRIEVAL_QUERY', (sec, why) => this.#emit('api-wait', { model, sec, why, phase: 'search' }));
      const t1 = performance.now();
      const sc = new Float32Array(count);
      for (let i = 0; i < count; i++) { let s = 0; const o = i * dim; for (let j = 0; j < dim; j++) s += qv[j] * index[o + j]; sc[i] = s; }
      m = { scores: sc.buffer, embedMs: t1 - t0 - waitMs, rankMs: performance.now() - t1, waitMs };
    } else {
      const id = ++this.seq;
      m = await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage({ type: 'search', id, query: model.query + query });
      });
    }
    const scores = new Float32Array(m.scores);
    const nE = this.enseignes.length;
    const qn = ` ${normalize(query)} `;

    // Score hybride : similarité sémantique + léger bonus si le nom de l'enseigne est cité.
    const ranked = this.enseignes.map((e, i) => {
      const nameHit = normalize(e.name).length >= 3 && qn.includes(` ${normalize(e.name)} `);
      return { item: e, sim: scores[i], score: scores[i] + (nameHit ? 0.08 : 0), nameHit };
    }).sort((a, b) => b.score - a.score);

    // Carte passion : similarité avec la description de la carte + force des meilleures enseignes de l'univers.
    const passions = this.passions.map((p, j) => {
      const inP = ranked.filter((r) => r.item.passions.includes(p.slug)).slice(0, 3);
      const avg = inP.reduce((s, r) => s + r.score, 0) / Math.max(inP.length, 1);
      return { passion: p, score: 0.5 * scores[nE + j] + 0.5 * avg, top: inP.map((r) => r.item) };
    }).sort((a, b) => b.score - a.score);

    // Référence pour l'affichage d'une pertinence relative (médiane des similarités).
    const sorted = Array.from(scores.subarray(0, nE)).sort((a, b) => a - b);
    const floor = sorted[Math.floor(nE / 2)];

    return {
      model,
      results: ranked.slice(0, k),
      floor,
      passions: passions.slice(0, 3),
      embedMs: m.embedMs, rankMs: m.rankMs, waitMs: m.waitMs || 0,
      totalMs: performance.now() - t0 - (m.waitMs || 0), // temps de réponse hors attente de quota
    };
  }
}
