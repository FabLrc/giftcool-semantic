// Recherche « classique » par mots-clés, telle qu'on la trouve sur la plupart des sites :
// normalisation (minuscules, accents), suppression des mots vides, correspondance
// exacte ou par préfixe sur le nom, les tags, l'univers et la description.

const STOP = new Set(`a à au aux avec ce ces cet cette d de des du elle elles en et est il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne nos notre nous on ou où par pas pour qu que qui s sa se ses si son sur t ta te tes toi ton tu un une vos votre vous y ça c tout tous toute toutes tres plus moins fait faire est sont etre avoir chez comme aussi bien tres`.split(/\s+/));

export const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const stem = (w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w);

export function tokenize(s) {
  return normalize(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem);
}

export class KeywordIndex {
  constructor(items, passionsBySlug) {
    this.docs = items.map((e) => ({
      item: e,
      fields: [
        { w: 3, toks: tokenize(e.name) },
        { w: 2, toks: tokenize(e.tags.join(' ')) },
        { w: 2, toks: tokenize(e.passions.map((p) => passionsBySlug[p].label).join(' ')) },
        { w: 1, toks: tokenize(e.desc) },
      ],
    }));
  }

  search(query, k = 8) {
    const t0 = performance.now();
    const q = [...new Set(tokenize(query))];
    const res = [];
    for (const d of this.docs) {
      let score = 0; const matched = new Set();
      for (const qt of q) {
        for (const f of d.fields) {
          if (f.toks.some((t) => t === qt || (qt.length >= 4 && t.startsWith(qt)))) {
            score += f.w; matched.add(qt); break;
          }
        }
      }
      if (score > 0) res.push({ item: d.item, score, matched: [...matched] });
    }
    res.sort((a, b) => b.score - a.score || b.matched.length - a.matched.length);
    return { results: res.slice(0, k), total: res.length, terms: q, ms: performance.now() - t0 };
  }
}
