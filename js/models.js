// Registre des modèles d'embeddings proposés dans le sélecteur.
// Pour en ajouter un : un objet de plus ici (modèle compatible transformers.js sur le Hub Hugging Face).
//   mode 'pipeline'           → pipeline('feature-extraction') + pooling `pooling` ('mean' par défaut, 'cls' pour Granite)
//   mode 'sentence_embedding' → AutoModel, sortie `sentence_embedding` (EmbeddingGemma, Harrier…)
// `released` : date de sortie publique (AAAA-MM). `mteb` : score MTEB Multilingual Retrieval publié (indicatif).
export const MODELS = [
  {
    id: 'e5-small',
    repo: 'Xenova/multilingual-e5-small',
    label: 'E5 Small',
    vendor: 'Microsoft · multilingue',
    released: '2023-06',
    tagline: 'Référence historique, rapide et léger',
    params: '118 M',
    sizeMb: 118,
    dims: 384,
    dtype: 'q8',
    mode: 'pipeline',
    query: 'query: ',
    passage: 'passage: ',
    mteb: 50.9,
    color: '#6C3BF5',
  },
  {
    id: 'e5-base',
    repo: 'Xenova/multilingual-e5-base',
    label: 'E5 Base',
    vendor: 'Microsoft · multilingue',
    released: '2023-06',
    tagline: 'Même famille, plus lourd',
    params: '278 M',
    sizeMb: 279,
    dims: 768,
    dtype: 'q8',
    mode: 'pipeline',
    query: 'query: ',
    passage: 'passage: ',
    mteb: 52.7,
    color: '#E07A00',
  },
  {
    id: 'gemma',
    repo: 'onnx-community/embeddinggemma-300m-ONNX',
    label: 'EmbeddingGemma',
    vendor: 'Google · 100+ langues',
    released: '2025-09',
    tagline: 'Version ouverte de Gemini Embedding',
    params: '308 M',
    sizeMb: 309,
    dims: 768,
    dtype: 'q8',          // fp16 non supporté par ce modèle ; 'q4' (~197 Mo) possible
    mode: 'sentence_embedding',
    query: 'task: search result | query: ',
    passage: 'title: none | text: ',
    mteb: 62.5,
    color: '#0E9C9C',
  },
  {
    id: 'granite-97m',
    repo: 'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
    label: 'Granite 97M R2',
    vendor: 'IBM · 200+ langues',
    released: '2026-05',
    tagline: 'Le plus léger, presque au niveau de Gemma',
    params: '97 M',
    sizeMb: 98,
    dims: 384,
    dtype: 'q8',
    mode: 'pipeline',
    pooling: 'cls',       // Granite R2 : pooling CLS, pas de préfixe
    query: '',
    passage: '',
    mteb: 60.3,
    color: '#5A9E1A',
  },
  {
    id: 'granite-311m',
    repo: 'onnx-community/granite-embedding-311m-multilingual-r2-ONNX',
    label: 'Granite 311M R2',
    vendor: 'IBM · 200+ langues',
    released: '2026-05',
    tagline: 'Très précis, licence Apache 2.0',
    params: '311 M',
    sizeMb: 313,
    dims: 768,
    dtype: 'q8',
    mode: 'pipeline',
    pooling: 'cls',
    query: '',
    passage: '',
    mteb: 65.2,
    color: '#9A5B2E',
  },
  {
    id: 'harrier',
    repo: 'onnx-community/harrier-oss-v1-270m-ONNX',
    label: 'Harrier 270M',
    vendor: 'Microsoft · multilingue',
    released: '2026-03',
    tagline: 'Le plus précis de sa taille (MTEB)',
    params: '270 M',
    sizeMb: 344,
    dims: 640,
    dtype: 'q8',          // 'q4' (~205 Mo) possible
    mode: 'sentence_embedding',   // pooling sur le dernier jeton, sortie `sentence_embedding`
    query: 'Instruct: Given a gift request describing a person, retrieve the stores that best match it\nQuery: ',
    passage: '',          // les documents n'ont pas d'instruction
    mteb: 66.4,
    color: '#B23A9C',
  },
  // --- Modèles fermés, accessibles uniquement par API (clé Google requise, la requête quitte le navigateur) ---
  {
    id: 'gemini-001',
    provider: 'gemini-api',
    apiModel: 'gemini-embedding-001',
    label: 'Gemini Embedding',
    vendor: 'Google · API cloud',
    released: '2025-07',
    tagline: 'Le modèle « professeur » d\'EmbeddingGemma',
    params: 'non publié',
    sizeMb: 0,
    dims: 768,           // 128 à 3072 possibles (Matryoshka)
    taskTypes: true,     // RETRIEVAL_QUERY / RETRIEVAL_DOCUMENT
    query: '',
    passage: '',
    color: '#2D6FE0',
  },
  {
    id: 'gemini-2',
    provider: 'gemini-api',
    apiModel: 'gemini-embedding-2',
    label: 'Gemini Embedding 2',
    vendor: 'Google · API cloud',
    released: '2026-03',
    tagline: 'Dernière génération, multimodale',
    params: 'non publié',
    sizeMb: 0,
    dims: 768,
    taskTypes: false,    // la tâche se précise par un préfixe dans le texte
    query: 'task: search result | query: ',
    passage: 'title: none | text: ',
    color: '#D6336C',
  },
];

export const isApi = (m) => m.provider === 'gemini-api';
export const LOCAL_MODELS = MODELS.filter((m) => !isApi(m));

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** « mai 2026 » à partir de « 2026-05 ». */
export const releaseLabel = (m) => { if (!m.released) return ''; const [y, mo] = m.released.split('-'); return `${MOIS[Number(mo) - 1]} ${y}`; };
export const releaseYear = (m) => (m.released ? m.released.slice(0, 4) : '');

export const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));
export const DEFAULT_MODEL = 'e5-small';
