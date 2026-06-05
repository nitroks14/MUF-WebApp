/**
 * MUF-WebApp — Gestionnaire de synchronisation (référentiel "clients")
 *
 * Synchronise la base locale IndexedDB (js/db.js, source de vérité offline)
 * avec la table Supabase `clients`, via le client supabase-js partagé
 * (js/supabase-client.js). L'UI n'attend jamais la synchro : tout se fait en
 * arrière-plan, sans erreur visible en l'absence de réseau.
 *
 * Modèle de synchronisation :
 *   - PULL  : récupère les lignes de l'utilisateur depuis Supabase
 *             (delta `updated_at > lastSync` quand un lastSync existe), puis
 *             upsert dans IndexedDB ; prend en compte le soft-delete `deleted`.
 *   - PUSH  : envoie vers Supabase (upsert) les enregistrements locaux marqués
 *             dirty — soft-deletes inclus — puis retire le flag dirty.
 *   - CONFLITS : last-write-wins sur `updated_at` (au pull, on n'écrase un
 *             enregistrement local dirty que si la version serveur est plus
 *             récente ; au push, le serveur reçoit la version locale).
 *
 * Déclencheurs (tous non bloquants, ignorés si aucune session Supabase) :
 *   - au login / au démarrage (si une session existe) ;
 *   - après chaque mutation locale (événement `clients-db-changed`, débouncé) ;
 *   - au retour du réseau (événement window 'online').
 *
 * API publique — window.SyncManager :
 *   .init()              → installe les déclencheurs (idempotent)
 *   .sync()              → Promise<{ok, pulled, pushed, skipped?, reason?}>
 *   .syncSoon(delai?)    → planifie une synchro débouncée
 *   .isOnline()          → boolean
 *   .isSyncing()         → boolean
 *   .onStatus(cb)        → void  (notifié { state, ... } : idle|syncing|done|error|offline)
 */

'use strict';

