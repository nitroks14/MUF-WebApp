/**
 * MUF-WebApp — Couche de données locale IndexedDB (référentiel "clients")
 *
 * Source de vérité **offline-first** pour le référentiel des clients.
 * Toute l'application lit et écrit ici ; la synchronisation avec Supabase est
 * assurée séparément par js/sync-manager.js. Ce module ne connaît PAS le réseau :
 * il fonctionne intégralement hors ligne.
 *
 * Modèle d'un client (object store `clients`, keyPath `id`) :
 *   {
 *     id:          string  (uuid, généré côté client via crypto.randomUUID())
 *     user_id:     string  (renseigné côté serveur via auth.uid(), peut être absent localement)
 *     nom:         string  (NOT NULL applicatif)
 *     adresse:     string | null
 *     contact:     string | null
 *     machines:    Array<{ type, numero }>   (défaut [])
 *     created_at:  string ISO  | null
 *     updated_at:  string ISO  | null
 *     deleted:     boolean      (soft-delete — défaut false)
 *
 *     // --- Champs de synchronisation, internes au client (préfixe _) ---
 *     _dirty:           boolean  (true => en attente de push vers Supabase)
 *     _localUpdatedAt:  string ISO  (horodatage de la dernière mutation locale)
 *   }
 *
 * Le timestamp `lastSync` (dernier pull réussi) est conservé dans un second
 * object store `meta` (clé/valeur), lu/écrit par le sync-manager.
 *
 * API publique — window.ClientsDB :
 *   .ready()                  → Promise<IDBDatabase>
 *   .getAll()                 → Promise<Client[]>   (exclut deleted=true)
 *   .getAllRaw()              → Promise<Client[]>   (inclut deleted — usage sync)
 *   .get(id)                  → Promise<Client|null> (null si absent ou supprimé)
 *   .getRaw(id)               → Promise<Client|null> (tel quel, même si supprimé)
 *   .add(data)                → Promise<Client>   (crée : génère id + marque dirty)
 *   .put(client)             → Promise<Client>   (insère/maj : marque dirty)
 *   .remove(id)               → Promise<Client|null> (soft-delete : deleted=true + dirty)
 *   .bulkPut(list, opts)      → Promise<void>     (upsert en masse — usage sync pull)
 *   .getDirty()               → Promise<Client[]> (enregistrements à pousser)
 *   .markSynced(id, patch)    → Promise<void>     (retire le flag dirty, applique un patch serveur)
 *   .getLastSync()            → Promise<string|null>
 *   .setLastSync(iso)         → Promise<void>
 *   .clear()                  → Promise<void>      (vide tout — usage logout/tests)
 *
 * À chaque mutation locale (add / put / remove), un événement
 * `clients-db-changed` est émis sur `window` (détail : { source, id }) afin
 * que le sync-manager déclenche un push débouncé sans couplage fort.
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Constantes de base
     ---------------------------------------------------------- */
  var DB_NOM      = 'muf-webapp';
  var DB_VERSION  = 1;
  var STORE_CLIENTS = 'clients';
  var STORE_META    = 'meta';
  var META_LAST_SYNC = 'lastSync';

  var EVENT_CHANGE = 'clients-db-changed';

  /* Promesse d'ouverture mémorisée (singleton) */
  var _dbPromise = null;

  /* ----------------------------------------------------------
     Ouverture / migration de la base
     ---------------------------------------------------------- */
  function ouvrir() {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB non supporté par ce navigateur.'));
        return;
      }

      var requete = indexedDB.open(DB_NOM, DB_VERSION);

      requete.onupgradeneeded = function (e) {
        var db = e.target.result;

        if (!db.objectStoreNames.contains(STORE_CLIENTS)) {
          var store = db.createObjectStore(STORE_CLIENTS, { keyPath: 'id' });
          /* Index utiles à la synchronisation */
          store.createIndex('_dirty', '_dirty', { unique: false });
          store.createIndex('updated_at', 'updated_at', { unique: false });
          store.createIndex('deleted', 'deleted', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'cle' });
        }
      };

      requete.onsuccess = function (e) {
        resolve(e.target.result);
      };

      requete.onerror = function () {
        reject(requete.error || new Error('Ouverture IndexedDB impossible.'));
      };

      requete.onblocked = function () {
        console.warn('[ClientsDB] Ouverture bloquée (un autre onglet détient une version antérieure).');
      };
    });

    return _dbPromise;
  }

  /* ----------------------------------------------------------
     Helpers de transaction (promesses)
     ---------------------------------------------------------- */
  function transaction(storeNames, mode) {
    return ouvrir().then(function (db) {
      var tx = db.transaction(storeNames, mode);
      return tx;
    });
  }

  /* Encapsule une IDBRequest dans une promesse. */
  function promesseRequete(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  /* Encapsule la complétion d'une transaction dans une promesse. */
  function promesseTransaction(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror    = function () { reject(tx.error); };
      tx.onabort    = function () { reject(tx.error || new Error('Transaction annulée.')); };
    });
  }

  /* ----------------------------------------------------------
     Utilitaires de domaine
     ---------------------------------------------------------- */

  /** Génère un identifiant unique stable côté client. */
  function genererId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    /* Repli (navigateurs anciens) — suffisant pour une clé locale. */
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function maintenantISO() {
    return new Date().toISOString();
  }

  /**
   * Normalise un enregistrement avant écriture locale : garantit les champs
   * obligatoires et un typage cohérent (machines = tableau, deleted = booléen).
   */
  function normaliser(client) {
    var c = Object.assign({}, client);
    if (!c.id) c.id = genererId();
    c.nom      = c.nom != null ? String(c.nom) : '';
    c.adresse  = c.adresse != null ? c.adresse : null;
    c.contact  = c.contact != null ? c.contact : null;
    c.machines = Array.isArray(c.machines) ? c.machines : [];
    c.deleted  = !!c.deleted;
    return c;
  }

  /** Émet l'événement de changement (consommé par le sync-manager). */
  function notifierChangement(source, id) {
    try {
      window.dispatchEvent(new CustomEvent(EVENT_CHANGE, {
        detail: { source: source, id: id },
      }));
    } catch (e) {
      /* CustomEvent indisponible : non bloquant. */
    }
  }

  /* ----------------------------------------------------------
     Opérations de lecture
     ---------------------------------------------------------- */

  function getAllRaw() {
    return transaction(STORE_CLIENTS, 'readonly').then(function (tx) {
      var store = tx.objectStore(STORE_CLIENTS);
      return promesseRequete(store.getAll());
    });
  }

  function getAll() {
    return getAllRaw().then(function (liste) {
      return liste.filter(function (c) { return !c.deleted; });
    });
  }

  function getRaw(id) {
    return transaction(STORE_CLIENTS, 'readonly').then(function (tx) {
      var store = tx.objectStore(STORE_CLIENTS);
      return promesseRequete(store.get(id));
    }).then(function (res) {
      return res || null;
    });
  }

  function get(id) {
    return getRaw(id).then(function (c) {
      if (!c || c.deleted) return null;
      return c;
    });
  }

  function getDirty() {
    return getAllRaw().then(function (liste) {
      return liste.filter(function (c) { return c._dirty === true; });
    });
  }

  /* ----------------------------------------------------------
     Opérations d'écriture
     ---------------------------------------------------------- */

  /**
   * Crée un nouveau client : génère l'id, horodate et marque dirty.
   * @param {object} data  champs métier ({ nom, adresse, contact, machines })
   * @returns {Promise<object>} l'enregistrement persisté
   */
  function add(data) {
    var c = normaliser(data || {});
    c.id = genererId(); /* id toujours neuf, on ignore un id fourni par erreur */
    var now = maintenantISO();
    if (!c.created_at) c.created_at = now;
    c.updated_at      = c.updated_at || now;
    c._localUpdatedAt = now;
    c._dirty          = true;

    return ecrire(c, 'add');
  }

  /**
   * Insère ou met à jour un client (upsert applicatif) et le marque dirty.
   * Conserve l'id existant ; en génère un si absent.
   * @returns {Promise<object>}
   */
  function put(client) {
    var c = normaliser(client || {});
    var now = maintenantISO();
    if (!c.created_at) c.created_at = now;
    c.updated_at      = now;
    c._localUpdatedAt = now;
    c._dirty          = true;

    return ecrire(c, 'put');
  }

  /**
   * Soft-delete : marque l'enregistrement deleted=true (et dirty) sans
   * l'effacer, afin que la suppression soit propagée à Supabase.
   * @returns {Promise<object|null>} l'enregistrement supprimé, ou null si absent
   */
  function remove(id) {
    return getRaw(id).then(function (c) {
      if (!c) return null;
      var now = maintenantISO();
      c.deleted         = true;
      c.updated_at      = now;
      c._localUpdatedAt = now;
      c._dirty          = true;
      return ecrire(c, 'remove');
    });
  }

  /** Écriture unitaire + notification de changement. */
  function ecrire(client, source) {
    return transaction(STORE_CLIENTS, 'readwrite').then(function (tx) {
      var store = tx.objectStore(STORE_CLIENTS);
      store.put(client);
      return promesseTransaction(tx).then(function () { return client; });
    }).then(function (saved) {
      notifierChangement(source, saved.id);
      return saved;
    });
  }

  /**
   * Upsert en masse — réservé à la synchronisation (pull depuis Supabase).
   * Par défaut, n'émet PAS d'événement de changement et NE marque PAS dirty
   * (les données viennent du serveur, elles sont déjà à jour).
   *
   * @param {Array<object>} liste
   * @param {object} [opts]
   * @param {boolean} [opts.markDirty=false] forcer le flag dirty
   * @param {boolean} [opts.notify=false]    émettre l'événement de changement
   */
  function bulkPut(liste, opts) {
    opts = opts || {};
    if (!Array.isArray(liste) || liste.length === 0) return Promise.resolve();

    return transaction(STORE_CLIENTS, 'readwrite').then(function (tx) {
      var store = tx.objectStore(STORE_CLIENTS);
      liste.forEach(function (item) {
        var c = normaliser(item);
        c._dirty = opts.markDirty === true ? true : (c._dirty === true);
        if (!c._localUpdatedAt) c._localUpdatedAt = c.updated_at || maintenantISO();
        store.put(c);
      });
      return promesseTransaction(tx);
    }).then(function () {
      if (opts.notify === true) notifierChangement('bulkPut', null);
    });
  }

  /**
   * Marque un enregistrement comme synchronisé : retire le flag dirty et
   * applique éventuellement un patch renvoyé par le serveur (id, user_id,
   * updated_at canoniques…). Appelé par le sync-manager après un push réussi.
   *
   * @param {string} id
   * @param {object} [patch] champs serveur à fusionner
   */
  function markSynced(id, patch) {
    return transaction(STORE_CLIENTS, 'readwrite').then(function (tx) {
      var store = tx.objectStore(STORE_CLIENTS);
      return promesseRequete(store.get(id)).then(function (existant) {
        if (!existant) return promesseTransaction(tx);
        var maj = Object.assign({}, existant, patch || {});
        maj._dirty = false;
        store.put(maj);
        return promesseTransaction(tx);
      });
    });
  }

  /* ----------------------------------------------------------
     Métadonnées (lastSync)
     ---------------------------------------------------------- */
  function getMeta(cle) {
    return transaction(STORE_META, 'readonly').then(function (tx) {
      var store = tx.objectStore(STORE_META);
      return promesseRequete(store.get(cle));
    }).then(function (row) {
      return row ? row.valeur : null;
    });
  }

  function setMeta(cle, valeur) {
    return transaction(STORE_META, 'readwrite').then(function (tx) {
      var store = tx.objectStore(STORE_META);
      store.put({ cle: cle, valeur: valeur });
      return promesseTransaction(tx);
    });
  }

  function getLastSync() { return getMeta(META_LAST_SYNC); }
  function setLastSync(iso) { return setMeta(META_LAST_SYNC, iso); }

  /* ----------------------------------------------------------
     Maintenance
     ---------------------------------------------------------- */
  function clear() {
    return transaction([STORE_CLIENTS, STORE_META], 'readwrite').then(function (tx) {
      tx.objectStore(STORE_CLIENTS).clear();
      tx.objectStore(STORE_META).clear();
      return promesseTransaction(tx);
    });
  }

  /* ----------------------------------------------------------
     API publique
     ---------------------------------------------------------- */
  window.ClientsDB = {
    ready:       ouvrir,
    getAll:      getAll,
    getAllRaw:   getAllRaw,
    get:         get,
    getRaw:      getRaw,
    add:         add,
    put:         put,
    remove:      remove,
    bulkPut:     bulkPut,
    getDirty:    getDirty,
    markSynced:  markSynced,
    getLastSync: getLastSync,
    setLastSync: setLastSync,
    clear:       clear,

    /* Constantes exposées pour les consommateurs (sync-manager, plugins) */
    EVENT_CHANGE: EVENT_CHANGE,
    genererId:    genererId,
  };

})();
