# Gift.cool · Recherche IA (POC)

Démonstrateur de **recherche sémantique d'idées cadeaux** pour [gift.cool](https://gift.cool/) : le client écrit
« un cadeau pour mon père qui aime le jardinage » et obtient la **carte passion Gift.cool** la plus adaptée et les
**enseignes** qui correspondent le mieux, grâce à un modèle d'IA qui tourne **dans le navigateur** avec
[transformers.js](https://huggingface.co/docs/transformers.js) (Hugging Face).

## Ce que montre l'interface

| Bloc | Ce qu'il prouve |
|---|---|
| **Comparatif côte à côte** | La même requête passe dans une recherche par mots-clés classique (à gauche, mots trouvés surlignés) et dans la recherche IA (à droite). Les formulations naturelles (« main verte », « fou de dinosaures », « romans policiers ») font apparaître l'écart. |
| **Carte passion suggérée** | L'IA recommande la carte Gift.cool à offrir (ex. *Brico-déco* pour le jardinage) et cite les enseignes qui justifient ce choix, avec un lien « Offrir cette carte ». On passe d'une liste d'enseignes à une recommandation qui fait vendre. |
| **Sous le capot** | Poids du modèle, temps de chargement, temps par recherche, **0 octet de requête envoyé à un serveur** (RGPD, coût serveur nul). |
| **Sélecteur de modèle** | Dans la barre de recherche, comme sur Claude ou ChatGPT : on passe d'un modèle d'IA à l'autre à chaud, avec son poids, sa taille et son statut (déjà téléchargé ou non). |
| **Le match** | Test sur 30 demandes clients réalistes, qui compare la recherche par mots-clés et les modèles cochés : bon univers du premier coup, enseignes pertinentes dans le top 3, temps par recherche, poids, temps de chargement. Chaque ligne se rejoue d'un clic. |

Le bouton **Vue client** masque le comparatif pour montrer l'expérience telle qu'un client la verrait.

### Lire le tableau « Temps » du comparateur

| Colonne | Ce qui est mesuré |
|---|---|
| **Chargement du modèle** | Mise en mémoire du modèle : téléchargement à la 1re visite, puis lecture depuis le cache du navigateur (ou « déjà en mémoire »). Le temps du 1er téléchargement est mémorisé et rappelé ensuite. |
| **Indexation des enseignes** | Calcul des vecteurs des 260 enseignes et 19 cartes (279 textes), avec le temps par texte. Quand l'index vient du cache, on affiche le temps mesuré lors du calcul initial. |
| **Nouveau visiteur** | Attente totale d'un client sans cache : téléchargement + indexation + 1re recherche. C'est le chiffre à regarder pour la production. |
| **1re recherche / médiane / p95** | Temps de réponse sur les 30 demandes (p95 : 95 % des recherches sont plus rapides), avec min et max. |
| **dont requête → vecteur** | Passage de la requête dans le modèle (aller-retour réseau inclus pour les modèles API). |
| **dont classement** | Comparaison aux 279 vecteurs et choix de la carte passion. |

La case **« Mesure à froid »** ignore les index en cache et les recalcule, pour mesurer le vrai temps d'indexation
(pour un téléchargement à froid, videz aussi le cache du navigateur).

## Lancer en local

Aucun build. Il suffit d'un serveur statique (les modules ES et le Web Worker ne marchent pas en `file://`) :

```bash
npx serve .          # ou : python3 -m http.server 8000
```

Ouvrir l'URL affichée. **Premier chargement** : le modèle sélectionné est téléchargé depuis le Hub Hugging Face puis
gardé dans le cache du navigateur. Les visites suivantes démarrent en quelques secondes. L'index des enseignes est
calculé une fois par modèle puis mis en cache (localStorage). Le dernier modèle choisi est mémorisé.

## Modèles disponibles

| Modèle | Sortie | Dépôt / API | Paramètres | Poids** | Dim. | MTEB retrieval* | Licence |
|---|---|---|---|---|---|---|---|
| **MiniLM L12 multilingue** (défaut) | 2021 | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 118 M | ≈ 118 Mo | 384 | — | Apache 2.0 |
| **E5 Small** | juin 2023 | `Xenova/multilingual-e5-small` | 118 M | ≈ 118 Mo | 384 | 50,9 | MIT |
| **E5 Base** | juin 2023 | `Xenova/multilingual-e5-base` | 278 M | ≈ 279 Mo | 768 | 52,7 | MIT |
| **EmbeddingGemma** | sept. 2025 | `onnx-community/embeddinggemma-300m-ONNX` | 308 M | ≈ 309 Mo | 768 | 62,5 | Gemma |
| **Granite 97M R2** (IBM) | mai 2026 | `onnx-community/granite-embedding-97m-multilingual-r2-ONNX` | 97 M | ≈ 98 Mo | 384 | 60,3 | Apache 2.0 |
| **Granite 311M R2** (IBM) | mai 2026 | `onnx-community/granite-embedding-311m-multilingual-r2-ONNX` | 311 M | ≈ 313 Mo | 768 | 65,2 | Apache 2.0 |
| **Harrier 270M** (Microsoft) | mars 2026 | `onnx-community/harrier-oss-v1-270m-ONNX` | 270 M | ≈ 553 Mo (fp16) | 640 | 66,4 | MIT |
| **Gemini Embedding** (API) | juil. 2025 | `gemini-embedding-001` | non publié | 0 Mo | 768 | — | API Google |
| **Gemini Embedding 2** (API) | mars 2026 | `gemini-embedding-2` | non publié | 0 Mo | 768 | — | API Google |

\* Score public MTEB Multilingual Retrieval (18 tâches), d'après le tableau comparatif d'IBM (mai 2026). Indicatif : le
benchmark du POC sur le catalogue gift.cool reste la référence. Ce score est aussi affiché dans le comparateur. Pas de
score publié pour MiniLM L12 dans ce tableau.

\*\* Version quantifiée `q8`, sauf Harrier en `fp16` : ses versions `q8`, `q4` et `q4f16` utilisent l'opérateur
`GatherBlockQuantized`, absent du runtime WebAssembly d'onnxruntime (échec « Can't create a session »).

