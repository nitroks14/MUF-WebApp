# Changelog

Historique des versions du **Service Worker** de MUF-WebApp (PWA offline-first).

La version courante est définie par les constantes `CACHE_NOM` et `CACHE_PLUGINS`
dans [`service-worker.js`](./service-worker.js). Incrémenter la version invalide
l'ancien cache : à faire à chaque modification d'un asset précaché (CSS, JS, HTML
principal, libs, plugins).

Les versions sont listées de la plus récente à la plus ancienne.

---

## v77

- **Plugin Liste de pièces — libellé du champ date.** « Date intervention »
  devient **« Date prévue de l'intervention »** (label du formulaire et message
  de validation associé).
- **Plugin Liste de pièces — nouveau corps de l'e-mail d'envoi.** Corps simplifié,
  tutoiement, sans signature manuelle (la signature automatique d'Outlook prend le
  relais) : « Bonjour [Prénom], / Tu trouveras ci-joint la liste de pièces pour
  l'intervention [descriptif court] prévue le [JJ.MM.AAAA]. ». Le **prénom du
  destinataire** est injecté lorsqu'un email fréquent est sélectionné via un chip
  (fallback « Bonjour, » si saisie manuelle ou prénom inconnu). Vaut pour Web Share
  et pour le repli `.eml`.
- **Page Paramétrage — champ « Prénom » sur les emails fréquents.** Chaque email
  fréquent porte désormais un prénom optionnel `{ label, adresse, prenom }`, saisi
  via un input dédié. Compatibilité ascendante assurée : les entrées existantes
  sans `prenom` restent valides (même clé de stockage, même persistance Supabase).
- Bump de cache requis pour invalider l'ancien cache (modification des plugins
  `liste-pieces` et `parametrage`).

---

## v76

- **Correctif de régression — affichage cassé au lancement (page Accueil).**
  Après la refonte de la navigation (commits `47566d7` / `f4651f8`), certains
  utilisateurs voyaient au démarrage le bloc « Multivac FR » (logo + chevron)
  flotter, non stylé, en haut à gauche, par-dessus le titre « Accueil », avec une
  page d'accueil **vide** (aucune tuile).
