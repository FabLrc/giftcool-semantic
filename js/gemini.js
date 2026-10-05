// Accès à l'API Gemini Embedding (Google) depuis le navigateur, avec la clé de l'utilisateur.
// Contrairement aux modèles locaux, le texte de la requête est envoyé aux serveurs de Google.
//
// Quotas : avec une clé gratuite, Google limite les embeddings à ~100 requêtes par minute et ~1 000 par jour
// (par projet et par modèle). Dans un appel groupé (batchEmbedContents), CHAQUE texte compte comme une requête :
// indexer 279 textes d'un coup dépasse donc la limite à la minute. Le code ci-dessous :
//   - régule le débit côté navigateur (fenêtre glissante d'une minute),
//   - lit le délai conseillé par Google dans les erreurs 429 (RetryInfo.retryDelay),
//   - permet de reprendre une indexation interrompue sans repayer les textes déjà vectorisés,
//   - s'arrête net si c'est le quota JOURNALIER qui est épuisé (inutile d'attendre).
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_STORAGE = 'gc-gemini-key';
const TIER_STORAGE = 'gc-gemini-tier';

export const TIERS = {
  free: { label: 'Gratuite', perMinute: 90, perDay: 1000, batch: 30 },   // marge sous les 100/min annoncés
  paid: { label: 'Facturation activée', perMinute: 2500, perDay: Infinity, batch: 100 },
};
const params = new URLSearchParams(location.search);
const WINDOW_MS = Number(params.get('quotaWindow')) || 60000; // paramètre de test uniquement