`intfloat/e5-base-v2` et `sentence-transformers/all-MiniLM-L6-v2` n'ont pas été retenus : ils ne fonctionnent qu'en
anglais. MiniLM L12 multilingue est la version multilingue de la même famille (pooling `mean`, aucun préfixe).

Réglages spécifiques : Granite R2 utilise le pooling **CLS** et aucun préfixe ; Harrier fonctionne comme
EmbeddingGemma (sortie `sentence_embedding`) avec une instruction en tête de chaque requête
(`Instruct: … \nQuery: `), les documents n'ayant pas de préfixe.

Un seul modèle est gardé en mémoire à la fois : en changer libère le précédent. Les modèles plus gros sont plus longs
à télécharger et à indexer. Les index calculés sont gardés dans **IndexedDB** (localStorage, limité à ~5 Mo, ne suffisait
plus pour 9 modèles ; les anciens index y sont migrés automatiquement). Le test « Le match » charge chaque modèle
coché à tour de rôle, puis revient au modèle choisi dans la barre de recherche.

**Ajouter un modèle** : un objet de plus dans `js/models.js` (dépôt, dtype, `pooling`, préfixes requête/document,
date de sortie `released`, score `mteb`, couleur ; `provider: 'gemini-api'` et `apiModel` pour un modèle Gemini).
Les modèles « sentence-transformers » classiques utilisent `mode: 'pipeline'` ; EmbeddingGemma et Harrier
utilisent `mode: 'sentence_embedding'`.

### Résultats du « Match » (octobre 2026)

Test sur les 30 demandes clients, Chromium sur Mac Apple Silicon, WebAssembly (`?device=wasm`). E5 Base et les modèles
Gemini n'ont pas été mesurés dans cette série. Les temps dépendent de l'appareil, les pourcentages non.

| Moteur | Bon univers du 1er coup | Enseignes pertinentes (top 3) | Médiane par recherche | p95 | Indexation (279 textes) | Poids |
|---|---|---|---|---|---|---|
| Mots-clés | 70 % | 59 % | 0,2 ms | 0,4 ms | 3 ms | 0 Mo |
| **MiniLM L12 multilingue** (défaut) | 80 % | 70 % | **20 ms** | 37 ms | 22 s | ≈ 118 Mo |
| E5 Small | 73 % | 68 % | 26 ms | 38 ms | 23 s | ≈ 118 Mo |
| Granite 97M R2 | 60 % | 62 % | 26 ms | 48 ms | 30 s | ≈ 98 Mo |
| Granite 311M R2 | 90 % | 81 % | 83 ms | 130 ms | 1 min 35 s | ≈ 313 Mo |
| Harrier 270M (fp16) | 83 % | 72 % | 194 ms | 289 ms | 1 min 30 s | ≈ 553 Mo |
| **EmbeddingGemma** | **100 %** | **87 %** | 192 ms | 325 ms | 1 min 52 s | ≈ 309 Mo |