- **Cause racine** : désynchronisation de cache du Service Worker. `index.html`
  était servi en **network-first** (toujours frais) tandis que `css/main.css` et
  `js/app.js` étaient servis en **cache-first**. Après une mise à jour, le nouvel
  `index.html` (markup `.app-header` / `.app-logo` / `.plugin-grid`) pouvait être
  rendu avec un **ancien** `css/main.css` (qui ne stylait que l'ancien `.sidebar`)
  et un ancien `js/app.js` → header non stylé + accueil non rendu. Le précache
  résilient masquait par ailleurs les échecs de mise en cache, aggravant le cas.
- **Correctif (à la racine)** dans `service-worker.js` :
  - Le **shell applicatif** (`index.html`, `css/*.css`, scripts `js/*.js`) passe
    en **network-first** avec repli cache hors-ligne : HTML, CSS et JS du shell
    restent toujours servis dans la **même version cohérente**.
  - Les **libs vendorisées** (`js/libs/**`, immuables entre déploiements) restent
    en **cache-first** : démarrage instantané et offline garantis.
  - `strategieNetworkFirst` se replie désormais sur le cache aussi quand la
    réponse réseau n'est **pas valide** (404 / 5xx / page d'erreur de l'hébergeur),
    et plus seulement en cas d'échec réseau.
- Aucune modification de `index.html`, `css/main.css` ni `js/app.js` : le code du
  shell était déjà correct ; seule la stratégie de cache était en cause.
- Bump de cache requis pour invalider l'ancien cache et déployer la nouvelle
  stratégie.

## v75

- **Nettoyage de dette technique** sur la navigation repliable (suite des commits
  `47566d7` + `f4651f8`). **Aucun changement de comportement** (refactor / cosmétique).
- **Wording des commentaires** : la grille des onglets du drawer était décrite à
  tort comme « flex-wrap » alors qu'elle s'appuie sur **CSS Grid**
  (`grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`). Corrigé dans
  `index.html` et `css/main.css`.
- **`css/main.css`** : `auto-fill` → **`auto-fit`** sur la grille du drawer
  (`.nav-drawer-grid`) et la grille d'accueil (`.plugin-grid`), pour éviter les
  colonnes fantômes si le nombre de modules diminue. Comportement identique avec
  le nombre d'onglets actuel.
- **Suppression de la valeur magique 300ms** : la durée d'animation du drawer est
  désormais portée par la CSS custom property **`--drawer-anim`** (`:root`, utilisée
  par la transition `max-height`) et par la constante JS **`DRAWER_ANIM_MS`**
  (`js/app.js`), documentées comme devant rester synchronisées. Le `setTimeout` en
  dur est remplacé par cette constante.
- Bump de cache requis car `index.html`, `css/main.css` et `js/app.js` (précachés)
  changent.

## v74

- **Correctif PWA standalone iOS — chevauchement du header avec la barre d'état**
  (iPhone et iPad). En mode PWA installée (« Sur l'écran d'accueil »), avec
  `apple-mobile-web-app-status-bar-style: black-translucent` + `viewport-fit=cover`,
  la web-view occupe tout l'écran sous la barre d'état iOS. Le contenu de
  `.app-header` (logo Multivac, badge FR, chevron, titre) se superposait à
  l'heure / au % batterie / au wifi.
- **`.app-header`** (`css/main.css`) : ajout de `padding-top: max(6px,
  env(safe-area-inset-top))` (+ `padding-bottom: 6px` explicite) pour décaler le
  contenu sous la barre d'état tout en laissant le fond bleu `#003A70` remonter
  derrière (effet app natif). `min-height` conservé pour la hauteur de la zone
  interactive.
- **`.nav-drawer`** (`css/main.css`) : `top` passé de `var(--header-height)` à
  `calc(var(--header-height) + env(safe-area-inset-top))` pour que le drawer
  s'ouvre juste sous le header réel (safe-area incluse) et non sous la barre
  d'état.
- **Sans régression** : sur desktop / Android, `env(safe-area-inset-top)` vaut 0
  → `max(6px, …)` et le `calc(...)` redonnent exactement l'ancien comportement.
- Bump de cache requis car `css/main.css` (précaché) change.

## v73

- **Navigation repliable (collapsible) sur tous les appareils** (PC, iPad, iPhone).
  Refonte du shell de navigation (`index.html`, `css/main.css`, `js/app.js`) :
- L'ancienne **sidebar desktop** + **bottom-nav mobile** sont remplacées par un
  **header unifié** (charte Multivac `#003A70`, texte blanc) et un **drawer de
  navigation repliable** qui se déplie **depuis le haut**, sous le header.
  Comportement **identique** sur tous les écrans.
- **Le logo Multivac (haut-gauche) est le déclencheur** : un appui déplie la
  barre, un nouvel appui la replie (`<button id="nav-toggle">`). Un **chevron**
  blanc accolé au logo signale la fonction et **reflète l'état** (rotation 180°
  animée à la transition).
- **Accessibilité** : zone de tap ≥ 44px sur le logo, `aria-expanded` synchronisé
  avec l'état, `aria-controls` vers le drawer, `aria-current="page"` sur l'onglet
  actif, fermeture à la touche Échap + voile cliquable.
- **Alignement multi-lignes** : les 8 onglets sont disposés dans une **grille
  responsive (CSS Grid)** (`auto-fit, minmax(150px, 1fr)`) avec libellés autorisés à passer
  à la ligne (`overflow-wrap`) — fini les libellés tronqués/illisibles sur iPhone
  (~390px). Prise en compte des encoches (`env(safe-area-inset-*)`).
- **Repère du plugin actif toujours visible**, même barre repliée : le nom du
  module courant reste affiché dans le header (`#header-title`).
- Respect de `prefers-reduced-motion` (animations désactivées si demandé).
- Bump de cache requis car `index.html`, `css/main.css` et `js/app.js` (précachés)
  changent.

## v72

- **UX auto-apprentissage** (`js/client-learning.js`), 2 corrections sur le cas
  « nouveau client » (suite aux retours de test) :
- **Titre du bandeau contextuel** : il était figé à « Mettre à jour la base
  clients ? » même pour une création. Il est désormais calculé selon les `kind`
  des items affichés :
  - au moins un item `create` (nouveau client) → **« Nouveau client — l’ajouter
    à la base ? »** ;
  - sinon, tous les items sont des ajouts à une fiche existante (`add-machine` /
    `add-pn`) → **« Compléter la fiche client ? »** ;
  - sinon (présence d’un `update`, éventuellement mêlé d’ajouts) → **« Mettre à
    jour la base clients ? »** (inchangé).
