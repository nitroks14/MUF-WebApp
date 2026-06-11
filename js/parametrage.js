/**
 * MUF-WebApp — Module Paramétrage
 * Gestion de la configuration des préférences technicien.
 *
 * Stratégie de stockage — offline-first « cloud + cache local » :
 *   - Source de vérité     = Supabase user_metadata (multi-appareils).
 *   - Cache local          = localStorage (instantané, fonctionne hors-ligne).
 *
 *   • Lecture : le cache localStorage est servi immédiatement. Au retour/au
 *     démarrage online, on rafraîchit depuis user_metadata, on met à jour le
 *     cache, et on notifie les abonnés (le plugin re-render si les valeurs
 *     diffèrent).
 *   • Écriture : le cache localStorage est écrit tout de suite, puis on pousse
 *     vers user_metadata (merge NON destructif). Si offline / échec réseau, un
 *     flag « dirty » est posé et la synchro est rejouée automatiquement au
 *     retour du réseau.
 *   • Migration douce : au 1er chargement online, si user_metadata ne contient
 *     pas encore les préférences mais que le localStorage en a → push unique.
 *
 * API publique : window.Parametrage
 *   .get(key)          → valeur d'un champ
 *   .set(key, value)   → écriture (cache immédiat + push cloud / dirty)
 *   .getAll()          → objet complet de configuration
 *   .syncFromCloud()   → Promise<boolean>  (refresh manuel depuis user_metadata ;
 *                        résout à true si le cache a changé)
 *   .onChange(cb)      → void  (notifié { config } à chaque maj du cache)
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Clés localStorage et structure par défaut
     ---------------------------------------------------------- */
  const CLE_STORAGE = 'muf_config';
  const CLE_DIRTY   = 'muf_config_dirty';          /* flag : push cloud en attente */

  /* Préfixe sous lequel les préférences sont rangées dans user_metadata afin de
     cohabiter proprement avec les champs existants (prenom, nom…). */
  const META_PREFIX = 'param_';

  const CONFIG_DEFAUT = {
    /* nom / prenom supprimés — désormais gérés par window.Auth (onboarding) */
    emails_frequents:  [],   /* tableau de { label, adresse, prenom? } (prenom optionnel, v77) */
    email_maintenance: '',   /* adresse du service maintenance Multivac */
    contacts_support:  [],   /* contacts support technique */
    date_format:      'DD/MM/YYYY',
    unites:           'SI',
  };

  /* Champs réellement synchronisés dans user_metadata (date_format / unites sont
     figés en dur → jamais persistés ni synchronisés). */
  const CHAMPS_SYNC = ['emails_frequents', 'email_maintenance', 'contacts_support'];

  /* ----------------------------------------------------------
     État interne
     ---------------------------------------------------------- */
  var _listeners = [];

  /* ----------------------------------------------------------
     Chargement initial depuis localStorage (cache)
     ---------------------------------------------------------- */
  function chargerDepuisStorage() {
    try {
      const brut = localStorage.getItem(CLE_STORAGE);
      if (!brut) return Object.assign({}, CONFIG_DEFAUT);
      const parse = JSON.parse(brut);
      /* Fusion avec les valeurs par défaut pour les clés manquantes */
      const config = Object.assign({}, CONFIG_DEFAUT, parse);
      /* Ces valeurs sont figées — ignorer tout ce que le localStorage pourrait contenir */
      config.date_format = CONFIG_DEFAUT.date_format;
      config.unites      = CONFIG_DEFAUT.unites;
      return config;
    } catch (e) {
      console.warn('[Parametrage] Impossible de lire localStorage :', e);
      return Object.assign({}, CONFIG_DEFAUT);
    }
  }

  /* État courant — initialisé une seule fois depuis le cache (instantané). */
  let _config = chargerDepuisStorage();

  /* ----------------------------------------------------------
     Helpers cache localStorage
     ---------------------------------------------------------- */
  function sauvegarderStorage() {
    try {
      localStorage.setItem(CLE_STORAGE, JSON.stringify(_config));
    } catch (e) {
      console.error('[Parametrage] Erreur écriture localStorage :', e);
    }
  }

  function estDirty() {
    try { return localStorage.getItem(CLE_DIRTY) === '1'; }
    catch (e) { return false; }
  }

  function marquerDirty(valeur) {
    try {
      if (valeur) localStorage.setItem(CLE_DIRTY, '1');
      else        localStorage.removeItem(CLE_DIRTY);
    } catch (e) { /* quota / mode privé : on ignore */ }
  }

  /* ----------------------------------------------------------
     Helpers cloud (user_metadata)
     ---------------------------------------------------------- */
  function authPret() {
    return !!(window.Auth && typeof window.Auth.updateUserMetadata === 'function');
  }

  function sessionActive() {
    return !!(window.Auth && window.Auth.isAuthenticated && window.Auth.isAuthenticated());
  }

  function estOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  /** Construit le sous-objet à pousser dans user_metadata (champs préfixés). */
  function versMetadata(config) {
    var data = {};
    CHAMPS_SYNC.forEach(function (key) {
      data[META_PREFIX + key] = config[key];
    });
    return data;
  }

  /**
   * Extrait les préférences d'un user_metadata.
   * @returns {{config:object, present:boolean}} present=true si au moins un
   *          champ préfixé existe (sert à détecter le besoin de migration).
   */
  function depuisMetadata(meta) {
    meta = meta || {};
    var config = {};
    var present = false;
    CHAMPS_SYNC.forEach(function (key) {
      var cle = META_PREFIX + key;
      if (Object.prototype.hasOwnProperty.call(meta, cle)) {
        config[key] = meta[cle];
        present = true;
      }
    });
    return { config: config, present: present };
  }

  function notifierChangement() {
    var copie = Object.assign({}, _config);
    _listeners.forEach(function (cb) {
      try { cb(copie); } catch (e) { /* listener défaillant ignoré */ }
    });
  }

  /** Compare deux valeurs de préférence (objets/tableaux via JSON). */
  function memeValeur(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return a === b; }
  }

  /* ----------------------------------------------------------
     Push vers le cloud (user_metadata)
     Pose le flag dirty si offline / échec, le retire si succès.
     ---------------------------------------------------------- */
  function pousserCloud() {
    if (!authPret() || !sessionActive() || !estOnline()) {
      marquerDirty(true);
      return Promise.resolve(false);
    }
    return window.Auth.updateUserMetadata(versMetadata(_config)).then(function (res) {
      if (res && res.ok) {
        marquerDirty(false);
        return true;
      }
      marquerDirty(true);
      return false;
    }).catch(function () {
      marquerDirty(true);
      return false;
    });
  }

  /* ----------------------------------------------------------
     Refresh depuis le cloud (au démarrage / retour online)
     - migration douce si user_metadata vide mais cache non vide ;
     - sinon adoption des valeurs cloud (source de vérité) ;
     - notifie les abonnés uniquement si le cache a réellement changé.
     @returns {Promise<boolean>} true si le cache local a changé
     ---------------------------------------------------------- */
  function syncFromCloud() {
    if (!authPret() || !sessionActive() || !estOnline()) {
      return Promise.resolve(false);
    }

    return window.Auth.refreshUser().then(function () {
      var meta = window.Auth.getUserMetadata ? window.Auth.getUserMetadata() : {};
      var extrait = depuisMetadata(meta);

      /* Migration douce : le cloud n'a pas encore les préférences mais on a un
         cache local non vide → on pousse une fois. */
      if (!extrait.present) {
        if (estDirty() || aDesPreferencesLocales()) {
          return pousserCloud().then(function () { return false; });
        }
        return false;
      }

      /* Le cloud fait foi : on applique ses valeurs sur le cache. Si une écriture
         locale est en attente (dirty), on la pousse plutôt que de l'écraser. */
      if (estDirty()) {
        return pousserCloud().then(function () { return false; });
      }

      var change = false;
      CHAMPS_SYNC.forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(extrait.config, key)) {
          if (!memeValeur(_config[key], extrait.config[key])) {
            _config[key] = extrait.config[key];
            change = true;
          }
        }
      });

      if (change) {
        sauvegarderStorage();
        notifierChangement();
      }
      return change;
    }).catch(function (e) {
      console.warn('[Parametrage] syncFromCloud impossible :', e);
      return false;
    });
  }

  function aDesPreferencesLocales() {
    return CHAMPS_SYNC.some(function (key) {
      var v = _config[key];
      if (Array.isArray(v)) return v.length > 0;
      return !!v;
    });
  }

  /* ----------------------------------------------------------
     Flush des écritures en attente au retour online
     ---------------------------------------------------------- */
  function flushSiDirty() {
    if (estDirty() && sessionActive() && estOnline()) {
      pousserCloud();
    }
  }

  /* ----------------------------------------------------------
     Déclencheurs de synchronisation
     ---------------------------------------------------------- */
  (function installerDeclencheurs() {
    /* Retour du réseau → on rejoue les écritures en attente puis on rafraîchit. */
    window.addEventListener('online', function () {
      flushSiDirty();
      syncFromCloud();
    });

    /* Changement de session (login / refresh) → push dirty + refresh cloud. */
    if (window.Auth && typeof window.Auth.onChange === 'function') {
      var dejaConnecte = false;
      window.Auth.onChange(function (user) {
        var connecte = !!user;
        if (connecte && !dejaConnecte) {
          flushSiDirty();
          syncFromCloud();
        }
        dejaConnecte = connecte;
      });
    }
  })();

  /* ----------------------------------------------------------
     API publique
     ---------------------------------------------------------- */
  const Parametrage = {

    /**
     * Lire une valeur de configuration (depuis le cache, synchrone).
     *
     * Rétrocompatibilité : 'nom' et 'prenom' sont désormais stockés dans
     * window.Auth (onboarding). Si un plugin les demande via Parametrage,
     * on les sert depuis Auth.getUser() pour éviter tout refactoring.
     *
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      if (key === 'nom' || key === 'prenom') {
        const user = window.Auth && window.Auth.getUser ? window.Auth.getUser() : null;
        return (user && user[key]) || '';
      }
      return _config[key];
    },

    /**
     * Écrire une valeur : cache localStorage immédiat + push cloud (ou dirty
     * si offline). L'écriture locale n'attend jamais le réseau.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      if (key === 'date_format' || key === 'unites') {
        /* Valeurs figées — toute écriture externe est ignorée */
        return;
      }
      if (key === 'nom' || key === 'prenom') {
        /* Désormais gérés par Auth — écriture ignorée */
        return;
      }
      if (!(key in CONFIG_DEFAUT)) {
        console.warn(`[Parametrage] Clé inconnue : "${key}"`);
      }
      _config[key] = value;
      sauvegarderStorage();
      /* Push cloud non bloquant (pose un flag dirty si offline/échec). */
      if (CHAMPS_SYNC.indexOf(key) !== -1) {
        pousserCloud();
      }
    },

    /**
     * Retourner une copie de toute la configuration (depuis le cache).
     * @returns {object}
     */
    getAll() {
      return Object.assign({}, _config);
    },

    /**
     * Rafraîchit le cache depuis user_metadata (source de vérité).
     * @returns {Promise<boolean>} true si le cache a changé
     */
    syncFromCloud() {
      return syncFromCloud();
    },

    /**
     * S'abonner aux changements du cache (ex : refresh cloud → re-render UI).
     * @param {function(object)} cb appelé avec une copie de la config
     * @returns {function():void} fonction de désinscription (à appeler dans le
     *   cleanup du plugin pour éviter l'accumulation de listeners au fil des
     *   rechargements). No-op si cb invalide.
     */
    onChange(cb) {
      if (typeof cb !== 'function') return function () {};
      _listeners.push(cb);
      return function () {
        _listeners = _listeners.filter(function (l) { return l !== cb; });
      };
    },
  };

  /* Exposition globale */
  window.Parametrage = Parametrage;

})();