- **MiniLM L12 multilingue** est le modèle par défaut : le plus rapide et le plus léger des modèles qui battent les
  mots-clés, devant E5 Small à poids égal.
- **EmbeddingGemma** est le plus pertinent (100 % de bon univers), mais il est 10 fois plus lent par recherche et ses
  vecteurs mettent près de 2 minutes à se calculer dans le navigateur (à pré-calculer côté serveur en production).
- **Granite 311M R2** est le meilleur compromis parmi les gros modèles (90 %, 83 ms).
- Les scores MTEB publics ne prédisent pas ce classement : Harrier (66,4) et Granite 97M (60,3) font moins bien
  que MiniLM, qui n'a pas de score publié.

#### Testé puis écarté : F2LLM v2 330M

[`codefuse-ai/F2LLM-v2-330M`](https://huggingface.co/codefuse-ai/F2LLM-v2-330M) (Ant Group / CodeFuse, mars 2026,
334 M paramètres, 896 dim., Apache 2.0) est très bien classé sur MTEB en français (66,0), mais n'existe qu'en poids
PyTorch : aucune version ONNX publiée pour transformers.js. Il a été converti en local pour ce test, puis écarté.

| Moteur | Bon univers du 1er coup | Enseignes pertinentes (top 3) | Médiane par recherche | p95 | Indexation (279 textes) | Poids |
|---|---|---|---|---|---|---|
| F2LLM v2 330M (8 bits) | 80 % | 78 % | 1,0 s | 1,7 s | 5 min 28 s | ≈ 360 Mo |

- Pertinence entre MiniLM et Granite 311M R2, mais **50 fois plus lent que MiniLM** et 5 fois plus lent
  qu'EmbeddingGemma, à taille comparable.
- La quantification int8 classique dégrade nettement ses vecteurs ; la variante précise (poids `MatMulNBits` 8 bits,
  embeddings int8) est lente en WebAssembly, et la version fp32 (1,3 Go) fait planter l'onglet.
- L'utiliser demanderait aussi de publier la conversion sur le Hub (le site ne charge que des modèles du Hub). Pour
  ce modèle : pooling sur le dernier jeton (EOS `<|im_end|>`, tokenizer complété à gauche), instruction
  `Instruct: … \nQuery: ` côté requête seulement.

### Modèles API (Gemini Embedding)

