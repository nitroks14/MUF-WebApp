/**
 * MUF-WebApp — Auto-apprentissage clients (module partagé réutilisable)
 *
 * Quand un technicien saisit, dans un plugin, un client / une machine / un champ
 * qui diffère du référentiel local (window.ClientsDB), ce module lui propose
 * **sans bloquer** de mettre à jour la base clients, applicable en **1 clic**.
 * Toute écriture passe par ClientsDB → la synchronisation Supabase se déclenche
 * automatiquement via le SyncManager (offline-first : marche hors-ligne, push au
 * retour online). Aucun appel réseau direct ici.
 *
 * Philosophie (décisions PO — strictes) :
 *   1. Indicateur précoce : au BLUR du champ « nom client », une petite info
 *      clignote brièvement sous le champ (« nouveau client » / « client connu »).
 *      Discret, non bloquant, aucune modale.
 *   2. Proposition différée : la/les proposition(s) n'apparaissent QUE lorsque
 *      TOUS les champs « base » utilisés par le plugin courant sont remplis
 *      (condition fournie par le plugin). JAMAIS pendant la frappe. Affichage en
 *      bandeau/toast non bloquant en bas d'écran.
 *   3. Deux natures :
 *        - Modification d'un champ scalaire existant qui a changé
 *          (contact / email / adresse / code_client) → proposer une MAJ.
 *        - Ajout pour machines et PN (jamais d'écrasement) → AJOUT à la liste.
 *   4. Application en 1 clic → écriture ClientsDB → sync auto. Confirmation brève.
 *      Possibilité d'ignorer/fermer. On ne repropose PAS la même chose en boucle
 *      dans la même session si l'utilisateur ignore (dédup par « signature »).
 *
 * Le module est GÉNÉRIQUE : un plugin déclare, via attach(config), ses sélecteurs
 * et le rôle de chaque champ ; aucun couplage en dur à un plugin donné.
 *
 * API publique — window.ClientLearning :
 *
 *   .attach(config) → controller
 *     config : {
 *       prefix          : string   (préfixe unique du plugin, ex. 'lp', 'dos'…)
 *       fields : {                  (au moins « nom » est requis)
 *         nom           : 'css-selector' | HTMLElement,
 *         contact       : ...,      (scalaire — MAJ)
 *         email         : ...,      (scalaire — MAJ)
 *         adresse       : ...,      (scalaire — MAJ)
 *         code_client   : ...,      (scalaire — MAJ)
 *         machineType   : ...,      (AJOUT machine — champ séparé)
 *         machineNumber : ...,      (AJOUT machine — champ séparé)
 *         machineYear   : ...,      (AJOUT machine — champ séparé, optionnel)
 *         machineCombo  : ...,      (AJOUT machine — champ unique « type n° »)
 *         pn            : ...,      (AJOUT pn rattaché à la machine)
 *       },
 *       isComplete()    : () => boolean   condition « tous les champs base remplis »
 *       getReferenceId():() => string|null  id du client sélectionné via l'autocomplete
 *                                            (haute confiance), sinon null → matching nom.
 *     }
 *     Retourne un controller :
 *       .evaluate()  → ré-évalue manuellement (utile après application 1 clic).
 *       .destroy()   → détache écouteurs, masque le bandeau.
 *
 * Le module se recharge sur l'événement `clients-db-changed` pour refléter les
 * ajouts/MAJ (les siens comme ceux du sync).
 *
 * Seuils de matching (documentés) :
 *   - Référence par id (autocomplete) : confiance maximale, pas de fuzzy.
 *   - Sinon matching du nom : on normalise (minuscules + sans accents + espaces
 *     compactés). Match EXACT normalisé → client connu (réf). Si Fuse est dispo,
 *     un meilleur score Fuse ≤ 0.34 (sur le nom uniquement) compte aussi comme un
 *     match fort. Au-delà → « nouveau client ». Seuil volontairement strict :
 *     mieux vaut proposer « nouveau client » à tort (action explicite ensuite)
 *     que de proposer une MAJ sur le mauvais client.
 */

'use strict';

