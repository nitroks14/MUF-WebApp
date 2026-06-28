# Changelog

Historique des versions du **Service Worker** de MUF-WebApp (PWA offline-first).

La version courante est définie par les constantes `CACHE_NOM` et `CACHE_PLUGINS`
dans [`service-worker.js`](./service-worker.js). Incrémenter la version invalide
l'ancien cache : à faire à chaque modification d'un asset précaché (CSS, JS, HTML
principal, libs, plugins).

Les versions sont listées de la plus récente à la plus ancienne.

---

## v103

- **Assistant Cerveau → CHAT multi-tours.** Le plugin réservé
  `plugins/assistant-cerveau/index.html` passe d'un mode « coup par coup »
  (1 question → 1 réponse, sans mémoire) à une **interface de discussion** :
  fil de messages (bulles utilisateur + Assistant), saisie en bas (Entrée pour
  envoyer, Maj+Entrée = nouvelle ligne), bouton « Nouvelle conversation »,
  autoscroll, état de chargement « le Cerveau réfléchit… », et gestion d'erreur
  gracieuse dans le fil (sans perdre l'historique). Le rendu markdown léger
  anti-XSS (`escapeHtml` + `rendreMarkdownLeger`) est conservé.
- **`js/brain.js`** : `ask(question, options)` transmet désormais
  `options.historique` (tours précédents `{ role, content }`) dans le corps de
  `/v1/ask`, pour donner le contexte conversationnel au Cerveau. Rétro-compatible :
  sans historique, le corps est identique à l'existant. Timeout 30 s, JWT et
  repli offline inchangés.
- **Bump cache** : assets précachés modifiés (plugin + `brain.js`) →
  `CACHE_NOM` / `CACHE_PLUGINS` passés de `v102` à `v103`.

## v102

- **Phase 3 du Cerveau Multivac — UI `window.MUF.brain`.** Ajout du client
  Cerveau `js/brain.js` (wrapper HTTP sur l'API `/v1/ask` hébergée côté VM,
  joignable via tailnet) et du plugin réservé « Assistant Cerveau »
  (`plugins/assistant-cerveau/index.html`, gaté sur `MUF_CONFIG.BRAIN_OWNER_IDS`).
- **Bump cache** : `js/brain.js` et `plugins/assistant-cerveau/index.html`
  ajoutés au précache → `CACHE_NOM` / `CACHE_PLUGINS` passés de `v101` à `v102`.

## v101

- **Suppression de la lib Blockly orpheline** (`js/libs/blockly/`, ~1,1 Mo).
  Cette lib n'était utilisée que par l'éditeur de taxonomie embarqué, retiré en
  v100. Elle était devenue orpheline tout en restant précachée inutilement.
  Retraits :
  - Dossier `js/libs/blockly/` supprimé entièrement.
  - `service-worker.js` : asset `./js/libs/blockly/blockly.min.js` retiré de
    `ASSETS_STATIQUES` (+ commentaire mis à jour).
- **Bump cache** : liste de précache modifiée → `CACHE_NOM` / `CACHE_PLUGINS`
  passés de `v100` à `v101`.

## v100

- **Suppression de l'éditeur de taxonomie embarqué** (shell + plugin caché).
  L'édition de la taxonomie est désormais assurée par la PWA autonome
  `muf-ri-editor` (dépôt séparé). L'éditeur Blockly embarqué et son accès
  (roue dentée ambre `#taxo-gear-btn` + modale PIN `#taxo-lock-overlay`) étaient
  devenus un doublon. Retraits :
  - `index.html` : bouton `#taxo-gear-btn`, son CSS, la modale de verrouillage
    `#taxo-lock-overlay` + CSS associé, le script du PIN et du gear.
  - `js/app.js` : fonction `mettreAJourBoutonTaxo()`, route spéciale du hash
    `#editeur-taxonomie` dans `router()`, et tous les appels orphelins.
  - Dossier `plugins/editeur-taxonomie/` supprimé entièrement.
  - `service-worker.js` : asset `./plugins/editeur-taxonomie/index.html` retiré
    de `ASSETS_PLUGINS`.
  Le plugin `rapport-intervention` n'est pas impacté : il consomme la taxonomie
  via fetch GitHub, pas via l'éditeur embarqué.
- **Bump cache** : assets shell + liste de précache modifiés → `CACHE_NOM` /
  `CACHE_PLUGINS` passés de `v99` à `v100`.

## v99

- **Rapport d'intervention — type d'action « Mesure » (saisie de valeur numérique)**
  ([`plugins/rapport-intervention/index.html`](./plugins/rapport-intervention/index.html)).
  Nouveau type d'action `mesure` (libellé « Mesure ») destiné aux relevés
  chiffrés (tests de vide : vide max atteint en phase dynamique, perte de vide
  en phase statique, etc.). Pour une action `mesure`, la cellule affiche un
  champ numérique (`<input type="number" inputmode="decimal" step="any">`) suivi
  de l'unité issue de la taxonomie (`action.unite`), au lieu de la case à cocher
  + dropdown d'états. Les valeurs sont stockées dans `etat.mesures`
  (structure calquée sur `etat.etats`), persistées/restaurées dans le brouillon,
  prises en compte par `rapportEnCours()` et reportées dans une section
  « MESURES » du rapport généré (ex. `Vide max atteint (phase dynamique) : 2 mbar`).
  Contrat de données aligné avec l'éditeur muf-ri-editor (bloc action + unité).
- **Bump cache** : asset plugin modifié → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v98` à `v99`.

## v98

- **Calcul mise sous vide — harmonisation des accents du copy user-facing**
  ([`plugins/calcul-vide/index.html`](./plugins/calcul-vide/index.html)).
  Rétablissement des accents français corrects sur les chaînes affichées à
  l'utilisateur (titres, message d'invite, alertes d'erreur PDF) et sur les
  libellés/valeurs du rapport PDF généré (sections Source de vide, Roots,
  Configuration machine, Résultats, pied de page). Modification purement
  cosmétique : aucun identifiant technique (clés d'objet `machineType`, ids
  DOM, clés localStorage), ni logique de calcul, n'a été touché.
- **Bump cache** : asset plugin modifié → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v97` à `v98`.

## v97

- **Rapport d'intervention — Phase 4 : notification de mise à jour de la taxonomie**
  ([`plugins/rapport-intervention/index.html`](./plugins/rapport-intervention/index.html)).
  Le rafraîchissement en arrière-plan de la taxonomie (Phase 3) ré-appliquait la
  nouvelle version **en silence**, au risque de modifier les listes/états sous le
  technicien en pleine saisie. Désormais :
  - Si un **rapport est en cours** (machine sélectionnée, travaux/états/tests
    saisis — cf. `rapportEnCours()`), la nouvelle version est mémorisée
    (`taxoEnAttente`) et une **bannière discrète** non intrusive
    (`#ri-taxo-notice`, `role="status"` / `aria-live="polite"`) propose un bouton
    « Recharger la taxonomie ». L'application n'a lieu que sur action explicite,
    puis re-render via `appliquerMachine()` et masquage de la bannière.
  - Si **aucun rapport n'est en cours**, application directe + message de
    confirmation discret « Taxonomie mise à jour vX.Y.Z » (`afficherStatut`).
  - La bannière est un élément DOM dédié, distinct de `#ri-archive-status`, pour
    éviter tout conflit avec les messages transitoires (« Copié ! », etc.).
  - Robustesse offline conservée : le `.catch()` silencieux et le fallback inline
    sont inchangés.
- **Bump cache** : asset plugin modifié → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v96` à `v97`.

## v95

- **Lot « robustesse / dette technique » issu de la revue de code du 2026-06-10.**
- **Manifest** ([`manifest.json`](./manifest.json)) : dédoublement des icônes en
  entrées distinctes `purpose: "any"` et `purpose: "maskable"` (au lieu du
  `"any maskable"` combiné, ambigu pour certains navigateurs).
- **Helper partagé `escapeHtml`** : migration des implémentations locales
  dupliquées vers `window.MUF.escapeHtml` ([`js/utils.js`](./js/utils.js)) dans
  [`js/client-autocomplete.js`](./js/client-autocomplete.js),
  [`js/client-learning.js`](./js/client-learning.js) et
  [`plugins/clients/index.html`](./plugins/clients/index.html). La variante
  `escHtml` du rapport d'intervention (qui n'échappait pas l'apostrophe) est
  alignée par délégation au helper partagé.
- **Éditeur taxonomie** ([`plugins/editeur-taxonomie/index.html`](./plugins/editeur-taxonomie/index.html)) :
  remplacement de `btoa(unescape(encodeURIComponent(...)))` (push GitHub, cas
  nominal + retry 409) par un helper `encoderUTF8Base64` basé sur `TextEncoder`,
  symétrique du `decoderBase64UTF8` existant.
- **Service Worker** ([`service-worker.js`](./service-worker.js)) :
  `self.clients.claim()` chaîné dans le `waitUntil()` de l'event `activate`
  (après le nettoyage des caches) au lieu d'un appel hors cycle ; précache du
  template Excel de `liste-pieces`
  (`./plugins/liste-pieces/assets/Fichier%20de%20base%20liste%20PR.xlsx`),
  fetché à l'exécution → génération de fiche désormais possible offline même si
  le plugin n'a jamais été ouvert online. Stratégie de cache inchangée.
- **Anti-autofill** ([`js/anti-autofill.js`](./js/anti-autofill.js)) : le scan du
  `MutationObserver` est batché par frame (`requestAnimationFrame`, repli
  `setTimeout`) au lieu d'un scan par vague de mutations (coût sur DOM massif).
  Couverture identique ; mécanisme anti-autofill (token leurre, neutralisation
  du `name`) inchangé.
- **Base locale** ([`js/db.js`](./js/db.js)) : `remove()` fusionne sa lecture et
  son écriture dans une seule transaction `readwrite` (élimination de la fenêtre
  TOCTOU), sur le modèle de `markSynced`. Comportement (soft-delete, `_dirty`,
  notification) préservé.
- **Synchronisation** ([`js/sync-manager.js`](./js/sync-manager.js)) : le
  `lastSync` du cycle intègre désormais le `max(updated_at)` serveur des lignes
  pushées (réponse du `.select()` de l'upsert), garantissant qu'il couvre nos
  propres écritures et évitant un re-pull inutile. Garde de conflit et push H6
  inchangés.
- **Paramétrage** ([`js/parametrage.js`](./js/parametrage.js),
  [`plugins/parametrage/index.html`](./plugins/parametrage/index.html)) :
  `Parametrage.onChange` retourne une fonction de désinscription ; le plugin
  paramétrage la déclenche au démontage via `window.__paramCleanup` (pattern
  standard des autres plugins) pour éviter l'accumulation de listeners.
- **Bump cache** : assets shell/plugins modifiés → `CACHE_NOM` / `CACHE_PLUGINS`
  passés de `v94` à `v95`.

## v94

- **Calcul vide** ([`plugins/calcul-vide/index.html`](./plugins/calcul-vide/index.html)) :
  suppression de l'option `DN65` du sélecteur de diamètre d'arrivée vide. Elle
  réutilisait par erreur la valeur de `DN60` (`value="60"`). Décision : suppression
  pure (pas de correction de valeur). Aucune logique ne dépendait de cette option.
- **Retour garantie** ([`plugins/retour-garantie/index.html`](./plugins/retour-garantie/index.html)) :
  pagination multi-page de la section « À REMPLIR PAR LE TECHNICIEN » du PDF. Le
  contenu (pièces retournées, défaut, constat, footer) coule désormais proprement
  sur plusieurs pages au lieu d'être tronqué par jsPDF. Le label vertical bleu et
  les bordures latérales sont redessinés par page ; le footer date/signature n'est
  reporté que sur la dernière page. Le cas court (1 page) reste visuellement
  identique. La pagination profite à l'impression comme à l'e-mail `.eml` (PDF en
  PJ), `construirePDF` étant partagée. L'alerte de troncature (v93) est retirée.
- **Bump cache** : plugins modifiés → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v93` à `v94`.

## v93

- **Lot de correctifs « quick wins » issus de la revue de code du 2026-06-10.**
- **Calage embiellages** ([`plugins/calage-embiellages/index.html`](./plugins/calage-embiellages/index.html)) :
  refus d'une hauteur Y ≤ 0 (cote X théorique invalide) et ajout de gardes `null`
  dans `calculXtheorique()` (type/joint non cochés) pour éviter un crash sur état
  incohérent. La fonction renvoie désormais `null` dans ce cas, géré par l'appelant.
- **Demande d'OS** ([`plugins/demande-os/index.html`](./plugins/demande-os/index.html)) :
  la note des destinataires est désormais rafraîchie après `reinitialiser()` (un
  CC résiduel restait affiché). Mise à jour factorisée dans `majNoteDestinat()`,
  réutilisée par les écouteurs de saisie et le reset. Le chemin `.eml`/`ms-outlook://`
  n'est pas touché.
- **Liste de pièces** ([`plugins/liste-pieces/index.html`](./plugins/liste-pieces/index.html)) :
  toast informatif après import Excel (la date d'intervention et le descriptif
  court ne figurent pas dans le template et sont remis aux valeurs par défaut ;
  l'utilisateur est invité à les vérifier).
- **Calcul vide** ([`plugins/calcul-vide/index.html`](./plugins/calcul-vide/index.html)) :
  avertissement UX non bloquant quand un Roots est sélectionné alors que la cible
  est au-dessus de son seuil d'engagement (gain = 1, aucun bénéfice). Aucune
  formule ni constante de calibration modifiée.
- **Retour garantie** ([`plugins/retour-garantie/index.html`](./plugins/retour-garantie/index.html)) :
  avertissement de troncature (non bloquant) quand la section technicien dépasse
  la hauteur utile d'une page A4. La pagination multi-page reste à faire (chantier
  séparé). Rendu PDF inchangé.
- **Bump cache** : plugins modifiés → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v92` à `v93`.

## v87

- **Correction de régressions remontées en prod après le déploiement v2.0.0.**
- **Demande d'OS — réouverture d'Outlook (Windows).** `ouvrirBrouillonOutlook()`
  dans [`plugins/demande-os/index.html`](./plugins/demande-os/index.html) :
  suppression du flag `handled` (cassé : le clic du lien caché le passait
  toujours à `true`, neutralisant le fallback). Désormais une **seule** méthode
  de navigation par plateforme — clic sur `<a>` caché en iOS/iPadOS,
  `window.location.href` (qui ouvre Outlook desktop) sous Windows/desktop. Plus
  de double-fire de l'URI `ms-outlook://` sur iOS, et Outlook se rouvre sous
  Windows.
- **Brouillons .eml — corps texte invisible sous Outlook Windows.** Dans
  [`plugins/liste-pieces/index.html`](./plugins/liste-pieces/index.html) et
  [`plugins/retour-garantie/index.html`](./plugins/retour-garantie/index.html) :
  la partie `text/plain` passe de `Content-Transfer-Encoding: 8bit` à
  `quoted-printable` (nouvel helper `encoderQuotedPrintable`, soft-wrap 76 cols,
  CRLF préservés). Outlook affichait mal une partie 8bit UTF-8 accentuée.
- **Brouillons .eml — destinataires non repris sous Apple Mail.** Normalisation
  RFC 5322 des en-têtes `To:`/`Cc:` (séparateur `;` → `,`, espaces nettoyés) et
  en-tête `To:` omis s'il est vide (un `To:` vide perturbe le parsing). Voir
  *best-effort* : comportement Apple Mail sur .eml `X-Unsent` à confirmer côté
  utilisateur.
- **`encoderEnteteRFC2047` de retour-garantie aligné** sur la version robuste de
  liste-pieces (M6) : `TextEncoder` + découpage des encoded-words sous 75 chars.
- **Bump cache** : plugins modifiés → `CACHE_NOM` / `CACHE_PLUGINS` passés de
  `v86` à `v87`.

## v86

- **Version PRODUIT `2.0.0`.** Introduction d'une version produit en semver,
  distincte du compteur de cache du Service Worker. Source unique de vérité :
  la constante `APP_VERSION = '2.0.0'` en tête de [`js/app.js`](./js/app.js).
- **Badge de version dans la nav.** Affichage discret de `v2.0.0` en bas du
  drawer de navigation (`#nav-drawer`), injecté en JS depuis `APP_VERSION`
  (`textContent`, idempotent via l'`id` unique `app-version-badge` → pas
  d'empilement si la nav est reconstruite). Style atténué dans
  [`css/main.css`](./css/main.css) (`.app-version-badge`, gris/blanc atténué,
  `font-size-xs`, centré).
- **Bump cache** : assets du shell modifiés (`js/app.js`, `css/main.css`) →
  `CACHE_NOM` / `CACHE_PLUGINS` passés de `v85` à `v86`.

## v85

- **Correction des findings MEDIUM « code » de la revue 2026-06-10.**
- **[M1 / M11] `plugins/demande-os`** : les e-mails (`domEmailTo` / `domEmailCc`)
  et la valeur `email_maintenance` (Supabase `user_metadata`) sont désormais
  échappés via `window.MUF.escapeHtml` avant interpolation dans les trois
  `innerHTML` de la note destinataires — neutralise le XSS stocké.
- **[M9] `plugins/retour-garantie`** : même échappement dans `majNoteDestinat()`
  (déclenché aussi au chargement via `restaurerBrouillon()`).
- **[M10] `plugins/retour-garantie` + `plugins/liste-pieces`** : filtrage des
  CR/LF des en-têtes `To:`/`Cc:` des fichiers `.eml` (anti-injection d'en-têtes).
- **[M6] `plugins/liste-pieces`** : l'encoded-word RFC 2047 du sujet est découpé
  en chunks ≤ 45 octets (jointure `\r\n ` / folding), sans couper un caractère
  UTF-8 multi-octets ; `unescape()` déprécié remplacé par `TextEncoder`.
- **[M12] `plugins/demande-os`** : suppression du double-fire de l'URI
  `ms-outlook://` sur iOS (flag `handled` posé au clic, fallback à 300 ms
  seulement si non géré, `removeChild` sécurisé).
- **[M2] `js/auth.js`** : garde côté client du domaine `@multivac.fr` à
  l'inscription (défense en profondeur ; barrière réelle côté Supabase).
- **[M4] `js/sync-manager.js`** : retry avec backoff borné après échec de push
  (`min(30 s, tentative × 5 s)`, plafond 6 tentatives, compteur réinitialisé au
  succès et aux déclencheurs frais online/mutation/login).
- **[M5] `js/app.js`** : séquençage de `chargerPlugin()` (compteur `seq` +
  `AbortController`) pour éviter qu'un fetch lent écrase l'affichage d'une
  navigation plus récente.
- **[M8] `plugins/editeur-taxonomie` + `plugins/rapport-intervention`** :
  `TAXO_DEFAUT` aligné à l'identique sur la `TAXONOMIE` du rapport d'intervention
  (thermoformeuse enrichie, entrée debug « Essais taxonomie » supprimée) — évite
  qu'un Reset+Push depuis l'éditeur écrase les données riches du RI.

---

## v84

- **Correction des 9 findings HIGH de la revue de code 2026-06-10.**
- **Nouveau helper partagé `js/utils.js` (`window.MUF.escapeHtml`)** — échappe
  `& < > " '`, chargé dans le shell avant les autres scripts applicatifs. Ajouté
  au précache (`ASSETS_STATIQUES`). Destiné à factoriser l'échappement XSS.
- **[H9] `js/app.js`** : le nom de plugin issu de `location.hash` est désormais
  échappé avant interpolation dans les deux `innerHTML` (spinner + page d'erreur)
  de `chargerPlugin()` — neutralise `#plugin-<img src=x onerror=…>`.
- **[H1] `plugins/clients`** : le champ machine `pns: string[]` (auto-apprentissage
  / retour-garantie) n'était plus effacé à l'édition d'un client (fusion de la
  machine d'origine dans `lireMachines()`).
- **[H4] `plugins/clients`** : garde anti-résurrection si le client a été
  soft-delete à distance pendant que la modale d'édition était ouverte.
- **[H6] `js/sync-manager.js` + `js/db.js`** : `markSynced()` ne efface plus
  `_dirty` ni n'écrase `updated_at` si l'enregistrement a été ré-édité pendant le
  push réseau (empreinte `_snapshotLocalTs`).
- **[H3] `plugins/calage-embiellages`** : épaisseur de barre de calage exigée
  (> 0) avant calcul si la case est cochée.
- **[H8] `plugins/calcul-vide`** : correction du volume de cale en mode ArUco
  (`area × caleT` au lieu de `area × caleT²/depth`).
- **[H7] `service-worker.js`** : `strategieNavigation` replie sur le shell en
  cache sur réponse réseau non-OK (alignée sur `strategieNetworkFirst`).
- **[H5] `plugins/editeur-taxonomie`** : démontage du workspace Blockly à la
  navigation (`window.__taxoCleanup` : `dispose()` + retrait des listeners
  resize / click injectionDiv) — corrige fuite mémoire + double workspace.
- **[H2 / M7] `plugins/editeur-taxonomie`** : PAT GitHub déplacé en
  `sessionStorage` (effacé à la fermeture de l'onglet) + avertissement ;
  `JSON.parse` de la config protégé par try/catch.

---

## v83

- **Anti-autofill navigateur RÉELLEMENT robuste, factorisé (corrige le fix v82).**
  Le fix v82 (`autocomplete="off"`) était **insuffisant** : Chrome (desktop +
  Android) et Safari iOS **ignorent `autocomplete="off"`** pour leur autofill
  « profil » (email perso, adresses postales enregistrées, nom). Symptômes
  confirmés : email perso proposé sur le champ « À » et « Nom du binôme »,
  **autofill natif des profils d'adresse** sur le champ « Adresse », et autofill
  même sur des champs **`type="number"`** (calage-embiellages).
- **Technique retenue — token leurre dans `autocomplete`.** Chrome ne propose de
  valeurs que pour des champs dont `autocomplete` a une valeur **sémantique**
  reconnue (`email`, `name`, `street-address`, `off`…). En posant à la place un
  **token leurre aléatoire non reconnu** (ex. `nope-7f3a1c`), le navigateur ne
  sait plus à quel type de profil rattacher le champ et n'a donc **rien à
  proposer**. C'est ce jeton inconnu — et non `off` — qui coupe réellement
  l'autofill (réf. Chromium issue 40093420). Pour les champs les plus tenaces
  (email/nom/adresse), le `name` est **lui aussi** neutralisé par un leurre
  (l'original conservé dans `data-original-name`), car Chrome se rabat sur les
  heuristiques de `name`/`id`. S'ajoutent `autocorrect`/`autocapitalize`/
  `spellcheck="false"` + `data-lpignore`/`data-1p-ignore`/`data-form-type="other"`
  (gestionnaires de mots de passe).
- **Nouveau helper partagé `js/anti-autofill.js` (`window.AntiAutofill`)** —
  RÉFÉRENCE PROJET. `.apply(root)` / `.observe(root)` / `.protect(field)`.
  Applique le set complet sur tous les `input` texte/email/search/tel/url/
  number/password/date + `textarea` + `select`. **Exclut** radio/checkbox/file/
  hidden (pas d'autofill ; le `name` des radios pilote leurs groupes). Opt-out
  par `data-autofill-keep`. Idempotent.
- **`js/app.js`** : `chargerPlugin()` appelle `AntiAutofill.observe(appContent)`
  **avant** de ré-exécuter les scripts du plugin (le token est posé au montage),
  et un `MutationObserver` équipe ensuite les champs **ajoutés dynamiquement**
  (lignes de tableau liste-pieces / retour-garantie, blocs conditionnels révélés).
  Scopé sur `#app-content` : les formulaires d'auth du shell ne sont jamais touchés.
- **`js/client-autocomplete.js`** : la garde anti-autofill délègue désormais à
  `window.AntiAutofill.protect()` (token leurre) au lieu de réécrire
  `autocomplete="off"` — qui écrasait la protection sur les champs « nom client »
  (`#dos-client`, `#brg-client`, `#cv-client`, `#lp-clientName`), parmi les plus
  exposés. Repli sur l'ancien set si le helper est absent. L'auto-complétion
  clients (liste déroulante VOULUE) continue de fonctionner à l'identique.
- **Couverture vérifiée (Chrome headless, DOM rendu)** : demande-os 13/13,
  retour-garantie 17/17, clients 6/6, calcul-vide 23/23 (champs numériques inclus),
  liste-pieces 18/18 (lignes de tableau dynamiques incluses), calage-embiellages
  6/6 (numériques), rapport-intervention 1/1, parametrage 1/1,
  editeur-taxonomie 6/6. ClientAutocomplete : menu + suggestions OK. Zéro erreur
  console. **Limite** : Chrome headless n'ayant pas les profils d'adresse/email
  de l'utilisateur, la validation finale de la disparition de l'autofill natif se
  fait côté terrain.
- **Hors-scope, intentionnellement non modifié** : formulaires d'auth du shell
  (`index.html`) — `autocomplete` sémantiques conservés (autofill voulu) ;
  feature « Emails fréquents » de demande-os (puces cliquables) — intacte.
- Bump de cache requis : ajout de `js/anti-autofill.js` au précache et
  modification de `js/app.js` + `js/client-autocomplete.js` (assets précachés).

---

## v82

- **Uniformisation de l'anti-autofill navigateur (données perso du technicien).**
  Symptôme rapporté : certains plugins laissaient le navigateur proposer
  l'email / le prénom / le nom de l'utilisateur dans des champs de formulaire
  (autofill de la fiche perso), de façon **incohérente** d'un plugin à l'autre.
  La convention du projet (`autocomplete="off"`) était déjà appliquée partout
  **sauf** sur 5 champs, désormais alignés.
- **`plugins/retour-garantie/index.html`** : ajout de `autocomplete="off"` sur
  `#brg-technicien` (champ « Prénom Nom » — cas le plus exposé à l'injection du
  nom de l'utilisateur), ainsi que sur les textarea `#brg-defaut` et `#brg-constat`.
- **`plugins/calcul-vide/index.html`** : ajout de `autocomplete="off"` sur
  `#cv-client` et `#cv-machine`. `#cv-client` est piloté par
  `window.ClientAutocomplete`, qui repositionne déjà l'attribut au runtime ;
  le poser dans le HTML statique évite toute fuite avant l'attach et rend la
  règle cohérente au montage.
- **Hors-scope, intentionnellement non modifié** : les formulaires
  d'authentification du shell (`index.html` : inscription / connexion /
  réinitialisation) conservent leurs `autocomplete` sémantiques
  (`email`, `given-name`, `family-name`, `current-password`, `new-password`) —
  l'autofill y est **voulu**. L'auto-complétion *clients* de l'app
  (`window.ClientAutocomplete` / `window.ClientLearning`) n'est pas affectée :
  elle est gérée en JS, pas par l'autofill navigateur.
- Bump de cache requis car des assets précachés changent
  (`plugins/retour-garantie/index.html`, `plugins/calcul-vide/index.html`).

---

## v81

- **Nettoyage de dette technique (audit conservateur, sans régression).** Aucun
  changement de comportement fonctionnel ; cohérence, code mort et commentaires.
- **`js/aruco-vision.js`** : suppression de la fonction **`findCandidateRects`**,
  définie mais jamais appelée (code mort — `detectMarkers` fait son propre scan de
  candidats en interne).
- **`js/aruco-marker.js`** : correction du commentaire d'en-tête erroné
  (« 50 marqueurs » → **100 marqueurs, ID 0-99**), conforme au dictionnaire
  `DICT_5X5_100` réellement encodé et à la doc de `generate(id)`.
- **`plugins/clients/index.html`** : `escapeHtml` réécrit en version **regex**
  (5 caractères : `&` en premier, puis `<`, `>`, `"`, `'`), **aligné** sur
  `js/client-autocomplete.js` et `js/client-learning.js` (déjà migrés en v69).
  Supprime la création d'un élément DOM à chaque appel et échappe désormais aussi
  les guillemets (sur-ensemble : aucune régression sur les usages en contenu).
- **`js/db.js`** : commentaire du modèle client mis à jour — `machines` porte aussi
  un tableau optionnel `pns` (`Array<{ type, numero, annee?, pns?: string[] }>`),
  reflétant l'ajout de PN par l'auto-apprentissage.
- **`js/parametrage.js`** : commentaire `emails_frequents` mis à jour
  (`{ label, adresse, prenom? }`, le `prenom` optionnel ayant été ajouté en v77).
- Bump de cache requis car des assets précachés changent (`plugins/clients/index.html`,
  `js/aruco-vision.js`, `js/aruco-marker.js`, `js/db.js`, `js/parametrage.js`).
  `CHANGELOG.md` n'est pas un asset runtime, donc pas précaché.

---

## v80

- **Plugin Demande d'OS — champ « Nom du technicien 2 » n'est plus obligatoire**
  en cas d'OS splitté (technicien 1 reste requis) ; corps du mail adapté quand
  un seul technicien est renseigné (« Technicien : X » au lieu de « Techniciens :
  X et  » avec un « et » orphelin).

---

## v79

- **Plugin Liste de pièces — objet du mail désormais transmis correctement**
  (repli `.eml` sur desktop + encodage **RFC 2047** de l'objet), cohérent avec
  le correctif Retour garantie v78. Sur desktop (PC Windows), l'envoi passe
  systématiquement par le repli `.eml` (Web Share réservé à iOS/iPadOS, seule
  plateforme transmettant l'objet à Outlook) ; l'objet est encodé en RFC 2047
  pour gérer les accents et le tiret cadratin « — ».

---

## v78

- **Plugin Retour garantie — objet du mail désormais transmis correctement.**
  Sur desktop (PC Windows), l'envoi passe systématiquement par le repli `.eml`
  (Web Share réservé à iOS/iPadOS, seule plateforme transmettant l'objet à
  Outlook) ; l'objet est en outre encodé en **RFC 2047** pour gérer les accents
  et le tiret cadratin « — ».
- **Plugin Retour garantie — suppression de la signature du corps.** La ligne
  « Cordialement, [technicien] » est retirée afin de laisser la signature
  automatique d'Outlook s'appliquer.

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