Les modèles Gemini Embedding ne sont **pas téléchargeables** : ils tournent uniquement sur les serveurs de Google.
Le POC les appelle directement depuis le navigateur avec **la clé API de l'utilisateur**, saisie dans la page
(création gratuite sur [Google AI Studio](https://aistudio.google.com/apikey)). La clé reste dans le navigateur
(localStorage) et n'est envoyée qu'à Google ; aucune clé n'est écrite dans le code, ce qui permet de publier le site
sur GitHub Pages sans l'exposer. Pour une démo publique, restreignez la clé à votre domaine dans la console Google Cloud.

- L'index des 279 textes est calculé une fois via l'API (par lots, au rythme du quota), puis mis en cache.
- Chaque recherche envoie la requête du client à Google (≈ 10 à 20 tokens) : l'interface l'indique clairement
  (statut, tuile « Requête envoyée à un serveur », badge **API** dans le test). Le temps affiché inclut le réseau.
- `gemini-embedding-001` utilise les types de tâche `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT` ;
  `gemini-embedding-2` utilise des préfixes dans le texte, comme EmbeddingGemma.
- En production, l'appel passerait par votre serveur (la clé ne doit pas être dans le navigateur des clients).

#### Quotas Google (clé gratuite)

Avec une clé gratuite, Google limite les embeddings à **≈ 100 textes par minute et ≈ 1 000 par jour, par projet
et par modèle**, et **chaque texte d'un appel groupé compte comme une requête**. Indexer les 279 textes d'un coup
dépasse donc la limite à la minute (erreur 429 « TooManyRequests »). Le POC :

- régule le débit (90 textes/min en gratuit) : l'indexation prend ≈ 3 min la première fois, puis l'index est en cache ;
- respecte le délai demandé par Google dans les erreurs 429, avec un compte à rebours affiché ;
- sauvegarde l'avancement : une indexation interrompue reprend là où elle s'était arrêtée, sans renvoyer les textes déjà traités ;
- s'arrête avec un message clair si le quota journalier est épuisé, et revient au modèle précédent ;
- affiche, avant le test, le nombre de requêtes que chaque modèle Gemini va consommer.

Dans la fenêtre de la clé, choisissez **« Facturation activée »** si la facturation est activée sur votre projet
Google : les quotas sont alors bien plus élevés et l'indexation prend quelques secondes (moins de 0,01 $ par index).
Les temps de réponse affichés excluent les pauses imposées par le quota.

## Publier sur GitHub Pages

1. Créer un dépôt et pousser le contenu de ce dossier sur la branche `main`.
2. *Settings → Pages → Build and deployment → Source : **GitHub Actions***.
3. Le workflow `.github/workflows/pages.yml` publie le site à chaque push (`https://<org>.github.io/<repo>/`).

Tous les chemins sont relatifs : le site marche aussi dans un sous-dossier.

## Architecture

```
index.html            page (habillage inspiré de gift.cool)
css/style.css
js/app.js             interface : recherche, rendu, carte passion, benchmark
js/models.js          registre des modèles d'IA proposés dans le sélecteur
js/gemini.js          appels à l'API Gemini Embedding (modèles cloud, clé de l'utilisateur, quotas)
js/idb.js             cache des index d'enseignes dans IndexedDB
js/semantic.js        moteur sémantique : pilote le worker, changement de modèle, cache de l'index, score hybride, carte passion
js/worker.js          Web Worker : transformers.js + modèle d'embeddings (le calcul ne bloque jamais l'interface)
js/keyword.js         recherche classique par mots-clés (référence pour la comparaison)
data/enseignes.json   catalogue d'enseignes
data/passions.json    les 19 cartes passion Gift.cool
```

**Fonctionnement.** Chaque enseigne (nom, description, univers, tags) et chaque carte passion est transformée en
vecteur (384 ou 768 dimensions selon le modèle), avec les préfixes propres à chaque modèle (`query:` / `passage:`
pour E5, `task: search result | query:` / `title: none | text:` pour EmbeddingGemma). La requête du client est vectorisée de la même façon. On classe les enseignes par similarité cosinus, avec un léger
bonus quand le client cite une enseigne par son nom (score hybride). La carte passion combine la similarité avec
la description de la carte et la force des 3 meilleures enseignes de l'univers.

### Paramètres d'URL (tests de performance)

| Paramètre | Défaut | Exemple |
|---|---|---|
| `model` | dernier choisi, sinon `minilm-multi` | `?model=e5-base`, `?model=gemma` (lien direct vers un modèle) |
| `device` | `wasm` | `?device=webgpu` (GPU, navigateurs compatibles ; plus rapide pour les gros modèles) |

La quantification (`dtype`) se règle par modèle dans `js/models.js` (`q8` par défaut ; `q4` possible pour EmbeddingGemma,
≈ 197 Mo ; `fp16` obligatoire pour Harrier en WebAssembly).

## Remplacer le catalogue

`data/enseignes.json` : un objet par enseigne.

```json
{ "id": "jardiland", "name": "Jardiland", "domain": "jardiland.com", "src": "gc",
  "passions": ["brico-deco", "animaux"], "tags": ["jardin", "plantes"],
  "desc": "Jardinerie et animalerie : plantes, semis, outillage de jardin…" }
```

- `passions` : slugs de `data/passions.json`.
- `desc` : c'est le texte qui compte le plus pour l'IA. Une à deux phrases concrètes sur ce qu'on y trouve.
- `src` : `gc` = enseigne citée sur les pages des cartes passion gift.cool, `ex` = ajoutée pour l'illustration.

Le catalogue fourni compte **260 enseignes réelles** : 90 relevées sur les pages des cartes passion de gift.cool,
170 enseignes connues hors réseau confirmé, ajoutées pour couvrir des sujets variés (high-tech, photo, voyage, parcs,
pêche, ski, golf, équitation, thé et café, couture, astronomie, seconde main…) et rendre les tests plus exigeants. Descriptions et rattachements sont indicatifs. À remplacer par
l'export réel du réseau (300+ enseignes). L'index se recalcule tout seul quand le catalogue change.

## Pistes pour la production

- **Pré-calculer l'index** des enseignes au build (même modèle) et le servir en JSON : le navigateur n'a plus qu'à
  vectoriser la requête.
- **Modèle plus léger** (q4, ou un modèle distillé pour le domaine) pour réduire le premier téléchargement sur mobile.
- **Chargement différé** : télécharger le modèle quand l'utilisateur met le focus sur la recherche, avec la recherche
  classique en attendant (déjà le cas ici).
- **Mesure** : suivre le taux de recherches sans clic et le taux de conversion par carte passion (A/B test mots-clés vs IA).

---
Démonstrateur non officiel. Logos d'enseignes affichés via leur favicon public ; visuels des cartes issus de gift.cool.
