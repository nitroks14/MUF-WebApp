# Changelog

Historique des versions du **Service Worker** de MUF-WebApp (PWA offline-first).

La version courante est définie par les constantes `CACHE_NOM` et `CACHE_PLUGINS`
dans [`service-worker.js`](./service-worker.js). Incrémenter la version invalide
l'ancien cache : à faire à chaque modification d'un asset précaché (CSS, JS, HTML
principal, libs, plugins).

Les versions sont listées de la plus récente à la plus ancienne.

---

## v69

- Dette technique post-Phase B (revue Tech Lead, sans régression fonctionnelle) :
  - `escapeHtml` réécrit en version **regex** (5 caractères : `&`, `<`, `>`, `"`,
    `'`, avec `&` échappé en premier) dans `js/client-autocomplete.js` et
    `js/client-learning.js`, en remplacement de l'ancienne version créant un
    élément DOM à chaque appel.
  - `parserMachineCombo` (`js/client-learning.js`) : documentation clarifiée de
    l'heuristique « 1er token = type, reste = numéro » et de sa limite. Aucun
    changement de comportement.
  - Historique des versions du Service Worker déplacé du bloc de commentaires de
    `service-worker.js` vers ce `CHANGELOG.md`.
  - Seuils Fuse documentés : permissif (0.4) en auto-complétion, strict (0.34,
    `SEUIL_FUSE_NOM`) en auto-apprentissage.
- Bump de cache requis car `js/client-autocomplete.js`, `js/client-learning.js` et
  `service-worker.js` changent. `CHANGELOG.md` n'est pas un asset runtime, donc
  pas précaché.

## v68

- Correction du bouton « Tout appliquer » du bandeau d'auto-apprentissage
  (`js/client-learning.js`, déjà précaché). « Tout appliquer » devient **atomique** :
  fusion de tous les items en UNE écriture `ClientsDB.put()` (au lieu de writes
  parallèles qui s'écrasaient), et le re-render déclenché par `clients-db-changed`
  est neutralisé pendant l'application en cours.
- Aucun nouvel asset.

## v67

- **Nouvel asset** `js/client-learning.js` : auto-apprentissage clients —
  proposition non bloquante d'ajout/MAJ en 1 clic, branchée dans les 4 plugins
  Demande d'OS / Calcul vide / Retour garantie / Liste de pièces. Les 4 plugins
  concernés changent mais sont déjà listés dans `ASSETS_PLUGINS`.

## v66

- Auto-complétion clients branchée dans le plugin **Liste de pièces** : mapping
  complet nom / code / contact / email / adresse + machine type / n° / année +
  multi-machines. `js/client-autocomplete.js` déjà précaché ; seul
  `plugins/liste-pieces/index.html` change (déjà listé dans `ASSETS_PLUGINS`).
- Aucun nouvel asset.

## v65

- Correction du placeholder du n° de garantie d'origine dans
  `plugins/retour-garantie/index.html` (déjà listé dans `ASSETS_PLUGINS`).
- Aucun nouvel asset.

## v64

- Auto-complétion clients branchée dans le plugin **Retour garantie**.
  `js/client-autocomplete.js` déjà précaché ; seul
  `plugins/retour-garantie/index.html` change (déjà listé dans `ASSETS_PLUGINS`).
- Aucun nouvel asset.

## v63

- Correction de la course au démarrage de l'auto-complétion clients dans
  `js/client-autocomplete.js` : re-render du menu ouvert dès que `ClientsDB` est
  prête. Corrige l'absence de suggestions dans Calcul vide ouvert à froid.
- Aucun nouvel asset.

## v62

- Carte « Client » de Calcul vide réduite à nom client + machine type + n° ;
  bloc PDF Identification condensé sur 1 ligne.
- Aucun nouvel asset.

## v61

- Auto-complétion clients branchée dans Calcul vide
  (`js/client-autocomplete.js` déjà précaché).
- Aucun nouvel asset.

## v60

- Libs de plugins **vendorisées** (offline complet) : jsPDF (calcul-vide /
  retour-garantie / aruco-marker), xlsx + ExcelJS (liste-pieces), Blockly
  (editeur-taxonomie). Précachées car chargées en lazy depuis la racine.
