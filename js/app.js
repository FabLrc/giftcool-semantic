import { KeywordIndex, tokenize } from './keyword.js';
import { SemanticEngine, DEVICE, initialModelId } from './semantic.js';
import { MODELS, MODEL_BY_ID, DEFAULT_MODEL, isApi, releaseLabel, releaseYear } from './models.js';
import { getGeminiKey, setGeminiKey, getGeminiTier, setGeminiTier, TIERS } from './gemini.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMs = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms >= 60000) return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1).replace('.', ',')} ms`;
};
const pctile = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)] : NaN; };
// Temps du 1er téléchargement de chaque modèle, mémorisé pour les visites suivantes (le cache le masque ensuite).
const loadLog = {
  get(id) { try { return JSON.parse(localStorage.getItem(`gc-load:${id}`) || 'null'); } catch { return null; } },
  set(id, v) { try { localStorage.setItem(`gc-load:${id}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
const fmtMb = (b) => `${(b / 1e6).toFixed(0)} Mo`;
const cardUrl = (slug) => `https://gift.cool/e-carte-cadeau-multi-enseignes-gift-cool/carte-${slug}/`;
const KW_COLOR = '#9A97AE';

const EXAMPLES = [
  'Un cadeau pour mon père qui aime le jardinage',
  'Ma mère a la main verte et passe ses dimanches au potager',
  'Mon neveu de 6 ans est fou de dinosaures',
  'Ma copine rêve de sauter en parachute',
  'Mon grand-père dévore les romans policiers',
  'Un ami geek fan de Zelda et de Mario',
  'Ma sœur ne jure que par le yoga et les massages',
];

// Jeu de test : formulations naturelles + cartes passion jugées pertinentes.
const BENCH = [
  ['Un cadeau pour mon père qui aime le jardinage', ['brico-deco', 'ma-planete']],
  ['Ma mère a la main verte et passe ses dimanches au potager', ['brico-deco', 'ma-planete']],
  ['Mon neveu de 6 ans est fou de dinosaures', ['mini-moi', 'jeux']],
  ['Une collègue qui enchaîne les trails en montagne', ['running', 'aventure']],
  ['Ma copine rêve de sauter en parachute', ['aventure']],
  ['Mon grand-père dévore les romans policiers', ['lecture', 'culture']],
  ['Un ami geek fan de Zelda et de Mario', ['jeux']],
  ['Une amie qui veut consommer de façon plus responsable', ['ma-planete']],
  ['Mes parents adorent les bons restos et le vin', ['saveurs']],
  ['Ma sœur ne jure que par le yoga et les massages', ['bien-etre']],
  ['Un ado qui prend des cours de hip-hop', ['danse']],
  ['Pour mon chat qui est très gourmand', ['animaux']],
  ['Un supporter qui ne rate aucun match au stade', ['foot']],
  ['Elle fait 50 km à vélo tous les dimanches', ['cyclisme']],
  ['Elle se maquille tous les jours et adore les nouveautés', ['beaute']],
  ['Il veut refaire entièrement sa salle de bains', ['brico-deco']],
  ["Mon oncle passe ses week-ends au bord de l'étang avec sa canne", ['aventure', 'ma-planete']],
  ['Une amie qui ne sort jamais sans son appareil photo', ['culture', 'aventure']],
  ['Mon frère ne peut pas commencer sa journée sans un bon expresso', ['saveurs']],
  ['Ma tante adore coudre ses propres vêtements', ['deco']],
  ['Emmener les enfants rencontrer Mickey', ['mini-moi', 'aventure']],
  ['Il observe les étoiles et les planètes le soir', ['culture', 'aventure']],
  ['Une cavalière qui monte tous les samedis', ['animaux', 'aventure']],
  ["Mon père est le roi des grillades l'été", ['saveurs', 'brico-deco']],
  ['Une amoureuse des bougies parfumées et des ambiances cosy', ['deco', 'beaute', 'bien-etre']],
  ['Il passe ses vacances à dévaler les pistes', ['aventure']],
  ["Un collègue qui veut se mettre à l'espagnol", ['culture', 'lecture']],
  ['Ma fille de 3 ans adore les histoires avant de dormir', ['mini-moi', 'lecture']],
  ['Un mélomane qui écoute ses vinyles en haute fidélité', ['culture']],
  ['Pour quelqu\'un qui stresse beaucoup et dort mal', ['bien-etre']],
];

const state = {
  mode: 'compare', query: '', lastAi: null, lastKw: null,
  aiReady: false, searches: 0, lastLatency: null,
  userModel: initialModelId(),   // modèle choisi par l'utilisateur dans le sélecteur
  benchRunning: false,
  bench: {},                     // résultats du test par modèle : { [modelId]: { rows, stats } }
};

const [enseignes, passions] = await Promise.all([
  fetch('data/enseignes.json').then((r) => r.json()),
  fetch('data/passions.json').then((r) => r.json()),
]);
const bySlug = Object.fromEntries(passions.map((p) => [p.slug, p]));
const kwT0 = performance.now();
const kw = new KeywordIndex(enseignes, bySlug);
const kwBuildMs = performance.now() - kwT0;
const engine = new SemanticEngine(enseignes, passions);

/* ---------------- Exemples, formulaire, mode ---------------- */
$('#examples').innerHTML = EXAMPLES.map((e) => `<button type="button" class="chip">${esc(e)}</button>`).join('');
$('#examples').addEventListener('click', (ev) => { const b = ev.target.closest('.chip'); if (b) setQuery(b.textContent); });
$('#search-form').addEventListener('submit', (ev) => { ev.preventDefault(); runSearch($('#q').value); });
let debounce;
$('#q').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { const v = $('#q').value; if (v.trim().length >= 3) runSearch(v); }, 450); });

document.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('.segmented button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  $('#results').dataset.mode = state.mode;
  $('#toolbar-hint').textContent = state.mode === 'compare'
    ? "Même requête, deux moteurs : la recherche par mots-clés et l'IA sémantique."
    : "L'expérience telle que la verrait un client sur gift.cool.";
  if (state.lastAi) renderPassion(state.lastAi, state.lastKw);
}));

