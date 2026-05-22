/**
 * MUF-WebApp — Module Paramétrage
 * Gestion de la configuration persistée en localStorage.
 *
 * API publique : window.Parametrage
 *   .get(key)          → valeur d'un champ
 *   .set(key, value)   → écriture + sauvegarde localStorage
 *   .getAll()          → objet complet de configuration
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Clé localStorage et structure par défaut
     ---------------------------------------------------------- */
  const CLE_STORAGE = 'muf_config';

  const CONFIG_DEFAUT = {
    nom:               '',
    prenom:            '',
    emails_frequents:  [],   /* tableau de { label, adresse } */
    email_maintenance: '',   /* adresse du service maintenance Multivac */
    contacts_support:  [],   /* contacts support technique */
    date_format:      'DD/MM/YYYY',
    unites:           'SI',
  };

  /* ----------------------------------------------------------
     Chargement initial depuis localStorage
     ---------------------------------------------------------- */
  function chargerDepuisStorage() {
    try {
      const brut = localStorage.getItem(CLE_STORAGE);
      if (!brut) return Object.assign({}, CONFIG_DEFAUT);
      const parse = JSON.parse(brut);
      /* Fusion avec les valeurs par défaut pour les clés manquantes */
      return Object.assign({}, CONFIG_DEFAUT, parse);
    } catch (e) {
      console.warn('[Parametrage] Impossible de lire localStorage :', e);
      return Object.assign({}, CONFIG_DEFAUT);
    }
  }

  /* État interne du module — initialisé une seule fois */
  let _config = chargerDepuisStorage();

  /* ----------------------------------------------------------
     Sauvegarde vers localStorage
     ---------------------------------------------------------- */
  function sauvegarderStorage() {
    try {
      localStorage.setItem(CLE_STORAGE, JSON.stringify(_config));
    } catch (e) {
      console.error('[Parametrage] Erreur écriture localStorage :', e);
    }
  }

  /* ----------------------------------------------------------
     API publique
     ---------------------------------------------------------- */
  const Parametrage = {

    /**
     * Lire une valeur de configuration.
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      return _config[key];
    },

    /**
     * Écrire une valeur et persister en localStorage.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      if (!(key in CONFIG_DEFAUT)) {
        console.warn(`[Parametrage] Clé inconnue : "${key}"`);
      }
      _config[key] = value;
      sauvegarderStorage();
    },

    /**
     * Retourner une copie de toute la configuration.
     * @returns {object}
     */
    getAll() {
      return Object.assign({}, _config);
    },
  };

  /* Exposition globale */
  window.Parametrage = Parametrage;

})();