(function () {

  var TABLE = 'clients';

  /* Colonnes métier réellement persistées côté Supabase (on ne pousse jamais
     les champs internes préfixés _, ni created_at/updated_at gérés serveur). */
  var COLONNES = ['id', 'nom', 'adresse', 'contact', 'machines', 'deleted'];

  /* Débounce des synchros déclenchées par les mutations locales. */
  var DEBOUNCE_MS = 1500;

  /* ----------------------------------------------------------
     État interne
     ---------------------------------------------------------- */
  var _enCours    = false;   /* une synchro est-elle active ? */
  var _replanifier = false;  /* une mutation est survenue pendant une synchro */
  var _timer      = null;    /* timer de débounce */
  var _installe   = false;   /* déclencheurs déjà posés ? */
  var _listeners  = [];      /* callbacks onStatus */

  /* ----------------------------------------------------------
     Helpers
     ---------------------------------------------------------- */
  function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  function isSyncing() {
    return _enCours;
  }

  function notifierStatut(etat) {
    _listeners.forEach(function (cb) {
      try { cb(etat); } catch (e) { /* listener défaillant ignoré */ }
    });
  }

  /** Accès au client Supabase prêt (réutilise le client partagé existant). */
  function clientPret() {
    if (window.Auth && typeof window.Auth.ready === 'function') {
      return window.Auth.ready();
    }
    if (window.MUF_SUPABASE) return Promise.resolve(window.MUF_SUPABASE);
    if (window.MUF_SUPABASE_READY) return window.MUF_SUPABASE_READY;
    return Promise.reject(new Error('Client Supabase indisponible.'));
  }

  /** Une session Supabase est-elle active ? (lecture synchrone via Auth) */
  function sessionActive() {
    return !!(window.Auth && window.Auth.isAuthenticated && window.Auth.isAuthenticated());
  }

  /** Projette un enregistrement local sur les seules colonnes serveur. */
  function versLigneServeur(client) {
    var ligne = {};
    COLONNES.forEach(function (col) {
      if (client[col] !== undefined) ligne[col] = client[col];
    });
    /* machines doit être un tableau JSON valide (colonne jsonb). */
    if (!Array.isArray(ligne.machines)) ligne.machines = [];
    return ligne;
  }

  /** Convertit une ligne serveur en enregistrement local (synchronisé). */
  function versEnregistrementLocal(ligne) {
    return {
      id:         ligne.id,
      user_id:    ligne.user_id,
      nom:        ligne.nom,
      adresse:    ligne.adresse,
      contact:    ligne.contact,
      machines:   Array.isArray(ligne.machines) ? ligne.machines : [],
      created_at: ligne.created_at,
      updated_at: ligne.updated_at,
      deleted:    !!ligne.deleted,
      _dirty:     false,
      _localUpdatedAt: ligne.updated_at,
    };
  }

  /** Compare deux dates ISO : true si `a` est strictement plus récente que `b`. */
  function plusRecent(a, b) {
    if (!a) return false;
    if (!b) return true;
    return new Date(a).getTime() > new Date(b).getTime();
  }

  /* ----------------------------------------------------------
     PUSH — envoi des enregistrements locaux dirty vers Supabase
     ---------------------------------------------------------- */
  function push(supabase) {
    return window.ClientsDB.getDirty().then(function (sales) {
      if (!sales.length) return 0;

      var lignes = sales.map(versLigneServeur);

      return supabase
        .from(TABLE)
        .upsert(lignes, { onConflict: 'id' })
        .select()
        .then(function (res) {
          if (res.error) throw res.error;

          var renvoyees = res.data || [];
          var parId = {};
          renvoyees.forEach(function (l) { parId[l.id] = l; });

          /* Retire le flag dirty et applique les valeurs canoniques du serveur
             (updated_at via trigger, user_id via défaut auth.uid()…). */
          var maj = sales.map(function (local) {
            var serveur = parId[local.id];
            var patch = serveur ? {
              user_id:    serveur.user_id,
              created_at: serveur.created_at,
              updated_at: serveur.updated_at,
              deleted:    !!serveur.deleted,
            } : {};
            return window.ClientsDB.markSynced(local.id, patch);
          });

          return Promise.all(maj).then(function () { return sales.length; });
        });
    });
  }

  /* ----------------------------------------------------------
     PULL — récupération des lignes serveur vers IndexedDB
     ---------------------------------------------------------- */
  function pull(supabase) {
    return window.ClientsDB.getLastSync().then(function (lastSync) {
      var requete = supabase.from(TABLE).select('*');

      /* Delta : seulement les lignes modifiées depuis le dernier pull réussi. */
      if (lastSync) {
        requete = requete.gt('updated_at', lastSync);
      }

      return requete.then(function (res) {
        if (res.error) throw res.error;

        var lignes = res.data || [];
        if (!lignes.length) return 0;

        /* Détermine le nouveau lastSync = max(updated_at) reçu. */
        var maxUpdated = lastSync || null;
        lignes.forEach(function (l) {
          if (plusRecent(l.updated_at, maxUpdated)) maxUpdated = l.updated_at;
        });

        return appliquerPull(lignes).then(function () {
          if (maxUpdated) return window.ClientsDB.setLastSync(maxUpdated);
        }).then(function () {
          return lignes.length;
        });
      });
    });
  }

  /**
   * Fusionne les lignes serveur dans IndexedDB en respectant le last-write-wins :
   * un enregistrement local non poussé (dirty) plus récent que la version
   * serveur n'est pas écrasé (il sera poussé au prochain push).
   */
  function appliquerPull(lignes) {
    /* On lit l'état local courant pour arbitrer les conflits. */
    return window.ClientsDB.getAllRaw().then(function (locaux) {
      var localParId = {};
      locaux.forEach(function (c) { localParId[c.id] = c; });

      var aEcrire = [];
      lignes.forEach(function (ligne) {
        var local = localParId[ligne.id];

        if (local && local._dirty === true && !plusRecent(ligne.updated_at, local.updated_at)) {
          /* Version locale dirty et au moins aussi récente → on la conserve. */
          return;
        }
        aEcrire.push(versEnregistrementLocal(ligne));
      });

      if (!aEcrire.length) return;
      /* notify=false : le pull ne doit pas redéclencher une boucle de synchro. */
      return window.ClientsDB.bulkPut(aEcrire, { markDirty: false, notify: false });
    });
  }

  /* ----------------------------------------------------------
     Orchestration d'une synchronisation complète
     ---------------------------------------------------------- */
  function sync() {
    /* Mode offline pur : pas de session => on resynchronisera plus tard. */
    if (!sessionActive()) {
      return Promise.resolve({ ok: false, skipped: true, reason: 'no-session', pulled: 0, pushed: 0 });
    }
    if (!isOnline()) {
      notifierStatut({ state: 'offline' });
      return Promise.resolve({ ok: false, skipped: true, reason: 'offline', pulled: 0, pushed: 0 });
    }

    /* Sérialisation : si une synchro tourne déjà, on note qu'il faudra
       potentiellement rejouer ensuite (mutation arrivée entre-temps). */
    if (_enCours) {
      _replanifier = true;
      return Promise.resolve({ ok: false, skipped: true, reason: 'busy', pulled: 0, pushed: 0 });
    }

    _enCours = true;
    _replanifier = false;
    notifierStatut({ state: 'syncing' });

    var resultat = { ok: false, pulled: 0, pushed: 0 };

    return clientPret().then(function (supabase) {
      /* Push d'abord (propage les changements locaux), puis pull (récupère le
         reste) : ainsi nos écritures sont prises en compte dans le lastSync. */
      return push(supabase).then(function (nbPush) {
        resultat.pushed = nbPush;
        return pull(supabase);
      }).then(function (nbPull) {
        resultat.pulled = nbPull;
        resultat.ok = true;
      });
    }).then(function () {
      notifierStatut({ state: 'done', pulled: resultat.pulled, pushed: resultat.pushed });
      return resultat;
    }).catch(function (err) {
      /* Erreur réseau / RLS / transitoire : pas d'erreur visible côté UI.
         Les enregistrements dirty restent en attente, on retentera. */
      var msg = (err && err.message) ? err.message : String(err);
      var reseau = /fetch|network|timeout/i.test(msg);
      if (!reseau) {
        console.warn('[SyncManager] Échec de synchronisation :', msg);
      }
      notifierStatut({ state: 'error', error: msg, network: reseau });
      resultat.ok = false;
      resultat.reason = 'error';
      resultat.error = msg;
      return resultat;
    }).then(function (res) {
      _enCours = false;
      /* Une mutation est survenue pendant la synchro : on rejoue (débouncé). */
      if (_replanifier) {
        _replanifier = false;
        syncSoon();
      }
      return res;
    });
  }

  /* ----------------------------------------------------------
     Synchro débouncée
     ---------------------------------------------------------- */
  function syncSoon(delai) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () {
      _timer = null;
      sync();
    }, typeof delai === 'number' ? delai : DEBOUNCE_MS);
  }

  /* ----------------------------------------------------------
     Installation des déclencheurs
     ---------------------------------------------------------- */
  function init() {
    if (_installe) return;
    _installe = true;

    /* 1. Mutation locale (db.js) → push débouncé. */
    window.addEventListener(
      (window.ClientsDB && window.ClientsDB.EVENT_CHANGE) || 'clients-db-changed',
      function () { syncSoon(); }
    );

    /* 2. Retour du réseau → synchro immédiate. */
    window.addEventListener('online', function () {
      notifierStatut({ state: 'idle' });
      syncSoon(200);
    });

    /* 3. Changement de session (login / refresh) → synchro au login. */
    if (window.Auth && typeof window.Auth.onChange === 'function') {
      var dejaConnecte = false;
      window.Auth.onChange(function (user) {
        var connecte = !!user;
        if (connecte && !dejaConnecte) {
          /* Transition déconnecté → connecté : on synchronise. */
          syncSoon(200);
        }
        dejaConnecte = connecte;
      });
    }

    /* 4. Démarrage : si déjà une session active et réseau dispo. */
    if (sessionActive()) {
      syncSoon(500);
    }
  }

  function onStatus(cb) {
    if (typeof cb === 'function') _listeners.push(cb);
  }

  /* ----------------------------------------------------------
     API publique
     ---------------------------------------------------------- */
  window.SyncManager = {
    init:      init,
    sync:      sync,
    syncSoon:  syncSoon,
    isOnline:  isOnline,
    isSyncing: isSyncing,
    onStatus:  onStatus,
  };

  /* Auto-initialisation au chargement du script (idempotente).
     Les déclencheurs internes (Auth.onChange, online…) prennent ensuite le
     relais ; aucune action UI n'est requise. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