function setQuery(q) { $('#q').value = q; runSearch(q); document.querySelector('.toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' }); }

/* ---------------- Sélecteur de modèle ---------------- */
const menu = $('#model-menu');
const btn = $('#model-btn');
const CHECK = '<svg class="model-opt__check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

function renderPicker() {
  const m = MODEL_BY_ID[state.userModel];
  $('#model-btn-label').textContent = m.label;
  $('#model-btn-dot').style.background = m.color;
  btn.dataset.state = engine.ready && engine.modelId === m.id ? 'ready' : 'loading';
  btn.disabled = state.benchRunning;
  const opt = (x) => `
      <button type="button" class="model-opt" role="option" data-id="${x.id}" aria-selected="${x.id === state.userModel}">
        <span class="model-opt__dot" style="background:${x.color}"></span>
        <span>
          <span class="model-opt__name">${esc(x.label)} <small>${esc(x.vendor)} · ${esc(releaseLabel(x))}</small></span>
          <span class="model-opt__tag">${esc(x.tagline)}</span>
          <span class="model-opt__meta">${isApi(x)
            ? `<span>0 Mo à télécharger</span><span>${x.dims} dim.</span>${getGeminiKey() ? '<span class="is-cached">✓ Clé API enregistrée</span>' : '<span class="is-api">Clé API requise</span>'}`
            : `<span>${x.params} param.</span><span>≈ ${x.sizeMb} Mo</span><span>${x.dims} dim.</span>${engine.cacheMap[x.id] ? '<span class="is-cached">✓ Déjà téléchargé</span>' : '<span>À télécharger</span>'}`}
          </span>
        </span>
        ${CHECK}
      </button>`;
  menu.innerHTML = `
    <div class="model-menu__head">Dans le navigateur · aucune donnée envoyée</div>
    ${MODELS.filter((x) => !isApi(x)).map(opt).join('')}
    <div class="model-menu__head model-menu__head--sep">Via API Google · la requête part dans le cloud</div>
    ${MODELS.filter(isApi).map(opt).join('')}
    <div class="model-menu__foot">Un modèle local plus gros est souvent plus pertinent mais plus long à charger. Un modèle API ne télécharge rien mais dépend du réseau et d'une clé.${getGeminiKey() ? ' <button type="button" class="linkish" id="key-edit">Gérer la clé API</button>' : ''}</div>`;
  const ke = menu.querySelector('#key-edit');
  if (ke) ke.addEventListener('click', (e) => { e.stopPropagation(); openMenu(false); askKey(); });
}

function openMenu(open) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) { renderPicker(); const sel = menu.querySelector('[aria-selected="true"]'); sel && sel.focus(); }
}
btn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(menu.hidden); });
document.addEventListener('click', (e) => { if (!e.target.closest('#model-picker')) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); btn.focus(); } });
menu.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const opts = [...menu.querySelectorAll('.model-opt')];
  const i = opts.indexOf(document.activeElement);
  opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
});
menu.addEventListener('click', (e) => {
  const o = e.target.closest('.model-opt');
  if (!o) return;
  openMenu(false);
  selectModel(o.dataset.id);
});

async function selectModel(id) {
  if (isApi(MODEL_BY_ID[id]) && !getGeminiKey() && !(await askKey())) return; // pas de clé : on reste sur le modèle actuel
  const prev = engine.ready ? engine.modelId : null;
  state.userModel = id;
  state.aiReady = false;
  renderPicker();
  if (state.query) showAiLoading();
  try {
    await engine.use(id);
    if (!state.benchRunning && engine.modelId === id && !state.aiReady) activate();
  } catch (e) {
    if (e.superseded) return;
    // Échec (réseau, quota, mémoire…) : on garde le message visible et on revient au modèle précédent.
    const m = MODEL_BY_ID[id];
    const partial = isApi(m) ? engine.partialIndex(m) : 0;
    notice(`${m.label} : ${e.message}.${partial ? ` L'indexation est sauvegardée (${partial}/${engine.indexKey(m).count}) et reprendra là où elle s'est arrêtée.` : ''}${prev && prev !== id ? ` Retour à ${MODEL_BY_ID[prev].label}.` : ''}`);
    if (prev && prev !== id) { state.userModel = prev; renderPicker(); engine.use(prev).then(() => { if (!state.aiReady) activate(); }).catch(() => {}); }
  }
}