- **Indicateur « nouveau client » guidant et persistant** : au lieu d’un simple
  « Nouveau client » qui clignotait 3 cycles puis disparaissait, l’indicateur
  affiche désormais **« Nouveau client — remplir tous les champs pour l’ajouter »**
  et reste **visible en continu** (sans clignotement répété, non intrusif) tant
  que le nom est non vide, le client non reconnu et le formulaire incomplet —
  rappel utile car la proposition d’ajout est gardée par `estComplet()`. Il
  disparaît automatiquement dès que le formulaire est complété (le bandeau
  « Ajouter » prend le relais) ou que le nom correspond à un client connu.
  L’indicateur « Client connu » reste bref et inchangé.
- Mise en œuvre : `afficherHint(estNouveau, complet)` (mode persistant via classe
  CSS `mcl-hint-persist` qui désactive l’animation de clignotement), `masquerHint()`
  et `rafraichirHint()` appelée sur changement des champs base pour réévaluer
  l’état. Aucune modification de la détection, de la dédup, du gate création/client
  connu (v71), de l’application 1 clic, du « Tout appliquer » ni du déclenchement
  blur/change.
- Bump de cache requis car `js/client-learning.js` (précaché) change.

## v71

- Correction d'un **effet de bord du fix anti-contamination v70** : l'auto-
  apprentissage ne proposait plus de **mise à jour** quand on modifiait un seul
  champ d'un **client connu** « pauvre ». Cause racine : dans
  `js/client-learning.js`, `evaluate()` faisait `if (!estComplet()) return;`
  AVANT tout calcul, où `estComplet()` exige que TOUS les champs base du plugin
  soient remplis. Depuis le vidage des champs absents (v70), un client dépourvu
  d'un champ requis (ex. WHAT'S COOKING FRANCE sans email, requis par Liste de
  pièces) ne passait plus ce gate → aucune proposition, même en saisissant un
  autre champ (le contact).
- Correctif : **dissociation « client connu » / « nouveau client »** dans
  `evaluate()`. La référence (`chercherReference`) est désormais calculée AVANT
  le gate. Pour un **client connu**, les diffs (maj scalaire / ajout machine /
  ajout PN) sont proposés SANS exiger la complétude globale ; chaque item reste
  conditionné à un champ réellement saisi ET différent de la base
  (`if (!saisi) return;` inchangé). Pour un **nouveau client**, la complétude
  (`estComplet()`) reste exigée avant de proposer la création.
- `calculerPropositions` séparait déjà parfaitement le cas création (ref nulle)
  des cas update/ajout (ref connue) : inchangé.
- Non-régression : changement de client (A puis B) sans saisie ⇒ aucun bandeau
  (champs absents vidés en v70, scalaires vides sans item) ; dédup par signature
  conservée ; évaluation toujours sur blur/change uniquement.
- Bump de cache requis car `js/client-learning.js` (précaché) change.

## v70

- Correction de la **contamination croisée des champs client** au changement de
  client via l'auto-complétion (et du **faux positif d'auto-apprentissage** qui en
  découlait). Cause racine : dans le callback `onSelect` (`appliquerClient`) des
  plugins, le pré-remplissage ne posait une valeur QUE si le client la possédait.
  En changeant pour un client B dépourvu de certains champs (contact / email /
  code client / machine), ceux-ci conservaient les valeurs du client A précédent.
  L'auto-apprentissage comparait alors le formulaire (B + résidus de A) au client B
  et proposait à tort une « mise à jour » de B avec les données de A.
- Correctif : **remplacement COMPLET** des champs client/machine mappés à la
  sélection (`champ.value = client.<prop> || ''`), y compris vidage de la machine
  si le client n'en a aucune. Appliqué aux 4 plugins concernés :
  - `plugins/liste-pieces/index.html` : code client, contact, email, adresse,
    machine (type / n° / année).
  - `plugins/demande-os/index.html` : contact, machine (combinée).
  - `plugins/calcul-vide/index.html` : machine.
  - `plugins/retour-garantie/index.html` : machine (type + n°).
- Non touchés : technicien (vient de `user_metadata`), lignes de pièces, type de
  demande, dates, descriptif. Les cas légitimes d'auto-apprentissage restent
  fonctionnels (édition manuelle d'un champ après sélection).
- Bump de cache requis car les 4 `plugins/*/index.html` (précachés) changent.

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