(function () {

  var EVENT_CHANGE = (window.ClientsDB && window.ClientsDB.EVENT_CHANGE) || 'clients-db-changed';

  /* Seuil de score Fuse (0 = identique, 1 = aucun rapport) au-delà duquel on ne
     considère plus un nom comme « connu ».
     STRICT volontairement (0.34, < 0.4 de l'auto-complétion) : ici un match
     déclenche une PROPOSITION D'ÉCRITURE en base (MAJ contact/email/adresse… ou
     ajout machine) rattachée à CE client. Un faux positif attribuerait la mise à
     jour au mauvais client. On préfère donc afficher « nouveau client » à tort
     (l'utilisateur agira explicitement) plutôt que de matcher trop largement.
     À comparer avec le seuil PERMISSIF 0.4 de client-autocomplete.js, où la
     suggestion est sans conséquence tant que l'utilisateur ne clique pas. */
  var SEUIL_FUSE_NOM = 0.34;

  /* ----------------------------------------------------------
     Normalisation (identique à client-autocomplete.js / plugin Clients) :
     minuscules + suppression accents + compactage des espaces.
     ---------------------------------------------------------- */
  function normaliser(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') /* diacritiques combinants */
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Échappement HTML par regex (pas de DOM créé à chaque appel — module
     indépendant, dupliqué à l'identique dans client-autocomplete.js).
     Les 5 caractères sensibles sont échappés ; « & » EN PREMIER pour ne pas
     ré-échapper les entités qu'on vient d'introduire. */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ----------------------------------------------------------
     Styles injectés une seule fois (charte via variables main.css).
     ---------------------------------------------------------- */
  var STYLE_ID = 'mcl-learning-styles';
  function injecterStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      /* --- Indicateur précoce (sous le champ nom) --- */
      '.mcl-hint {',
      '  display: block; margin-top: 4px;',
      '  font-size: var(--font-size-sm, 0.875rem);',
      '  font-family: var(--font-family, sans-serif);',
      '  font-weight: 600; line-height: 1.2;',
      '  opacity: 0; transition: opacity 0.25s ease;',
      '  pointer-events: none;',
      '}',
      '.mcl-hint.mcl-hint-show { opacity: 1; animation: mcl-blink 0.6s ease-in-out 2; }',
      '.mcl-hint-new   { color: #b45309; }',  /* ambre Multivac (nouveau) */
      '.mcl-hint-known { color: #047857; }',  /* vert (connu) */
      '@keyframes mcl-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }',

      /* --- Bandeau de propositions (non bloquant, bas d'écran) --- */
      '.mcl-banner {',
      '  position: fixed; left: 50%; transform: translateX(-50%) translateY(20px);',
      '  bottom: 84px; z-index: 9500;',
      '  width: calc(100% - 24px); max-width: 460px;',
      '  background: var(--color-surface, #fff);',
      '  border: 1px solid var(--color-border, #e0e0e0);',
      '  border-left: 4px solid var(--color-primary, #003A70);',
      '  border-radius: var(--radius, 6px);',
      '  box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,0.18));',
      '  font-family: var(--font-family, sans-serif);',
      '  color: var(--color-text, #333);',
      '  opacity: 0; pointer-events: none;',
      '  transition: opacity 0.25s ease, transform 0.25s ease;',
      '  overflow: hidden;',
      '}',
      '.mcl-banner.mcl-banner-show { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }',
      '.mcl-banner-head {',
      '  display: flex; align-items: center; gap: 8px;',
      '  padding: 10px 12px 6px;',
      '}',
      '.mcl-banner-title {',
      '  flex: 1; font-weight: 700; font-size: var(--font-size-sm, 0.875rem);',
      '  color: var(--color-primary, #003A70);',
      '}',
      '.mcl-banner-close {',
      '  background: transparent; border: none; cursor: pointer;',
      '  color: var(--color-text-muted, #666); font-size: 20px; line-height: 1;',
      '  padding: 4px 8px; border-radius: var(--radius, 6px);',
      '  min-width: 32px; min-height: 32px;',
      '}',
      '.mcl-banner-close:hover { background: var(--color-bg, #f5f5f5); }',
      '.mcl-banner-list { list-style: none; margin: 0; padding: 0 12px 6px; }',
      '.mcl-banner-item {',
      '  display: flex; align-items: center; gap: 10px;',
      '  padding: 8px 0; border-top: 1px solid var(--color-border, #e0e0e0);',
      '}',
      '.mcl-banner-item:first-child { border-top: none; }',
      '.mcl-item-text { flex: 1; font-size: var(--font-size-sm, 0.875rem); word-break: break-word; }',
      '.mcl-item-text small { display: block; color: var(--color-text-muted, #666); font-weight: 400; }',
      '.mcl-item-text strong { color: var(--color-primary, #003A70); }',
      '.mcl-item-btn {',
      '  flex-shrink: 0; cursor: pointer;',
      '  background: var(--color-primary, #003A70); color: #fff; border: none;',
      '  border-radius: var(--radius, 6px); font-family: inherit;',
      '  font-size: var(--font-size-sm, 0.875rem); font-weight: 600;',
      '  padding: 8px 12px; min-height: 36px; white-space: nowrap;',
      '  -webkit-tap-highlight-color: transparent; transition: background 0.15s;',
      '}',
      '.mcl-item-btn:hover { background: var(--color-primary-dark, #002850); }',
      '.mcl-item-btn[disabled] { background: #047857; cursor: default; opacity: 0.9; }',
      '.mcl-banner-foot { padding: 6px 12px 12px; text-align: right; }',
      '.mcl-all-btn {',
      '  cursor: pointer; background: transparent;',
      '  color: var(--color-primary, #003A70); border: 1px solid var(--color-primary, #003A70);',
      '  border-radius: var(--radius, 6px); font-family: inherit;',
      '  font-size: var(--font-size-sm, 0.875rem); font-weight: 600;',
      '  padding: 7px 12px; min-height: 36px;',
      '}',
      '.mcl-all-btn:hover { background: var(--color-bg, #f5f5f5); }',
      '@media (max-width: 767px) { .mcl-banner { bottom: 74px; } }',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ----------------------------------------------------------
     Bandeau global unique (partagé par tous les plugins — un seul à l'écran).
     ---------------------------------------------------------- */
  var bannerEl = null;
  var bannerListEl = null;
  var bannerTitleEl = null;
  var bannerFootEl = null;
  var bannerHideTimer = null;

  function construireBanner() {
    if (bannerEl) return;
    injecterStyles();

    bannerEl = document.createElement('div');
    bannerEl.className = 'mcl-banner';
    bannerEl.setAttribute('role', 'status');
    bannerEl.setAttribute('aria-live', 'polite');

    var head = document.createElement('div');
    head.className = 'mcl-banner-head';
    bannerTitleEl = document.createElement('span');
    bannerTitleEl.className = 'mcl-banner-title';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mcl-banner-close';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function () { fermerBanner(true); });
    head.appendChild(bannerTitleEl);
    head.appendChild(closeBtn);

    bannerListEl = document.createElement('ul');
    bannerListEl.className = 'mcl-banner-list';

    bannerFootEl = document.createElement('div');
    bannerFootEl.className = 'mcl-banner-foot';

    bannerEl.appendChild(head);
    bannerEl.appendChild(bannerListEl);
    bannerEl.appendChild(bannerFootEl);
    document.body.appendChild(bannerEl);
  }

  /* Quel contrôleur « possède » actuellement le bandeau (pour ignorer/dédup). */
  var bannerOwner = null;

  /* Verrou : true pendant qu'une application (individuelle ou « Tout appliquer »)
     est en cours. Neutralise la réévaluation du bandeau déclenchée par
     `clients-db-changed` (nos propres écritures) afin qu'un re-render
     n'interrompe pas l'application en cours. Voir onDbChange(). */
  var applicationEnCours = false;

  function fermerBanner(parIgnore) {
    if (!bannerEl) return;
    bannerEl.classList.remove('mcl-banner-show');
    if (bannerHideTimer) { clearTimeout(bannerHideTimer); bannerHideTimer = null; }
    if (parIgnore && bannerOwner && bannerOwner._signatureCourante) {
      /* Mémorise la signature ignorée pour ne pas reproposer en boucle. */
      bannerOwner._ignorees[bannerOwner._signatureCourante] = true;
    }
    bannerOwner = null;
  }

  /* ----------------------------------------------------------
     Résolution d'un élément (sélecteur ou HTMLElement).
     ---------------------------------------------------------- */
  function resoudre(ref) {
    if (!ref) return null;
    if (ref.nodeType === 1) return ref;
    try { return document.querySelector(ref); } catch (e) { return null; }
  }

  function valeurDe(ref) {
    var el = resoudre(ref);
    return el ? String(el.value || '').trim() : '';
  }

  /* ----------------------------------------------------------
     Parsing d'une machine combinée « type n° » (Demande d'OS / Calcul vide).

     Heuristique (volontairement simple et figée) :
       - on compacte les espaces, puis on coupe au PREMIER espace ;
       - 1er token  → type ;
       - tout le reste (espaces internes conservés) → numéro.
     Exemple : « R230 924 » → { type: 'R230', numero: '924' }.

     Pourquoi cette heuristique et pas mieux : le format réellement saisi sur le
     terrain est « Type N° » (le type est un mononme — R230, C200, etc.). On
     préfère donc une règle déterministe et prévisible plutôt qu'un découpage
     « intelligent ».

     Limite assumée : un type composé de plusieurs mots (rare/inexistant en
     pratique) verrait ses mots suivants reversés dans le numéro. On accepte ce
     compromis. Une amélioration possible (NON faite ici, car elle complexifie la
     signature et présente un risque de mauvais découpage) serait, lorsqu'un
     client de référence est connu, de tenter de matcher le préfixe saisi contre
     les `type` déjà enregistrés de ses machines. À n'envisager que si un cas
     terrain le justifie.

     La comparaison/ajout (memeMachine) se fait ensuite sur ces deux parties
     normalisées (type ET numéro), le numéro de série étant l'identifiant fort.
     ---------------------------------------------------------- */
  function parserMachineCombo(valeur) {
    var v = String(valeur || '').trim().replace(/\s+/g, ' ');
    if (!v) return null;
    var idx = v.indexOf(' ');
    if (idx === -1) return { type: v, numero: '' };
    return { type: v.slice(0, idx).trim(), numero: v.slice(idx + 1).trim() };
  }

  /* Deux machines (type+numéro) sont « la même » si type ET numéro normalisés
     coïncident. Le numéro de série est l'identifiant fort ; le type sécurise. */
  function memeMachine(a, b) {
    if (!a || !b) return false;
    return normaliser(a.type) === normaliser(b.type)
        && normaliser(a.numero) === normaliser(b.numero);
  }

  /* ----------------------------------------------------------
     Matching du client de référence.
     ---------------------------------------------------------- */
  function chercherReference(config, clients) {
    /* 1. Référence explicite par id (autocomplete) → haute confiance. */
    var refId = null;
    try { refId = config.getReferenceId ? config.getReferenceId() : null; } catch (e) { refId = null; }
    if (refId) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].id === refId) {
          /* Sécurité : on n'utilise la référence id que si le nom saisi
             correspond encore (l'utilisateur a pu effacer puis ressaisir
             un autre client après une sélection). */
          var nomSaisiVerif = normaliser(valeurDe(config.fields.nom));
          if (!nomSaisiVerif || normaliser(clients[i].nom) === nomSaisiVerif) {
            return { client: clients[i], confiance: 'id' };
          }
        }
      }
    }

    /* 2. Matching par nom. */
    var nomSaisi = normaliser(valeurDe(config.fields.nom));
    if (!nomSaisi) return { client: null, confiance: 'aucun' };

    /* 2a. Match EXACT normalisé. */
    for (var j = 0; j < clients.length; j++) {
      if (normaliser(clients[j].nom) === nomSaisi) {
        return { client: clients[j], confiance: 'exact' };
      }
    }

    /* 2b. Match fort via Fuse (sur le nom uniquement), seuil strict. */
    if (typeof window.Fuse === 'function' && clients.length) {
      try {
        var fuse = new window.Fuse(
          clients.map(function (c) { return { ref: c, nom: normaliser(c.nom) }; }),
          { includeScore: true, ignoreLocation: true, threshold: SEUIL_FUSE_NOM,
            minMatchCharLength: 2, keys: ['nom'] }
        );
        var res = fuse.search(nomSaisi);
        if (res.length && res[0].score != null && res[0].score <= SEUIL_FUSE_NOM) {
          return { client: res[0].item.ref, confiance: 'fuzzy' };
        }
      } catch (e) { /* repli : pas de match fuzzy */ }
    }

    return { client: null, confiance: 'aucun' };
  }

  /* ----------------------------------------------------------
     Calcul des propositions (diffs) à partir d'un client de référence
     (ou null = nouveau client) et des valeurs saisies.
     Renvoie { signature, items:[{ kind, label, detail, apply }] }.
     ---------------------------------------------------------- */
  function lireMachineSaisie(config) {
    var f = config.fields;
    if (f.machineCombo) {
      return parserMachineCombo(valeurDe(f.machineCombo));
    }
    if (f.machineType || f.machineNumber) {
      var type = valeurDe(f.machineType);
      var numero = valeurDe(f.machineNumber);
      if (!type && !numero) return null;
      var m = { type: type, numero: numero };
      var annee = f.machineYear ? valeurDe(f.machineYear) : '';
      if (annee) m.annee = annee;
      return m;
    }
    return null;
  }

  var CHAMPS_SCALAIRES = ['contact', 'email', 'adresse', 'code_client'];

  function calculerPropositions(config, ref) {
    var f = config.fields;
    var items = [];
    var sigParts = [];

    var nomSaisi = valeurDe(f.nom);
    var machineSaisie = lireMachineSaisie(config);
    var pnSaisi = f.pn ? valeurDe(f.pn) : '';

    if (!ref.client) {
      /* === NOUVEAU CLIENT === : on propose la création complète. */
      var nouveau = { nom: nomSaisi };
      CHAMPS_SCALAIRES.forEach(function (champ) {
        if (f[champ]) {
          var v = valeurDe(f[champ]);
          if (v) nouveau[champ] = v;
        }
      });
      var machines = [];
      if (machineSaisie && (machineSaisie.type || machineSaisie.numero)) {
        var mm = { type: machineSaisie.type, numero: machineSaisie.numero };
        if (machineSaisie.annee) mm.annee = machineSaisie.annee;
        if (pnSaisi) mm.pns = [pnSaisi];
        machines.push(mm);
      }
      nouveau.machines = machines;

      sigParts.push('new:' + normaliser(nomSaisi));
      items.push({
        kind: 'create',
        label: 'Ajouter « <strong>' + escapeHtml(nomSaisi) + '</strong> » aux clients',
        detail: descriptionNouveauClient(nouveau),
        confirm: 'Client ajouté',
        /* Création complète en une seule opération add() (embarque déjà
           machine + PN + scalaires). create=true aiguille persisterItems(). */
        create: true,
        payload: nouveau,
      });

      return { signature: sigParts.join('|'), items: items };
    }

    /* === CLIENT CONNU === : diffs scalaires + ajout machine + ajout PN. */
    var client = ref.client;

    /* 1. Champs scalaires modifiés (MAJ). */
    CHAMPS_SCALAIRES.forEach(function (champ) {
      if (!f[champ]) return;
      var saisi = valeurDe(f[champ]);
      if (!saisi) return; /* on ne « vide » jamais un champ existant */
      var actuel = client[champ] != null ? String(client[champ]) : '';
      if (normaliser(saisi) !== normaliser(actuel)) {
        sigParts.push('upd:' + champ + ':' + normaliser(saisi));
        items.push({
          kind: 'update',
          label: (actuel
            ? 'Mettre à jour ' + libelleChamp(champ)
            : 'Renseigner ' + libelleChamp(champ)) + ' de « <strong>' + escapeHtml(client.nom) + '</strong> »',
          detail: (actuel ? escapeHtml(actuel) + ' → ' : '') + '<strong>' + escapeHtml(saisi) + '</strong>',
          confirm: 'Mis à jour',
          clientId: client.id,
          /* Mutateur pur : applique le changement sur une copie fournie, sans I/O.
             Permet de fusionner plusieurs items en une seule écriture. */
          mutate: (function (ch, val) {
            return function (base) {
              base[ch] = val;
              return base;
            };
          })(champ, saisi),
        });
      }
    });

    /* 2. Nouvelle machine (AJOUT — jamais d'écrasement). */
    if (machineSaisie && (machineSaisie.type || machineSaisie.numero)) {
      var listeM = Array.isArray(client.machines) ? client.machines : [];
      var existe = listeM.some(function (m) { return memeMachine(m, machineSaisie); });
      if (!existe) {
        sigParts.push('mach:' + normaliser(machineSaisie.type) + ' ' + normaliser(machineSaisie.numero));
        var libelleM = [machineSaisie.type, machineSaisie.numero].filter(Boolean).join(' ');
        items.push({
          kind: 'add-machine',
          label: 'Ajouter la machine à « <strong>' + escapeHtml(client.nom) + '</strong> »',
          detail: '<strong>' + escapeHtml(libelleM) + '</strong>'
            + (machineSaisie.annee ? ' (' + escapeHtml(machineSaisie.annee) + ')' : ''),
          confirm: 'Machine ajoutée',
          clientId: client.id,
          mutate: (function (machine, pn) {
            return function (base) {
              var arr = Array.isArray(base.machines) ? base.machines.slice() : [];
              /* Garde-fou : si une application précédente (même lot) a déjà
                 ajouté cette machine, on n'en recrée pas une seconde. */
              if (!arr.some(function (m) { return memeMachine(m, machine); })) {
                var nm = { type: machine.type, numero: machine.numero };
                if (machine.annee) nm.annee = machine.annee;
                if (pn) nm.pns = [pn];
                arr.push(nm);
              }
              base.machines = arr;
              return base;
            };
          })(machineSaisie, pnSaisi),
        });
      } else if (pnSaisi) {
        /* 3. Machine connue + PN saisi → AJOUT du PN à CETTE machine. */
        var machineCible = null;
        for (var k = 0; k < listeM.length; k++) {
          if (memeMachine(listeM[k], machineSaisie)) { machineCible = listeM[k]; break; }
        }
        var pnsExistants = (machineCible && Array.isArray(machineCible.pns)) ? machineCible.pns : [];
        var pnDejaLa = pnsExistants.some(function (p) { return normaliser(p) === normaliser(pnSaisi); });
        if (!pnDejaLa) {
          sigParts.push('pn:' + normaliser(machineSaisie.type) + ' ' + normaliser(machineSaisie.numero) + ':' + normaliser(pnSaisi));
          var libMach = [machineSaisie.type, machineSaisie.numero].filter(Boolean).join(' ');
          items.push({
            kind: 'add-pn',
            label: 'Ajouter le PN à la machine de « <strong>' + escapeHtml(client.nom) + '</strong> »',
            detail: 'PN <strong>' + escapeHtml(pnSaisi) + '</strong> → ' + escapeHtml(libMach),
            confirm: 'PN ajouté',
            clientId: client.id,
            mutate: (function (machine, pn) {
              return function (base) {
                var arr = Array.isArray(base.machines) ? base.machines.map(function (m) { return Object.assign({}, m); }) : [];
                for (var i = 0; i < arr.length; i++) {
                  if (memeMachine(arr[i], machine)) {
                    var pns = Array.isArray(arr[i].pns) ? arr[i].pns.slice() : [];
                    if (!pns.some(function (p) { return normaliser(p) === normaliser(pn); })) pns.push(pn);
                    arr[i].pns = pns;
                    break;
                  }
                }
                base.machines = arr;
                return base;
              };
            })(machineSaisie, pnSaisi),
          });
        }
      }
    }

    return { signature: sigParts.join('|'), items: items };
  }

  function libelleChamp(champ) {
    switch (champ) {
      case 'contact':     return 'le contact';
      case 'email':       return "l'email";
      case 'adresse':     return "l'adresse";
      case 'code_client': return 'le code client';
      default:            return champ;
    }
  }

  function descriptionNouveauClient(c) {
    var parts = [];
    if (c.code_client) parts.push('Code ' + escapeHtml(c.code_client));
    if (c.contact) parts.push(escapeHtml(c.contact));
    if (c.email) parts.push(escapeHtml(c.email));
    if (Array.isArray(c.machines) && c.machines.length) {
      var m = c.machines[0];
      parts.push(escapeHtml([m.type, m.numero].filter(Boolean).join(' ')));
    }
    return parts.join(' • ');
  }

  /* ----------------------------------------------------------
     Rendu du bandeau pour un lot de propositions (1 plugin propriétaire).
     ---------------------------------------------------------- */
  function afficherBanner(controller, propositions) {
    construireBanner();
    bannerOwner = controller;

    bannerTitleEl.textContent = propositions.items.length > 1
      ? 'Mettre à jour la base clients ?'
      : 'Proposition base clients';

    bannerListEl.innerHTML = '';
    bannerFootEl.innerHTML = '';

    propositions.items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'mcl-banner-item';

      var txt = document.createElement('div');
      txt.className = 'mcl-item-text';
      txt.innerHTML = item.label + (item.detail ? '<small>' + item.detail + '</small>' : '');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mcl-item-btn';
      btn.textContent = (item.kind === 'create' || item.kind === 'add-machine' || item.kind === 'add-pn')
        ? 'Ajouter' : 'Mettre à jour';

      btn.addEventListener('click', function () {
        appliquerItem(item, btn);
      });

      li.appendChild(txt);
      li.appendChild(btn);
      bannerListEl.appendChild(li);
    });

    /* « Tout appliquer » si plusieurs items. */
    if (propositions.items.length > 1) {
      var allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'mcl-all-btn';
      allBtn.textContent = 'Tout appliquer';
      allBtn.addEventListener('click', function () {
        var btns = bannerListEl.querySelectorAll('.mcl-item-btn');
        appliquerTout(controller, propositions.items, btns, allBtn);
      });
      bannerFootEl.appendChild(allBtn);
    }

    bannerEl.classList.add('mcl-banner-show');

    /* Auto-masquage de courtoisie après inactivité (non bloquant, ne marque
       PAS comme ignoré : on pourra reproposer si l'état le justifie encore). */
    if (bannerHideTimer) clearTimeout(bannerHideTimer);
    bannerHideTimer = setTimeout(function () {
      if (bannerOwner === controller) fermerBanner(false);
    }, 15000);
  }

  /* Applique le(s) mutateur(s) d'un ou plusieurs items « client connu » sur UNE
     copie fraîche du client, puis fait UNE SEULE écriture put(). Les items de
     type « create » (nouveau client) sont gérés à part via add().
     Lecture fraîche systématique avant écriture → aucune lecture stale, même en
     chaîne. Retourne une Promise résolue après la persistance. */
  function persisterItems(items) {
    var createItem = null;
    var mutItems = [];
    items.forEach(function (it) {
      if (it.create) createItem = it;
      else if (typeof it.mutate === 'function') mutItems.push(it);
    });

    /* Cas « nouveau client » : on crée le client. calculerPropositions ne
       produit qu'un seul item « create » (qui embarque déjà machine + PN +
       scalaires), donc add() suffit et couvre « create + autres ». */
    if (createItem) {
      return window.ClientsDB.add(createItem.payload);
    }

    if (!mutItems.length) return Promise.resolve();

    /* Tous les mutateurs portent sur le même client (même contexte de saisie). */
    var clientId = mutItems[0].clientId;
    return window.ClientsDB.get(clientId).then(function (frais) {
      if (!frais) {
        /* Le client a disparu (rare : supprimé entre-temps) → on abandonne. */
        return Promise.reject(new Error('Client introuvable: ' + clientId));
      }
      /* Copie de travail unique ; chaque mutateur l'enrichit en mémoire. */
      var base = Object.assign({}, frais);
      mutItems.forEach(function (it) { base = it.mutate(base); });
      return window.ClientsDB.put(base); /* écriture unique fusionnée */
    });
  }

  /* Marque la signature courante comme appliquée et ferme le bandeau en douceur
     si plus aucun item n'est en attente. */
  function apresApplication() {
    var owner = bannerOwner;
    if (owner && owner._signatureCourante) {
      owner._appliquees[owner._signatureCourante] = true;
    }
    var restants = bannerListEl
      ? bannerListEl.querySelectorAll('.mcl-item-btn:not([disabled])')
      : [];
    if (restants.length === 0) {
      if (bannerHideTimer) clearTimeout(bannerHideTimer);
      bannerHideTimer = setTimeout(function () { fermerBanner(false); }, 1200);
    }
  }

  /* Application d'UN item (clic individuel). Lecture fraîche + écriture unique
     via persisterItems → cohérent même en chaîne de clics rapides. */
  function appliquerItem(item, btn) {
    if (item._done) return;
    if (!window.ClientsDB) return;
    item._done = true;
    applicationEnCours = true;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    persisterItems([item])
      .then(function () {
        if (btn) { btn.textContent = item.confirm + ' ✓'; }
        apresApplication();
      })
      .catch(function (err) {
        console.error('[ClientLearning] Application impossible :', err);
        item._done = false;
        if (btn) { btn.disabled = false; btn.textContent = 'Réessayer'; }
      })
      .then(function () { applicationEnCours = false; });
  }

  /* « Tout appliquer » : application ATOMIQUE de tous les items en attente.
     Fusionne tous les mutateurs en une seule écriture (voir persisterItems),
     et neutralise le re-render déclenché par clients-db-changed le temps de
     l'opération (applicationEnCours). */
  function appliquerTout(controller, items, btns, allBtn) {
    if (!window.ClientsDB) return;
    var aFaire = [];
    items.forEach(function (it, i) {
      if (!it._done) { it._done = true; aFaire.push({ item: it, btn: btns[i] }); }
    });
    if (!aFaire.length) return;

    applicationEnCours = true;
    if (allBtn) { allBtn.disabled = true; allBtn.textContent = 'Application…'; }
    aFaire.forEach(function (e) {
      if (e.btn) { e.btn.disabled = true; e.btn.textContent = '…'; }
    });

    persisterItems(aFaire.map(function (e) { return e.item; }))
      .then(function () {
        aFaire.forEach(function (e) {
          if (e.btn) { e.btn.textContent = e.item.confirm + ' ✓'; }
        });
        if (allBtn) { allBtn.textContent = 'Tout appliqué ✓'; }
        apresApplication();
      })
      .catch(function (err) {
        console.error('[ClientLearning] « Tout appliquer » impossible :', err);
        /* Rollback de l'état UI : on réautorise une nouvelle tentative. */
        aFaire.forEach(function (e) {
          e.item._done = false;
          if (e.btn) { e.btn.disabled = false; e.btn.textContent = 'Réessayer'; }
        });
        if (allBtn) { allBtn.disabled = false; allBtn.textContent = 'Tout appliquer'; }
      })
      .then(function () { applicationEnCours = false; });
  }

  /* ----------------------------------------------------------
     attach() — branche l'apprentissage sur un plugin.
     ---------------------------------------------------------- */
  function attach(config) {
    config = config || {};
    config.fields = config.fields || {};
    var nomEl = resoudre(config.fields.nom);
    if (!nomEl) {
      console.warn('[ClientLearning] champ « nom » introuvable, attach ignoré.');
      return { evaluate: function () {}, destroy: function () {} };
    }
    if (!window.ClientsDB) {
      console.warn('[ClientLearning] ClientsDB absent, attach ignoré.');
      return { evaluate: function () {}, destroy: function () {} };
    }

    injecterStyles();

    var detruit = false;
    var controller = {
      _ignorees: {},        /* signatures ignorées (fermeture explicite) */
      _appliquees: {},      /* signatures déjà appliquées (1 clic) */
      _signatureCourante: null,
      evaluate: evaluate,
      destroy: destroy,
    };

    /* --- Indicateur précoce sous le champ nom --- */
    var hintEl = document.createElement('span');
    hintEl.className = 'mcl-hint';
    hintEl.setAttribute('aria-hidden', 'true');
    if (nomEl.parentNode) nomEl.parentNode.insertBefore(hintEl, nomEl.nextSibling);
    var hintTimer = null;

    function afficherHint(estNouveau) {
      hintEl.textContent = estNouveau ? 'Nouveau client' : 'Client connu';
      hintEl.className = 'mcl-hint mcl-hint-show ' + (estNouveau ? 'mcl-hint-new' : 'mcl-hint-known');
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(function () {
        hintEl.classList.remove('mcl-hint-show');
      }, 2200);
    }

    /* --- Lecture des clients (mémorisée, rafraîchie sur changement DB) --- */
    var clientsCache = [];
    function rechargerClients() {
      if (!window.ClientsDB) return Promise.resolve([]);
      return window.ClientsDB.getAll().then(function (liste) {
        clientsCache = liste || [];
        return clientsCache;
      }).catch(function () { clientsCache = []; return clientsCache; });
    }

    /* --- Blur du champ nom → indicateur précoce --- */
    function onBlurNom() {
      if (detruit) return;
      var nom = valeurDe(config.fields.nom);
      if (!nom) { hintEl.classList.remove('mcl-hint-show'); return; }
      rechargerClients().then(function () {
        if (detruit) return;
        var ref = chercherReference(config, clientsCache);
        afficherHint(!ref.client);
      });
    }

    /* --- Évaluation différée (uniquement si tous les champs base remplis) --- */
    function estComplet() {
      try { return config.isComplete ? !!config.isComplete() : false; }
      catch (e) { return false; }
    }

    function evaluate() {
      if (detruit || !window.ClientsDB) return;
      if (!estComplet()) {
        /* Pas tous les champs remplis : on ne propose rien (et si le bandeau
           courant venait de ce plugin, on le laisse — l'utilisateur agit dessus). */
        return;
      }
      rechargerClients().then(function () {
        if (detruit) return;
        var ref = chercherReference(config, clientsCache);
        var propositions = calculerPropositions(config, ref);
        controller._signatureCourante = propositions.signature;

        if (!propositions.items.length) return;
        /* Dédup session : ne pas reproposer ce qui a été ignoré ou appliqué. */
        if (controller._ignorees[propositions.signature]) return;
        if (controller._appliquees[propositions.signature]) return;

        /* Filtrer les items dont la cible existe déjà (sécurité anti-doublon
           si la base a changé entre-temps) : calculerPropositions s'en charge
           déjà via la lecture fraîche, donc on affiche tel quel. */
        afficherBanner(controller, propositions);
      });
    }

    /* Débounce léger pour éviter les évaluations en rafale (blur + change). */
    var evalTimer = null;
    function evaluateDifferee() {
      if (evalTimer) clearTimeout(evalTimer);
      evalTimer = setTimeout(evaluate, 250);
    }

    /* --- Écoute des champs : indicateur au blur du nom, évaluation différée
       quand un champ « base » perd le focus (change/blur). On n'évalue JAMAIS
       pendant la frappe (input) — uniquement sur blur/change. --- */
    nomEl.addEventListener('blur', onBlurNom);

    var champsSurveilles = [];
    Object.keys(config.fields).forEach(function (role) {
      var el = resoudre(config.fields[role]);
      if (el && champsSurveilles.indexOf(el) === -1) champsSurveilles.push(el);
    });
    function onChampChange() { if (!detruit) evaluateDifferee(); }
    champsSurveilles.forEach(function (el) {
      el.addEventListener('change', onChampChange);
      el.addEventListener('blur', onChampChange);
    });

    /* Rafraîchir le cache si la base change (nos écritures ou un pull sync). */
    function onDbChange() {
      rechargerClients().then(function () {
        /* Pendant une application en cours (clic individuel ou « Tout
           appliquer »), on NE ré-évalue PAS : le re-render reconstruirait le
           bandeau (innerHTML = '') et détacherait les boutons/items que
           l'application est en train de traiter → application incomplète.
           La fin de l'application ferme/rafraîchit le bandeau elle-même. */
        if (applicationEnCours) return;
        /* Si le bandeau appartient à ce plugin, on le ré-évalue pour retirer
           les propositions devenues caduques (déjà appliquées ailleurs). */
        if (bannerOwner === controller) evaluateDifferee();
      });
    }
    window.addEventListener(EVENT_CHANGE, onDbChange);

    /* Chargement initial du cache. */
    if (typeof window.ClientsDB.ready === 'function') {
      window.ClientsDB.ready().then(rechargerClients).catch(function () {});
    } else {
      rechargerClients();
    }

    function destroy() {
      detruit = true;
      if (hintTimer) clearTimeout(hintTimer);
      if (evalTimer) clearTimeout(evalTimer);
      nomEl.removeEventListener('blur', onBlurNom);
      champsSurveilles.forEach(function (el) {
        el.removeEventListener('change', onChampChange);
        el.removeEventListener('blur', onChampChange);
      });
      window.removeEventListener(EVENT_CHANGE, onDbChange);
      if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
      /* Si ce plugin possédait le bandeau, on le ferme proprement. */
      if (bannerOwner === controller) fermerBanner(false);
    }

    return controller;
  }

  /* Exposition globale */
  window.ClientLearning = { attach: attach };

})();