/* ---------------- Clé API Gemini ---------------- */
const dlg = $('#key-dialog');
function askKey() {
  return new Promise((resolve) => {
    $('#key-input').value = getGeminiKey();
    document.querySelectorAll('input[name="key-tier"]').forEach((r) => { r.checked = r.value === getGeminiTier(); });
    $('#key-error').textContent = '';
    $('#key-forget').hidden = !getGeminiKey();
    const done = (ok) => { dlg.close(); renderPicker(); renderBenchModels(); resolve(ok); };
    $('#key-form').onsubmit = (e) => {
      e.preventDefault();
      const k = $('#key-input').value.trim();
      if (k.length < 20) { $('#key-error').textContent = 'Cette clé semble incomplète.'; return; }
      const first = !getGeminiKey();
      setGeminiKey(k);
      setGeminiTier((document.querySelector('input[name="key-tier"]:checked') || {}).value);
      if (first) MODELS.filter(isApi).forEach((m) => benchSel.add(m.id)); // nouvelle clé : on propose aussi Gemini au test
      done(true);
    };
    $('#key-cancel').onclick = () => done(false);
    $('#key-forget').onclick = () => {
      setGeminiKey('');
      if (isApi(MODEL_BY_ID[state.userModel])) selectModel(DEFAULT_MODEL);
      done(false);
    };
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
    dlg.showModal();
    $('#key-input').focus();
  });
}

/* ---------------- Statut de l'IA ---------------- */
function notice(txt) {
  $('#ai-notice-txt').textContent = txt || '';
  $('#ai-notice').hidden = !txt;
}
$('#ai-notice-close').addEventListener('click', () => notice(''));
const status = (txt, st, pct) => {
  $('#ai-status-txt').textContent = txt;
  if (st) $('#ai-status').dataset.state = st;
  if (pct != null) $('#ai-status-bar').style.width = `${pct}%`;
};
const benchStatus = (txt) => { $('#bench-status').textContent = txt; };

engine.addEventListener('switching', ({ detail: { model } }) => {
  status(isApi(model) ? `${model.label} : connexion à l'API Google…` : `Chargement de ${model.label}…`, 'loading', 0);
  renderPicker();
});
engine.addEventListener('progress', ({ detail: d }) => {
  const pct = d.total ? Math.round((100 * d.loaded) / d.total) : 0;
  const txt = d.fromCache
    ? `${d.model.label} : chargement depuis le cache du navigateur… ${pct} %`
    : `${d.model.label} : téléchargement… ${pct} % (${fmtMb(d.loaded)} / ${fmtMb(d.total)}), une seule fois`;
  status(txt, 'loading', pct);
  if (state.benchRunning) benchStatus(txt);
});
engine.addEventListener('model-ready', ({ detail: { model } }) => status(`${model.label} chargé. Indexation des enseignes…`, 'loading', 0));
let lastIdx = null;
engine.addEventListener('api-wait', ({ detail: d }) => {
  const why = d.why === '429' ? 'Google demande une pause (erreur 429)' : `quota ${TIERS[getGeminiTier()].label.toLowerCase()} de Google : ${TIERS[getGeminiTier()].perMinute} textes/min`;
  const where = d.phase === 'index' && lastIdx ? ` · indexation ${lastIdx.done}/${lastIdx.total}` : '';
  const txt = `${d.model.label} : ${why}, reprise dans ${d.sec} s${where}`;
  status(txt, 'loading');
  if (state.benchRunning) benchStatus(txt);
});
engine.addEventListener('index-progress', ({ detail: d }) => {
  lastIdx = d;
  const txt = `${d.model.label} : indexation des enseignes et cartes passion… ${d.done}/${d.total}`;
  status(txt, 'loading', Math.round((100 * d.done) / d.total));
  if (state.benchRunning) benchStatus(txt);
});
function activate() {
  const m = engine.model;
  if (isApi(m)) notice(''); // un modèle API qui répond efface l'alerte précédente
  state.aiReady = true;
  renderPicker();
  $('#bench-run').disabled = false;
  $('#ai-model-tag').textContent = m.label;
  $('#ai-model-tag').style.background = m.color;
  renderTiles();
  renderBenchModels();
  if (state.query) runSearch(state.query);
  else $('#ai-list').innerHTML = '<div class="placeholder">Tapez une recherche ou choisissez un exemple ci-dessus.</div>';
}
engine.addEventListener('ready', ({ detail: s }) => {
  if (s.loadSource === 'download' && s.modelMs) loadLog.set(s.model.id, { ms: s.modelMs, bytes: s.modelBytes, at: Date.now() });
  status(isApi(s.model)
    ? `${s.model.label} prêt en ${fmtMs(s.readyMs)} · via l'API Google : la requête quitte le navigateur`
    : `${s.model.label} prêt en ${fmtMs(s.readyMs)}${s.fromCache ? ' (depuis le cache)' : ''} · 100 % local, dans votre navigateur`, 'ready');
  renderPicker();
  if (!state.benchRunning && s.model.id === state.userModel) activate();
});
engine.addEventListener('cache', () => { renderPicker(); renderBenchModels(); });
engine.addEventListener('error', ({ detail: e }) => {
  const who = e.model ? `${e.model.label} : ` : '';
  status(`${who}impossible de ${e.model && isApi(e.model) ? "joindre l'API" : 'charger le modèle'} (${e.message})`, 'error');
  if (!state.benchRunning && !(e.model && isApi(e.model))) $('#ai-list').innerHTML = `<div class="placeholder">Le modèle n'a pas pu être chargé (${esc(e.message)}). Vérifiez la connexion à huggingface.co et cdn.jsdelivr.net, ou choisissez un modèle plus léger.</div>`;
});

/* ---------------- Recherche ---------------- */
function showAiLoading() {
  $('#ai-list').innerHTML = `<div class="placeholder">${esc(MODEL_BY_ID[state.userModel].label)} termine son chargement… les résultats s'afficheront automatiquement.</div>${'<div class="skeleton"></div>'.repeat(3)}`;
  $('#ai-meta').textContent = '';
}

