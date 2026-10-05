// Web Worker : exécute le modèle d'embeddings dans le navigateur (transformers.js).
// Aucune donnée de recherche ne quitte l'appareil : seuls les fichiers du modèle
// sont téléchargés une fois (puis servis depuis le cache du navigateur).
// Un seul modèle est gardé en mémoire à la fois ; changer de modèle libère le précédent.
import { pipeline, AutoModel, AutoTokenizer, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';

env.allowLocalModels = false;   // modèles servis par le Hub Hugging Face
env.useBrowserCache = true;     // cache persistant (Cache API) après le 1er chargement

let current = null; // { id, embed(texts) -> {data, dims}, dispose(), index, dim, count }
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

function normalizeRows(data, n, d) {
  for (let i = 0; i < n; i++) {
    let s = 0; const o = i * d;
    for (let j = 0; j < d; j++) s += data[o + j] * data[o + j];
    s = Math.sqrt(s) || 1;
    for (let j = 0; j < d; j++) data[o + j] /= s;
  }
  return data;
}

async function isCached(repo) {
  try {
    const cache = await caches.open(env.cacheKey || 'transformers-cache');
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(`/${repo}/`) && /\.onnx(_data)?$/.test(r.url));
  } catch { return false; }
}

async function load(cfg, device) {
  if (current && current.id === cfg.id) {
    post({ type: 'loaded', id: cfg.id, ms: 0, bytes: current.bytes, fromCache: true, inMemory: true });
    return;
  }
  if (current) { try { await current.dispose(); } catch { /* ignore */ } current = null; }

  const t0 = performance.now();
  const fromCache = await isCached(cfg.repo);
  post({ type: 'cache-status', id: cfg.id, fromCache });
  const files = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.file) {
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      let loaded = 0, total = 0;
      for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
      post({ type: 'progress', id: cfg.id, loaded, total, fromCache });
    }
  };
  const opts = { dtype: cfg.dtype, device, progress_callback };

  let embed, dispose;
  if (cfg.mode === 'sentence_embedding') {
    const tokenizer = await AutoTokenizer.from_pretrained(cfg.repo, { progress_callback });
    const model = await AutoModel.from_pretrained(cfg.repo, opts);
    embed = async (texts) => {
      const inputs = await tokenizer(texts, { padding: true, truncation: true });
      const { sentence_embedding } = await model(inputs);
      const [n, d] = sentence_embedding.dims;
      return { data: normalizeRows(Float32Array.from(sentence_embedding.data), n, d), dims: [n, d] };
    };
    dispose = () => model.dispose();
  } else {
    const extractor = await pipeline('feature-extraction', cfg.repo, opts);
    embed = async (texts) => {
      const out = await extractor(texts, { pooling: cfg.pooling || 'mean', normalize: true });
      return { data: out.data, dims: out.dims };
    };
    dispose = () => extractor.dispose();
  }
  let bytes = 0;
  for (const f of Object.values(files)) bytes += f.total;
  current = { id: cfg.id, embed, dispose, bytes, index: null, dim: 0, count: 0 };
  post({ type: 'loaded', id: cfg.id, ms: performance.now() - t0, bytes, fromCache });
}

async function handle(data) {
  try {
    if (['index', 'set-index', 'search'].includes(data.type) && !current) throw new Error('Aucun modèle chargé');
    if (data.type === 'cache-check') {
      const res = {};
      for (const m of data.models) res[m.id] = await isCached(m.repo);
      post({ type: 'cache-map', map: res });
    }

    else if (data.type === 'load') await load(data.cfg, data.device);

    else if (data.type === 'index') {
      const t0 = performance.now();
      const { texts } = data;
      const batch = 8;
      let vecs = null, dim = 0;
      for (let i = 0; i < texts.length; i += batch) {
        const t = await current.embed(texts.slice(i, i + batch));
        const [n, d] = t.dims;
        if (!vecs) { dim = d; vecs = new Float32Array(texts.length * d); }
        vecs.set(t.data, i * d);
        post({ type: 'index-progress', id: current.id, done: Math.min(i + n, texts.length), total: texts.length });
      }
      Object.assign(current, { index: vecs, dim, count: texts.length });
      const copy = vecs.slice();
      post({ type: 'indexed', id: current.id, ms: performance.now() - t0, dim, count: texts.length, vectors: copy.buffer }, [copy.buffer]);
    }

    else if (data.type === 'set-index') {
      const index = new Float32Array(data.vectors);
      Object.assign(current, { index, dim: data.dim, count: index.length / data.dim });
      post({ type: 'indexed', id: current.id, ms: 0, dim: data.dim, count: current.count, cached: true });
    }

    else if (data.type === 'search') {
      const t0 = performance.now();
      const q = await current.embed([data.query]);
      const t1 = performance.now();
      const qv = q.data; const { index, dim, count } = current;
      const scores = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        let s = 0; const off = i * dim;
        for (let j = 0; j < dim; j++) s += qv[j] * index[off + j];
        scores[i] = s;
      }
      post({ type: 'results', id: data.id, model: current.id, scores: scores.buffer, embedMs: t1 - t0, rankMs: performance.now() - t1 }, [scores.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: data.id, req: data.type, model: data.cfg && data.cfg.id, message: String((err && err.message) || err) });
  }
}

// Les messages sont traités dans l'ordre : un changement de modèle ne se mélange jamais à une recherche.
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
