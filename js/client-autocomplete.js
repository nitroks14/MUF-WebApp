/**
 * MUF-WebApp — Auto-complétion clients (helper réutilisable)
 *
 * Fournit un menu de suggestions « fuzzy » sous un champ <input> « nom client »
 * de n'importe quel plugin (Demande d'OS, Calcul vide, Rapport…). Au choix d'une
 * suggestion, l'objet client complet est remonté à l'appelant via onSelect() pour
 * qu'il fasse son propre mapping de champs.
 *
 * Principes :
 *   - 100 % offline-first : les clients viennent de window.ClientsDB (IndexedDB),
 *     l'indexation fuzzy de window.Fuse (asset local js/libs/fuse.min.js). Aucun
 *     appel réseau.
 *   - Générique : aucune connaissance des champs métier d'un plugin donné. Le
 *     plugin décide quoi pré-remplir dans son callback onSelect(client).
 *   - Config de matching IDENTIQUE à celle du plugin Clients (mêmes clés, même
 *     seuil, neutralisation accents/casse) pour un comportement cohérent.
 *   - Gardes anti-autofill reprises du plugin Clients : le navigateur (Brave /
 *     Chrome / gestionnaires de mots de passe) ne doit pas injecter de valeur
 *     parasite ni perturber la saisie.
 *
 * API publique — window.ClientAutocomplete :
 *
 *   .attach(input, options) → controller
 *     input   : HTMLInputElement (le champ « nom client »)
 *     options : {
 *       onSelect(client) : appelé quand l'utilisateur choisit une suggestion.
 *       maxResults       : nombre max de suggestions affichées (défaut 8).
 *       minChars         : nb de caractères avant de chercher (défaut 2).
 *     }
 *     Retourne un controller :
 *       .refresh()  → recharge les clients depuis ClientsDB et réindexe.
 *       .destroy()  → détache écouteurs + retire le menu du DOM.
 *
 * Plusieurs champs peuvent être équipés simultanément (chaque attach() est
 * indépendant). Le helper se recharge automatiquement sur l'événement
 * `clients-db-changed` afin de refléter les ajouts/éditions de clients.
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Normalisation (identique au plugin Clients) :
     minuscules + suppression des accents pour une recherche
     tolérante (« boulangri » trouve « Boulangerie »).
     ---------------------------------------------------------- */
  function normaliser(str) {
    return String(str == null ? '' : str)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') /* diacritiques combinants */
      .trim();
  }

  /* Échappement HTML par regex (pas de DOM créé à chaque appel — module
     indépendant, dupliqué à l'identique dans client-learning.js).
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

  /* Sous-titre informatif d'une suggestion (adresse / contact / machines). */
  function sousTitreClient(c) {
    var parts = [];
    if (c.code_client) parts.push('Code ' + c.code_client);
    if (c.adresse) parts.push(c.adresse);
    if (Array.isArray(c.machines) && c.machines.length) {
      parts.push(
        c.machines.length === 1 ? '1 machine' : c.machines.length + ' machines'
      );
    }
    return parts.join(' • ');
  }

  /* ----------------------------------------------------------
     Index Fuse — MÊME configuration que le plugin Clients.
     On indexe une vue « aplatie » des machines pour permettre la
     recherche par type / n° de série également.
     ---------------------------------------------------------- */
  function construireFuse(clients) {
    if (typeof window.Fuse !== 'function') return null;

    var docs = clients.map(function (c) {
      return {
        ref: c,
        nom: c.nom || '',
        adresse: c.adresse || '',
        contact: c.contact || '',
        email: c.email || '',
        code_client: c.code_client || '',
        machines: (c.machines || [])
          .map(function (m) { return [m.type, m.numero, m.annee].filter(Boolean).join(' '); })
          .join(' '),
      };
    });

    return new window.Fuse(docs, {
      includeScore: true,
      ignoreLocation: true,
      /* Seuil Fuse PERMISSIF (0 = identique, 1 = aucun rapport). 0.4 ici car
         l'auto-complétion sert à SUGGÉRER largement pendant la frappe : on
         préfère proposer un peu trop que rater un client à cause d'une faute de
         frappe. C'est l'utilisateur qui valide en cliquant, donc aucun risque
         d'attribution erronée. À comparer avec le seuil STRICT 0.34 de
         client-learning.js (SEUIL_FUSE_NOM), où un mauvais match écrirait en base. */
      threshold: 0.4,
      minMatchCharLength: 2,
      keys: [
        { name: 'nom', weight: 0.5 },
        { name: 'code_client', weight: 0.2 },
        { name: 'adresse', weight: 0.15 },
        { name: 'contact', weight: 0.05 },
        { name: 'email', weight: 0.05 },
        { name: 'machines', weight: 0.05 },
      ],
      getFn: function (obj, path) {
        var v = window.Fuse.config.getFn(obj, path);
        if (Array.isArray(v)) return v.map(normaliser);
        return normaliser(v);
      },
    });
  }

  /* ----------------------------------------------------------
     Styles injectés une seule fois (charte via variables main.css).
     Le menu utilise position: absolute relatif à un wrapper créé
     autour de l'input.
     ---------------------------------------------------------- */
  var STYLE_ID = 'mac-autocomplete-styles';
  function injecterStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.mac-wrap { position: relative; }',
      '.mac-menu {',
      '  position: absolute; left: 0; right: 0; top: calc(100% + 4px);',
      '  z-index: 8000;',
      '  background: var(--color-surface);',
      '  border: 1px solid var(--color-border);',
      '  border-radius: var(--radius);',
      '  box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,0.18));',
      '  max-height: 280px; overflow-y: auto;',
      '  -webkit-overflow-scrolling: touch;',
      '  display: none; padding: 4px;',
      '}',
      '.mac-menu.mac-open { display: block; }',
      '.mac-option {',
      '  display: block; width: 100%; text-align: left;',
      '  background: transparent; border: none; cursor: pointer;',
      '  padding: 10px 12px; border-radius: var(--radius);',
      '  font-family: var(--font-family); color: var(--color-text);',
      '  min-height: 44px;', /* cible tactile iPhone SE */
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '.mac-option:hover, .mac-option.mac-active {',
      '  background: var(--color-bg);',
      '}',
      '.mac-option-nom { font-weight: 600; color: var(--color-primary); word-break: break-word; }',
      '.mac-option-sub {',
      '  font-size: var(--font-size-sm); color: var(--color-text-muted);',
      '  margin-top: 2px; word-break: break-word;',
      '}',
      '.mac-empty {',
      '  padding: 12px; font-size: var(--font-size-sm);',
      '  color: var(--color-text-muted); font-style: italic;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  /* ----------------------------------------------------------
     attach() — équipe un input d'auto-complétion clients.
     ---------------------------------------------------------- */
  function attach(input, options) {
    if (!input || input.nodeType !== 1) {
      console.warn('[ClientAutocomplete] input invalide.');
      return { refresh: function () {}, destroy: function () {} };
    }
    options = options || {};
    var onSelect   = typeof options.onSelect === 'function' ? options.onSelect : function () {};
    var maxResults = options.maxResults > 0 ? options.maxResults : 8;
    var minChars   = options.minChars   > 0 ? options.minChars   : 2;

    injecterStyles();

    /* --- Gardes anti-autofill ---
       Le navigateur (Chrome / Safari iOS) IGNORE autocomplete="off" pour son
       autofill « profil » et propose l'email/adresse perso de l'utilisateur
       dans ce champ « nom client ». On délègue donc à window.AntiAutofill (la
       référence projet, js/anti-autofill.js) qui pose un TOKEN LEURRE dans
       autocomplete — seule technique réellement efficace. Repli sur l'ancien
       set autocomplete="off" si le helper n'est pas chargé.
       On NE met PAS le champ en readonly ici : sur Demande d'OS il doit rester
       immédiatement saisissable (pas de barre de recherche dédiée). */
    if (window.AntiAutofill && typeof window.AntiAutofill.protect === 'function') {
      window.AntiAutofill.protect(input);
    } else {
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('data-lpignore', 'true');
      input.setAttribute('data-1p-ignore', '');
      input.setAttribute('data-form-type', 'other');
    }

    /* --- Wrapper de positionnement autour de l'input --- */
    var wrap = document.createElement('div');
    wrap.className = 'mac-wrap';
    var parent = input.parentNode;
    parent.insertBefore(wrap, input);
    wrap.appendChild(input);

    /* --- Menu de suggestions --- */
    var menu = document.createElement('div');
    menu.className = 'mac-menu';
    menu.setAttribute('role', 'listbox');
    wrap.appendChild(menu);

    /* --- État local --- */
    var clients = [];
    var fuse = null;
    var resultatsCourants = [];
    var indexActif = -1;
    var saisieUtilisateur = false; /* true dès la 1re vraie frappe (anti-autofill) */
    var detruit = false;

    /* --- Recherche --- */
    function rechercher(q) {
      var terme = normaliser(q);
      if (terme.length < minChars) return [];
      if (fuse) {
        return fuse.search(terme)
          .slice(0, maxResults)
          .map(function (r) { return r.item.ref; });
      }
      /* Repli si Fuse indisponible : « contient » insensible accents/casse. */
      return clients.filter(function (c) {
        return normaliser(c.nom).indexOf(terme) !== -1
            || normaliser(c.code_client).indexOf(terme) !== -1
            || normaliser(c.adresse).indexOf(terme) !== -1;
      }).slice(0, maxResults);
    }

    /* --- Rendu du menu --- */
    function fermerMenu() {
      menu.classList.remove('mac-open');
      menu.innerHTML = '';
      resultatsCourants = [];
      indexActif = -1;
      input.setAttribute('aria-expanded', 'false');
    }

    function rendreMenu(resultats) {
      resultatsCourants = resultats;
      indexActif = -1;
      menu.innerHTML = '';

      if (!resultats.length) {
        var vide = document.createElement('div');
        vide.className = 'mac-empty';
        vide.textContent = 'Aucun client connu ne correspond.';
        menu.appendChild(vide);
        menu.classList.add('mac-open');
        input.setAttribute('aria-expanded', 'true');
        return;
      }

      resultats.forEach(function (c, i) {
        var opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'mac-option';
        opt.setAttribute('role', 'option');
        opt.dataset.index = String(i);

        var html = '<span class="mac-option-nom">' + escapeHtml(c.nom || '(sans nom)') + '</span>';
        var sub = sousTitreClient(c);
        if (sub) html += '<span class="mac-option-sub">' + escapeHtml(sub) + '</span>';
        opt.innerHTML = html;

        /* mousedown plutôt que click : se déclenche AVANT le blur de l'input,
           ce qui évite que le menu se ferme avant la sélection. */
        opt.addEventListener('mousedown', function (e) {
          e.preventDefault();
          choisir(c);
        });
        menu.appendChild(opt);
      });

      menu.classList.add('mac-open');
      input.setAttribute('aria-expanded', 'true');
    }

    function majActif(delta) {
      var options = menu.querySelectorAll('.mac-option');
      if (!options.length) return;
      indexActif += delta;
      if (indexActif < 0) indexActif = options.length - 1;
      if (indexActif >= options.length) indexActif = 0;
      options.forEach(function (o, i) {
        o.classList.toggle('mac-active', i === indexActif);
        if (i === indexActif) {
          o.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    /* --- Sélection d'un client --- */
    function choisir(client) {
      /* Le nom officiel du client remplace la saisie approximative. */
      input.value = client.nom || input.value;
      saisieUtilisateur = true; /* la valeur est désormais « validée » */
      fermerMenu();
      try { onSelect(client); } catch (e) {
        console.error('[ClientAutocomplete] onSelect a échoué :', e);
      }
    }

    /* --- Écouteurs input --- */
    function onInput() {
      saisieUtilisateur = true;
      var q = input.value;
      if (normaliser(q).length < minChars) { fermerMenu(); return; }
      rendreMenu(rechercher(q));
    }

    function onFocus() {
      /* On ne rouvre le menu au focus que si l'utilisateur a déjà saisi quelque
         chose lui-même (et pas une valeur d'autofill résiduelle). */
      if (!saisieUtilisateur) return;
      var q = input.value;
      if (normaliser(q).length >= minChars) {
        rendreMenu(rechercher(q));
      }
    }

    function onKeydown(e) {
      if (!menu.classList.contains('mac-open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); majActif(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); majActif(-1); }
      else if (e.key === 'Enter') {
        if (indexActif >= 0 && resultatsCourants[indexActif]) {
          e.preventDefault();
          choisir(resultatsCourants[indexActif]);
        }
      } else if (e.key === 'Escape') {
        fermerMenu();
      }
    }

    /* Fermer le menu si l'utilisateur clique en dehors. */
    function onDocPointerDown(e) {
      if (!wrap.contains(e.target)) fermerMenu();
    }

    /* Collage : on assainit la valeur mono-ligne, comme dans le plugin Clients,
       puis on relance la recherche. On ne preventDefault pas (collage natif). */
    function onPaste() {
      saisieUtilisateur = true;
      setTimeout(function () {
        var v = input.value;
        var nettoye = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
        if (nettoye !== v) input.value = nettoye;
        onInput();
      }, 0);
    }

    input.addEventListener('input', onInput);
    input.addEventListener('focus', onFocus);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('paste', onPaste);
    document.addEventListener('pointerdown', onDocPointerDown);

    /* --- Chargement / réindexation depuis ClientsDB ---
       Important : si l'utilisateur a déjà tapé AVANT que la base ne soit prête
       (course au démarrage à froid : IndexedDB pas encore ouverte / pas encore
       synchronisée), le menu affiche « Aucun client » sur un index vide. Une fois
       l'index reconstruit, on RE-RENDER le menu encore ouvert pour faire apparaître
       les suggestions sans que l'utilisateur ait à retaper. Corrige l'absence de
       suggestions observée quand un plugin est ouvert pendant la fenêtre froide. */
    function refresh() {
      if (detruit || !window.ClientsDB) return Promise.resolve();
      return window.ClientsDB.getAll().then(function (liste) {
        clients = liste || [];
        fuse = construireFuse(clients);
        /* Rafraîchit le menu ouvert avec l'index fraîchement construit. */
        if (menu.classList.contains('mac-open')) {
          var q = input.value;
          if (normaliser(q).length >= minChars) {
            rendreMenu(rechercher(q));
          }
        }
      }).catch(function (err) {
        console.error('[ClientAutocomplete] Lecture ClientsDB impossible :', err);
      });
    }

    /* Réindexer si la base change (ajout/édition d'un client ou pull sync). */
    var EVENT_CHANGE = (window.ClientsDB && window.ClientsDB.EVENT_CHANGE) || 'clients-db-changed';
    function onDbChange() { refresh(); }
    window.addEventListener(EVENT_CHANGE, onDbChange);

    /* Chargement initial. */
    if (window.ClientsDB && typeof window.ClientsDB.ready === 'function') {
      window.ClientsDB.ready().then(refresh).catch(function () { /* ignoré, repli vide */ });
    } else {
      refresh();
    }

    /* --- Destruction propre --- */
    function destroy() {
      detruit = true;
      input.removeEventListener('input', onInput);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('paste', onPaste);
      document.removeEventListener('pointerdown', onDocPointerDown);
      window.removeEventListener(EVENT_CHANGE, onDbChange);
      /* Sort l'input du wrapper pour ne pas casser le DOM du plugin. */
      if (wrap.parentNode) {
        wrap.parentNode.insertBefore(input, wrap);
        wrap.parentNode.removeChild(wrap);
      }
    }

    return { refresh: refresh, destroy: destroy };
  }

  /* Exposition globale */
  window.ClientAutocomplete = { attach: attach };

})();