async function runSearch(raw) {
  const q = raw.trim();
  if (!q) return;
  state.query = q;
  const kwRes = kw.search(q, 8);
  state.lastKw = kwRes;
  renderKw(kwRes);

  if (!state.aiReady || state.benchRunning) { showAiLoading(); return; }
  try {
    const res = await engine.search(q, 8);
    if (q !== state.query) return; // une requête plus récente est en cours
    state.lastAi = res; state.searches++; state.lastLatency = res.totalMs;
    renderAi(res);
    renderPassion(res, kwRes);
    renderTiles();
  } catch (e) {
    $('#ai-list').innerHTML = `<div class="placeholder">Erreur : ${esc(e.message)}</div>`;
  }
}

/* ---------------- Rendu ---------------- */
function logo(e) {
  const c = bySlug[e.passions[0]].color;
  const ini = esc(e.name.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
  return `<span class="logo" style="background:${c}1A;color:${c}"><img loading="lazy" alt="" src="https://www.google.com/s2/favicons?domain=${esc(e.domain)}&sz=64" onerror="this.parentNode.style.background='${c}';this.parentNode.style.color='#fff';this.replaceWith('${ini}')"></span>`;
}
const pills = (e) => e.passions.slice(0, 3).map((p) => `<span class="pill">${esc(bySlug[p].label)}</span>`).join('');

function highlight(text, terms) {
  if (!terms.length) return esc(text);
  return text.split(/([A-Za-zÀ-ÿ0-9]+)/).map((tok) => {
    const t = tokenize(tok)[0];
    if (t && terms.some((m) => t === m || (m.length >= 4 && t.startsWith(m)))) return `<mark>${esc(tok)}</mark>`;
    return esc(tok);
  }).join('');
}

function renderKw(r) {
  $('#kw-meta').textContent = `${r.total} résultat${r.total > 1 ? 's' : ''} · ${fmtMs(r.ms)}`;
  if (!r.results.length) {
    $('#kw-list').innerHTML = `<div class="empty"><div class="empty__big">0</div><h3>Aucun résultat</h3><p>Aucune enseigne ne contient les mots « ${esc(r.terms.join(' · '))} ». Le client repart sans idée cadeau.</p></div>`;
    return;
  }
  const max = r.results[0].score;
  $('#kw-list').innerHTML = r.results.map((x, i) => `
    <article class="card" style="animation-delay:${i * 30}ms">
      ${logo(x.item)}
      <div>
        <h3 class="card__name">${highlight(x.item.name, x.matched)}</h3>
        <p class="card__desc">${highlight(x.item.desc, x.matched)}</p>
        <div class="pills">${pills(x.item)}</div>
      </div>
      <div class="card__score"><b>${x.matched.length}</b><small>mot${x.matched.length > 1 ? 's' : ''} trouvé${x.matched.length > 1 ? 's' : ''}</small><div class="meter"><span style="width:${Math.round((100 * x.score) / max)}%;background:var(--kw)"></span></div></div>
    </article>`).join('');
}

function renderAi(r) {
  $('#ai-meta').textContent = `${r.model.label} · ${fmtMs(r.totalMs)}`;
  const top = r.results[0].score;
  $('#ai-list').innerHTML = r.results.map((x, i) => {
    const rel = Math.max(4, Math.min(100, Math.round((100 * (x.score - r.floor)) / Math.max(top - r.floor, 1e-6))));
    return `
    <article class="card" style="animation-delay:${i * 30}ms">
      ${logo(x.item)}
      <div>
        <h3 class="card__name">${esc(x.item.name)}${x.nameHit ? '<span class="badge-name">enseigne citée</span>' : ''}</h3>
        <p class="card__desc">${esc(x.item.desc)}</p>
        <div class="pills">${pills(x.item)}</div>
      </div>
      <div class="card__score" title="Similarité cosinus : ${x.sim.toFixed(3)}"><b>${rel} %</b><small>pertinence</small><div class="meter"><span style="width:${rel}%"></span></div></div>
    </article>`;
  }).join('');
}

function renderPassion(ai, kwRes) {
  const best = ai.passions[0];
  const p = best.passion;
  const alt = ai.passions.slice(1).map((x) => `<button type="button" data-slug="${x.passion.slug}">${esc(x.passion.label)}</button>`).join('');
  let kwLine = '';
  if (state.mode === 'compare') {
    const kwTop = kwRes.results[0];
    kwLine = kwTop
      ? `<p class="passion__kw">Recherche classique : premier résultat « ${esc(kwTop.item.name)} » (univers ${esc(kwTop.item.passions.map((s) => bySlug[s].label).join(', '))}), sans carte passion proposée.</p>`
      : '<p class="passion__kw">Recherche classique : 0 résultat, aucune carte proposée. Vente perdue.</p>';
  }
  const el = $('#passion');
  el.hidden = false;
  el.style.setProperty('--pc', p.color);
  el.innerHTML = `
    <div class="passion__visual" style="background:${p.color}">
      <span class="fallback">Gift.cool ${esc(p.label)}</span>
      <img src="${esc(p.img)}" alt="Carte Gift.cool ${esc(p.label)}" onerror="this.remove()" style="position:relative">
    </div>
    <div>
      <span class="passion__kicker">✦ La carte idéale selon l'IA</span>
      <h3>Gift.cool <em>${esc(p.label)}</em></h3>
      <p class="passion__tagline">${esc(p.tagline)}</p>
      <p class="passion__why">Utilisable notamment chez <b>${best.top.map((e) => esc(e.name)).join('</b>, <b>')}</b>, les enseignes les plus proches de votre recherche.</p>
      <div class="passion__row">
        <a class="btn passion__cta" href="${cardUrl(p.slug)}" target="_blank" rel="noopener">Offrir cette carte</a>
        ${alt ? `<span class="passion__alt">Aussi pertinent : ${alt}</span>` : ''}
      </div>
      ${kwLine}
    </div>`;
  el.querySelectorAll('.passion__alt button').forEach((b) => b.addEventListener('click', () => window.open(cardUrl(b.dataset.slug), '_blank', 'noopener')));
}

function renderTiles() {
  const m = MODEL_BY_ID[state.userModel];
  const s = engine.statsByModel[m.id] || {};
  const api = isApi(m);
  const qTokens = Math.max(1, Math.round(((m.query || '') + state.query).length / 4));
  const tiles = api ? [
    { l: 'Modèle d\'IA actif', v: m.label, sub: `${m.apiModel} · API Google · sorti en ${releaseLabel(m)} · ${m.dims} dim.` },
    { l: 'Poids du modèle', v: '0 Mo', sub: 'rien à télécharger : le modèle tourne chez Google' },
    { l: 'Modèle prêt en', v: s.readyMs ? fmtMs(s.readyMs) : '—', sub: s.indexCached ? 'index des enseignes servi depuis le cache' : 'index des enseignes calculé via l\'API' },
    { l: 'Index des enseignes', v: `${enseignes.length + passions.length}`, sub: `${enseignes.length} enseignes + ${passions.length} cartes · ${s.indexCached ? 'depuis le cache' : (s.indexMs ? `calculé en ${fmtMs(s.indexMs)}` : '—')}` },
    { l: 'Temps d\'une recherche', v: state.lastLatency != null ? fmtMs(state.lastLatency) : '—', sub: 'aller-retour réseau compris', hl: true },
    { l: 'Requête envoyée à un serveur', v: state.query ? `≈ ${qTokens} tokens` : 'Oui', sub: 'le texte de la recherche part chez Google (API Gemini)', hl: true },
  ] : [
    { l: 'Modèle d\'IA actif', v: m.label, sub: `${m.repo.split('/').pop()} · sorti en ${releaseLabel(m)} · ${m.params} param. · ${m.dtype.toUpperCase()} · ${m.dims} dim.` },
    { l: 'Poids du modèle', v: s.modelBytes ? fmtMb(s.modelBytes) : `≈ ${m.sizeMb} Mo`, sub: s.fromCache ? 'servi depuis le cache : 0 octet téléchargé' : 'téléchargé une seule fois, puis mis en cache' },
    { l: 'Modèle prêt en', v: s.readyMs ? fmtMs(s.readyMs) : '—', sub: `chargement + indexation · ${DEVICE === 'webgpu' ? 'WebGPU' : 'WebAssembly'} dans un Web Worker` },
    { l: 'Index des enseignes', v: `${enseignes.length + passions.length}`, sub: `${enseignes.length} enseignes + ${passions.length} cartes · ${s.indexCached ? 'depuis le cache' : (s.indexMs ? `calculé en ${fmtMs(s.indexMs)}` : '—')}` },
    { l: 'Temps d\'une recherche', v: state.lastLatency != null ? fmtMs(state.lastLatency) : '—', sub: state.searches ? `${state.searches} recherche${state.searches > 1 ? 's' : ''} effectuée${state.searches > 1 ? 's' : ''}` : 'lancez une recherche', hl: true },
    { l: 'Requête envoyée à un serveur', v: '0 octet', sub: 'confidentialité totale (RGPD) · coût serveur nul', hl: true },
  ];
  $('#tiles').innerHTML = tiles.map((t) => `
    <div class="tile${t.hl ? ' tile--hl' : ''}">
      <p class="tile__label">${esc(t.l)}</p>
      <p class="tile__value">${esc(t.v)}</p>
      <p class="tile__sub">${esc(t.sub)}</p>
    </div>`).join('');
}

/* ---------------- Benchmark multi-modèles ---------------- */
const benchSel = new Set(MODELS.filter((m) => !isApi(m) || getGeminiKey()).map((m) => m.id));

function renderBenchModels() {
  $('#bench-models').innerHTML = MODELS.map((m) => `
    <label class="bench-chip">
      <input type="checkbox" value="${m.id}" ${benchSel.has(m.id) ? 'checked' : ''} ${state.benchRunning ? 'disabled' : ''}>
      <i style="background:${m.color}"></i>${esc(m.label)}
      <small>${releaseYear(m)} · ${isApi(m) ? (getGeminiKey() ? 'API · clé ✓' : 'API · clé requise') : (engine.cacheMap[m.id] ? 'en cache' : `≈ ${m.sizeMb} Mo`)}</small>
    </label>`).join('');
  const toDl = MODELS.filter((m) => benchSel.has(m.id) && !isApi(m) && !engine.cacheMap[m.id]).reduce((s, m) => s + m.sizeMb, 0);
  const cold = $('#bench-cold').checked;
  const apiSel = MODELS.filter((m) => benchSel.has(m.id) && isApi(m));
  const tier = TIERS[getGeminiTier()];
  const apiNotes = apiSel.map((m) => {
    const { count } = engine.indexKey(m);
    const idx = cold || !engine.isIndexCached(m) ? count - (cold ? 0 : engine.partialIndex(m)) : 0;
    const total = idx + BENCH.length;
    const min = Math.ceil(total / tier.perMinute);
    return `${m.label} : ≈ ${total} requêtes${tier.perDay < Infinity ? ` sur ${tier.perDay}/jour` : ''}${min > 1 ? `, ≈ ${min} min` : ''}`;
  });
  const parts = [];
  if (toDl) parts.push(`Le test téléchargera ≈ ${toDl} Mo de modèles (une seule fois).`);
  if (apiNotes.length) parts.push(`Quota Google (clé ${tier.label.toLowerCase()}, chaque texte compte) : ${apiNotes.join(' · ')}.`);
  if (!state.benchRunning) benchStatus(parts.join(' '));
  $('#bench-run').textContent = benchSel.size > 1 ? `Comparer ${benchSel.size} modèles` : 'Lancer le test';
}
$('#bench-cold').addEventListener('change', () => renderBenchModels());
$('#bench-models').addEventListener('change', (e) => {
  if (e.target.checked) benchSel.add(e.target.value); else benchSel.delete(e.target.value);
  $('#bench-run').disabled = !benchSel.size || state.benchRunning;
  renderBenchModels();
});

function scoreQueries(searchFn) {
  return async (onStep) => {
    const rows = [];
    for (const [q, expected] of BENCH) {
      const a = await searchFn(q);
      const fit = (e) => e.passions.some((p) => expected.includes(p));
      rows.push({
        ok: expected.includes(a.passions[0].passion.slug),
        p3: a.results.slice(0, 3).filter((x) => fit(x.item)).length,
        card: a.passions[0].passion.label,
        top: a.results.slice(0, 3).map((x) => x.item.name).join(', '),
        ms: a.totalMs,
        embedMs: a.embedMs,
        waitMs: a.waitMs || 0,
      });
      onStep(rows.length);
    }
    return rows;
  };
}

function keywordRows() {
  return BENCH.map(([q, expected]) => {
    const k = kw.search(q, 8);
    const fit = (e) => e.passions.some((p) => expected.includes(p));
    const t = k.results[0];
    return { q, count: k.total, ok: !!t && fit(t.item), p3: k.results.slice(0, 3).filter((x) => fit(x.item)).length, top: t ? t.item.name : '0 résultat', ms: k.ms };
  });
}

$('#bench-run').addEventListener('click', async () => {
  if (MODELS.some((m) => isApi(m) && benchSel.has(m.id)) && !getGeminiKey() && !(await askKey())) {
    MODELS.filter(isApi).forEach((m) => benchSel.delete(m.id)); // sans clé, on compare seulement les modèles locaux
    renderBenchModels();
  }
  const ids = MODELS.map((m) => m.id).filter((id) => benchSel.has(id));
  if (!ids.length) return;
  // On commence par le modèle déjà chargé pour éviter un rechargement inutile.
  ids.sort((a, b) => (b === engine.modelId) - (a === engine.modelId));
  state.benchRunning = true; state.aiReady = false;
  $('#bench-run').disabled = true;
  renderPicker(); renderBenchModels();
  try {
    for (const [i, id] of ids.entries()) {
      const m = MODEL_BY_ID[id];
      benchStatus(`Modèle ${i + 1}/${ids.length} · ${m.label} : chargement…`);
      try {
        const st = await engine.use(id, { cold: $('#bench-cold').checked });
        const rows = await scoreQueries((q) => engine.search(q, 8))((n) => benchStatus(`Modèle ${i + 1}/${ids.length} · ${m.label} : requête ${n}/${BENCH.length}`));
        state.bench[id] = { rows, st: { ...st } };
      } catch (e) {
        state.bench[id] = { error: e.message };
        if (isApi(m)) notice(`${m.label} : ${e.message}.${engine.partialIndex(m) ? ` Indexation sauvegardée (${engine.partialIndex(m)}/${engine.indexKey(m).count}), elle reprendra au prochain essai.` : ''}`);
      }
      renderBench();
    }
  } finally {
    state.benchRunning = false;
    benchStatus('');
    renderBenchModels();
    $('#bench-run').disabled = false;
    // Retour au modèle choisi dans la barre de recherche.
    try { await engine.use(state.userModel); activate(); } catch { /* erreur déjà affichée */ }
  }
});

function renderBench() {
  const n = BENCH.length;
  const kwR = keywordRows();
  const pct = (v, t) => Math.round((100 * v) / t);
  const engines = [
    { id: 'kw', label: 'Mots-clés', color: KW_COLOR, rows: kwR, size: '0 Mo', kw: true },
    ...MODELS.filter((m) => state.bench[m.id]).map((m) => {
      const b = state.bench[m.id];
      if (b.error) return { id: m.id, label: m.label, color: m.color, released: releaseLabel(m), error: b.error };
      return { id: m.id, m, label: m.label, color: m.color, api: isApi(m), released: releaseLabel(m), mteb: m.mteb, rows: b.rows, st: b.st, size: isApi(m) ? '0 Mo (API)' : `≈ ${m.sizeMb} Mo` };
    }),
  ];
  const ok = engines.filter((e) => !e.error);
  ok.forEach((e) => {
    e.okPct = pct(e.rows.filter((r) => r.ok).length, n);
    e.p3Pct = pct(e.rows.reduce((s, r) => s + r.p3, 0), 3 * n);
    const ms = e.rows.map((r) => r.ms);
    e.first = ms[0]; e.med = pctile(ms, 50); e.p95 = pctile(ms, 95); e.min = Math.min(...ms); e.max = Math.max(...ms);
    e.waitTotal = e.rows.reduce((t, r) => t + (r.waitMs || 0), 0);
    if (!e.kw) {
      e.embedMed = pctile(e.rows.map((r) => r.embedMs), 50);
      e.rankMed = pctile(e.rows.map((r) => r.ms - r.embedMs), 50);
    }
  });
  const best = (k) => Math.max(...ok.map((e) => e[k]));
  const ai = ok.filter((e) => !e.kw);
  const fastest = ai.length > 1 ? Math.min(...ai.map((e) => e.med)) : null;
  const maxMed = Math.max(...ok.map((e) => e.med), 1);
  const cellBar = (v, color, isBest) => `<div class="cell-bar"><span class="bar-track"><span class="bar-fill" style="width:${v}%;background:${color}"></span></span><b>${v} %</b></div>${isBest ? '<span class="best">meilleur</span>' : ''}`;
  const engineCell = (e) => `<td><span class="engine"><i style="background:${e.color}"></i>${esc(e.label)}${e.api ? '<span class="tag-api">API</span>' : (!e.kw ? '<span class="tag-local">local</span>' : '')}</span>${e.released ? `<span class="t-sub">sorti en ${esc(e.released)}</span>` : ''}</td>`;
  const two = (main, sub) => `<span class="t-main">${main}</span>${sub ? `<span class="t-sub">${sub}</span>` : ''}`;
  const kwZero = kwR.filter((r) => r.count === 0).length;

  // Chargement du modèle : distingue 1er téléchargement, cache navigateur, déjà en mémoire, API.
  const loadCell = (e) => {
    if (e.kw) return two('aucun', 'pas de modèle');
    if (e.api) return two('aucun', 'modèle hébergé chez Google');
    const st = e.st; const log = loadLog.get(e.id);
    const dl = log ? `1er téléchargement : ${fmtMs(log.ms)}${log.bytes ? ` (${fmtMb(log.bytes)})` : ''}` : '1er téléchargement : non mesuré';
    if (st.loadSource === 'download') return two(fmtMs(st.modelMs), `téléchargement ${st.modelBytes ? fmtMb(st.modelBytes) : ''}`);
    if (st.loadSource === 'memory') return two('déjà en mémoire', `${st.modelMs ? `chargé en ${fmtMs(st.modelMs)} · ` : ''}${dl}`);
    return two(fmtMs(st.modelMs), `depuis le cache · ${dl}`);
  };
  // Indexation : temps réel du calcul des vecteurs des enseignes (mémorisé même quand l'index vient du cache).
  const indexCell = (e) => {
    if (e.kw) return two(fmtMs(kwBuildMs), `${enseignes.length} enseignes`);
    const st = e.st; const cnt = st.indexCount || (enseignes.length + passions.length);
    if (st.indexMeasuredMs == null) return two(st.indexCached ? 'en cache' : 'repris', st.indexResumed ? 'indexation reprise après un arrêt de quota : temps partiel, relancez en « mesure à froid »' : 'non mesuré : cochez « mesure à froid »');
    const per = `${fmtMs(st.indexMeasuredMs / cnt)} / texte`;
    const wait = e.api && st.indexWaitMs > 500 ? ` · + ${fmtMs(st.indexWaitMs)} d'attente de quota` : '';
    return two(fmtMs(st.indexMeasuredMs), st.indexCached ? `${per} · mesuré au 1er calcul, servi depuis le cache${wait}` : `${per} · ${cnt} textes${e.api ? ', via l\'API' : ''}${wait}`);
  };
  // Nouveau visiteur : téléchargement + indexation + 1re recherche (ce que vivrait un client qui arrive).
  const newVisitor = (e) => {
    if (e.kw) return two(fmtMs(kwBuildMs + e.first), 'instantané');
    const st = e.st;
    const idx = st.indexMeasuredMs == null ? null : st.indexMeasuredMs + (st.indexWaitMs || 0);
    const dl = e.api ? 0 : (st.loadSource === 'download' ? st.modelMs : (loadLog.get(e.id) || {}).ms);
    if (dl == null || idx == null) return two('n.c.', 'lancez une mesure à froid sur un navigateur vide');
    return two(fmtMs(dl + idx + e.first), e.api ? 'index calculé via l\'API + 1re recherche' : 'téléchargement + indexation + 1re recherche');
  };

  $('#bench-out').innerHTML = `
    <h3 class="bench__h">Pertinence</h3>
    <div class="table-wrap summary"><table>
      <thead><tr><th>Moteur</th><th>Bon univers du 1er coup</th><th>Enseignes pertinentes (top 3)</th><th>Score MTEB public</th><th>Poids</th></tr></thead>
      <tbody>${engines.map((e) => e.error ? `
        <tr>${engineCell(e)}<td colspan="4" class="ko">Échec du chargement : ${esc(e.error)}</td></tr>` : `
        <tr>
          ${engineCell(e)}
          <td>${cellBar(e.okPct, e.color, ok.length > 1 && e.okPct === best('okPct'))}</td>
          <td>${cellBar(e.p3Pct, e.color, ok.length > 1 && e.p3Pct === best('p3Pct'))}</td>
          <td class="num">${e.mteb ? e.mteb.toFixed(1).replace('.', ',') : '—'}</td>
          <td class="num">${e.size}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="legend-note">« Bon univers » : univers du 1er résultat (mots-clés) ou carte passion proposée (IA). « Top 3 » : part des 3 premières enseignes qui correspondent au besoin (${3 * n} au total). « Score MTEB public » : score de recherche multilingue publié (MTEB Multilingual Retrieval, 18 tâches), pour comparer avec le benchmark gift.cool ; non publié pour les modèles Gemini sur ce tableau.</p>

    <h3 class="bench__h">Temps</h3>
    <div class="table-wrap summary timing"><table>
      <thead>
        <tr><th rowspan="2">Moteur</th><th colspan="3" class="grp">Mise en route</th><th colspan="5" class="grp">Temps de réponse (${n} recherches)</th></tr>
        <tr><th>Chargement du modèle</th><th>Indexation des enseignes</th><th>Nouveau visiteur</th><th>1re recherche</th><th>Médiane</th><th>p95</th><th>dont requête → vecteur</th><th>dont classement</th></tr>
      </thead>
      <tbody>${ok.map((e) => `
        <tr>
          ${engineCell(e)}
          <td>${loadCell(e)}</td>
          <td>${indexCell(e)}</td>
          <td class="hl-cell">${newVisitor(e)}</td>
          <td class="num">${fmtMs(e.first)}</td>
          <td><div class="cell-bar cell-bar--ms"><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, (100 * e.med) / maxMed)}%;background:${e.color}"></span></span><b>${fmtMs(e.med)}</b></div>${!e.kw && e.med === fastest ? '<span class="best">IA la plus rapide</span>' : ''}</td>
          <td class="num">${fmtMs(e.p95)}<span class="t-sub">min ${fmtMs(e.min)}<br>max ${fmtMs(e.max)}</span></td>
          <td class="num">${e.kw ? '—' : fmtMs(e.embedMed)}${e.api ? `<span class="t-sub">réseau compris${e.waitTotal > 500 ? ` · ${fmtMs(e.waitTotal)} d'attente de quota exclue` : ''}</span>` : ''}</td>
          <td class="num">${e.kw ? fmtMs(e.med) : fmtMs(e.rankMed)}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="legend-note"><b>Chargement</b> : mise en mémoire du modèle (téléchargement à la 1re visite, puis cache du navigateur). <b>Indexation</b> : calcul des vecteurs des ${enseignes.length} enseignes et ${passions.length} cartes, fait une fois puis mis en cache ; en production il serait pré-calculé côté serveur. <b>Nouveau visiteur</b> : attente totale d'un client qui arrive sans cache (attente de quota Google incluse pour l'API). Les temps de réponse API excluent les pauses imposées par le quota. <b>Temps de réponse</b> : de la frappe au classement final ; « requête → vecteur » est le passage dans le modèle (aller-retour réseau inclus pour l'API), « classement » la comparaison aux ${enseignes.length + passions.length} vecteurs et le choix de la carte. p95 : 95 % des recherches sont plus rapides. Temps mesurés sur cet appareil.</p>

    <h3 class="bench__h">Détail par demande</h3>
    <div class="table-wrap detail"><table>
      <thead><tr><th>Demande du client</th>${ok.map((e) => `<th><span class="engine"><i style="background:${e.color}"></i>${esc(e.label)}</span>${e.released ? `<span class="t-sub">${esc(e.released)}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${BENCH.map(([q], i) => `
        <tr>
          <td class="q"><button type="button" data-q="${esc(q)}">${esc(q)}</button></td>
          ${ok.map((e) => {
            const r = e.rows[i];
            const txt = e.kw ? r.top : r.card;
            const tip = e.kw ? `${r.count} résultat(s) · ${fmtMs(r.ms)}` : `Top 3 : ${r.top} (${r.p3}/3) · ${fmtMs(r.ms)}`;
            return `<td class="res ${r.ok ? 'ok' : 'ko'}" title="${esc(tip)}"><span class="ico">${r.ok ? '✓' : '✗'}</span>${esc(txt)}<span class="t-sub">${fmtMs(r.ms)}</span></td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="legend-note">${kwZero ? `${kwZero} demande${kwZero > 1 ? 's' : ''} sans aucun résultat en recherche classique. ` : ''}Survolez une cellule pour voir le top 3 des enseignes ; cliquez sur une demande pour la rejouer avec le modèle sélectionné.</p>`;
  $('#bench-out').querySelectorAll('td.q button').forEach((b) => b.addEventListener('click', () => setQuery(b.dataset.q)));
}

/* ---------------- Démarrage ---------------- */
$('#bench-n').textContent = BENCH.length;
$('#foot-model').textContent = MODELS.map((m) => `${m.label} (${m.repo || m.apiModel}, ${releaseYear(m)})`).join(', ');
const nGc = enseignes.filter((e) => e.src === 'gc').length;
$('#foot-catalog').textContent = `Catalogue de démonstration : ${enseignes.length} enseignes, dont ${nGc} citées sur les pages des cartes passion gift.cool et ${enseignes.length - nGc} ajoutées pour l'illustration.`;
$('#kw-list').innerHTML = '<div class="placeholder">Tapez une recherche ou choisissez un exemple ci-dessus.</div>';
$('#ai-list').innerHTML = '<div class="placeholder">Tapez une recherche ou choisissez un exemple ci-dessus.</div>';
if (isApi(MODEL_BY_ID[state.userModel]) && !getGeminiKey()) state.userModel = DEFAULT_MODEL;
renderPicker();
renderTiles();
renderBenchModels();
selectModel(state.userModel);