export function getGeminiKey() { try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; } }
export function setGeminiKey(k) { try { if (k) localStorage.setItem(KEY_STORAGE, k); else localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ } }
export function getGeminiTier() { try { return localStorage.getItem(TIER_STORAGE) === 'paid' ? 'paid' : 'free'; } catch { return 'free'; } }
export function setGeminiTier(t) { try { localStorage.setItem(TIER_STORAGE, t === 'paid' ? 'paid' : 'free'); } catch { /* ignore */ } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fenêtre glissante : au plus `limit` textes envoyés par minute, par modèle. Partagée entre index et recherches. */
class Limiter {
  constructor() { this.log = []; } // [{ t, n }]
  used(now) { this.log = this.log.filter((e) => now - e.t < WINDOW_MS); return this.log.reduce((s, e) => s + e.n, 0); }
  async take(n, limit, onWait) {
    let waited = 0;
    for (;;) {
      const now = Date.now();
      if (this.used(now) + n <= limit || !this.log.length) { this.log.push({ t: now, n }); return waited; }
      // Attendre que les envois les plus anciens sortent de la fenêtre.
      let acc = this.used(now) + n - limit; let until = now;
      for (const e of this.log) { until = e.t + WINDOW_MS; acc -= e.n; if (acc <= 0) break; }
      const ms = Math.max(200, until - now + 50);
      if (onWait) onWait(Math.ceil(ms / 1000), 'pace');
      await sleep(Math.min(ms, 1000)); waited += Math.min(ms, 1000);
    }
  }
  /** Après un 429 : considérer la fenêtre comme pleine jusqu'à `ms`. */
  block(ms, limit) { this.log = [{ t: Date.now() - WINDOW_MS + ms, n: limit }]; }
}
const limiters = {};

export class QuotaError extends Error {}

function parseRetry(j) {
  const det = (j && j.error && j.error.details) || [];
  const ri = det.find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const s = ri && parseFloat(String(ri.retryDelay || '').replace('s', ''));
  const daily = det.some((d) => (d.violations || []).some((v) => /PerDay|per_day/i.test(`${v.quotaId || ''} ${v.quotaMetric || ''}`)))
    || /per day|perday|daily/i.test((j && j.error && j.error.message) || '');
  return { retryMs: s ? s * 1000 : null, daily };
}

export class GeminiEmbedder {
  constructor(cfg, key, tier = getGeminiTier()) {
    this.cfg = cfg; this.key = key; this.tier = TIERS[tier] || TIERS.free;
    this.limiter = (limiters[cfg.apiModel] ||= new Limiter());
  }

  request(text, taskType) {
    const r = { model: `models/${this.cfg.apiModel}`, content: { parts: [{ text }] }, outputDimensionality: this.cfg.dims };
    if (this.cfg.taskTypes && taskType) r.taskType = taskType;
    return r;
  }

  /** Un appel HTTP, avec régulation et réessais. Renvoie { json, waitMs }. */
  async call(method, body, n, onWait) {
    let waitMs = await this.limiter.take(n, this.tier.perMinute, onWait);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}/${this.cfg.apiModel}:${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify(body),
      });
      if (res.ok) return { json: await res.json(), waitMs };
      let j = null; try { j = await res.json(); } catch { /* ignore */ }
      const msg = (j && j.error && j.error.message) || `HTTP ${res.status}`;
      if (res.status === 429) {
        const { retryMs, daily } = parseRetry(j);
        if (daily) throw new QuotaError('quota journalier gratuit de Google épuisé (≈ 1 000 requêtes/jour) : réessayez demain ou activez la facturation sur la clé');
        if (attempt >= 6) throw new QuotaError('quota Google dépassé de façon répétée (429) : réessayez dans quelques minutes');
        const ms = Math.min(retryMs || WINDOW_MS, 2 * WINDOW_MS) + Math.random() * 1000;
        this.limiter.block(ms, this.tier.perMinute);
        for (let left = ms; left > 0; left -= 1000) { if (onWait) onWait(Math.ceil(left / 1000), '429'); await sleep(Math.min(1000, left)); }
        waitMs += ms;
        continue;
      }
      if (res.status >= 500 && attempt < 4) { await sleep(1000 * 2 ** attempt); waitMs += 1000 * 2 ** attempt; continue; }
      if (res.status === 400 && /api key/i.test(msg)) throw new Error('clé API invalide');
      if (res.status === 403) throw new Error(`accès refusé (${msg})`);
      throw new Error(msg);
    }
  }

  /** Vectorise une requête. Renvoie { vec, waitMs }. */
  async embedOne(text, taskType, onWait) {
    const { json, waitMs } = await this.call('embedContent', this.request(text, taskType), 1, onWait);
    const vec = new Float32Array(this.cfg.dims);
    normalizeInto(vec, 0, json.embedding.values);
    return { vec, waitMs };
  }

  /**
   * Vectorise beaucoup de textes par lots, en respectant le quota.
   * `resume` : { done, data } d'une indexation interrompue ; `onChunk(done, data)` permet de sauvegarder l'avancement.
   */
  async embedMany(texts, taskType, { onProgress, onWait, onChunk, resume } = {}) {
    const d = this.cfg.dims;
    const out = new Float32Array(texts.length * d);
    let start = 0;
    if (resume && resume.done > 0 && resume.data && resume.data.length === resume.done * d) { out.set(resume.data, 0); start = resume.done; }
    let waitMs = 0;
    const size = Math.min(this.tier.batch, this.tier.perMinute);
    for (let i = start; i < texts.length; i += size) {
      const chunk = texts.slice(i, i + size);
      const r = await this.call('batchEmbedContents', { requests: chunk.map((t) => this.request(t, taskType)) }, chunk.length, onWait);
      waitMs += r.waitMs;
      r.json.embeddings.forEach((e, k) => normalizeInto(out, (i + k) * d, e.values));
      const done = Math.min(i + chunk.length, texts.length);
      if (onChunk) onChunk(done, out.subarray(0, done * d));
      if (onProgress) onProgress(done, texts.length);
    }
    return { data: out, waitMs, resumedFrom: start };
  }
}

function normalizeInto(out, offset, values) {
  let s = 0; for (const v of values) s += v * v;
  s = Math.sqrt(s) || 1;
  for (let j = 0; j < values.length; j++) out[offset + j] = values[j] / s;
}
