/**
 * MUF-WebApp — Module Paramétrage
 * Gestion de la configuration persistée en localStorage
 * et synchronisation bidirectionnelle avec Notion.
 *
 * API publique : window.Parametrage
 *   .get(key)          → valeur d'un champ
 *   .set(key, value)   → écriture + sauvegarde localStorage
 *   .getAll()          → objet complet de configuration
 *   .syncToNotion()    → écrit la config dans la page Notion
 *   .syncFromNotion()  → lit la config depuis Notion
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Clé localStorage et structure par défaut
     ---------------------------------------------------------- */
  const CLE_STORAGE = 'muf_config';

  const CONFIG_DEFAUT = {
    nom:              '',
    prenom:           '',
    email:            '',
    telephone:        '',
    agence:           '',
    signature:        '',
    emails_frequents: [],   /* tableau de { label, adresse } */
    notion_token:     '',
    notion_page_id:   '',
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
     Construction de l'URL et des en-têtes Notion
     ---------------------------------------------------------- */
  function headersNotion() {
    return {
      'Authorization': `Bearer ${_config.notion_token}`,
      'Content-Type':  'application/json',
      'Notion-Version': '2022-06-28',
    };
  }

  /**
   * Retrouve ou crée un bloc "code" enfant de la page Notion
   * dont le titre de sous-bloc contient "MUF-Config".
   * La config est stockée en JSON dans un bloc de type "code"
   * sous la page racine du technicien.
   *
   * Stratégie :
   *   1. Lire les blocs enfants de notion_page_id
   *   2. Chercher un bloc code avec "MUF-Config" dans le premier
   *      fragment de texte riche
   *   3. Si trouvé → retourner son id
   *   4. Sinon    → créer ce bloc et retourner le nouvel id
   */
  async function retrouverOuCreerBlocConfig() {
    const pageId = _config.notion_page_id;

    /* Lecture des blocs enfants */
    const repListe = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      { headers: headersNotion() }
    );

    if (!repListe.ok) {
      const err = await repListe.json().catch(() => ({}));
      throw new Error(
        `Notion : impossible de lire la page (${repListe.status}) — ${err.message || repListe.statusText}`
      );
    }

    const data = await repListe.json();
    const blocs = data.results || [];

    /* Recherche d'un bloc code existant contenant "MUF-Config" */
    const blocExistant = blocs.find(b => {
      if (b.type !== 'code') return false;
      const fragments = b.code?.rich_text || [];
      return fragments.some(f =>
        (f.plain_text || '').startsWith('MUF-Config:')
      );
    });

    if (blocExistant) return blocExistant.id;

    /* Création d'un nouveau bloc code */
    const repCreation = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method:  'PATCH',
        headers: headersNotion(),
        body: JSON.stringify({
          children: [{
            object: 'block',
            type:   'code',
            code: {
              language:  'json',
              rich_text: [{
                type: 'text',
                text: { content: 'MUF-Config: {}' },
              }],
            },
          }],
        }),
      }
    );

    if (!repCreation.ok) {
      const err = await repCreation.json().catch(() => ({}));
      throw new Error(
        `Notion : impossible de créer le bloc config (${repCreation.status}) — ${err.message || repCreation.statusText}`
      );
    }

    const dataCreation = await repCreation.json();
    return dataCreation.results[0].id;
  }

  /* ----------------------------------------------------------
     Synchronisation → Notion (écriture)
     ---------------------------------------------------------- */
  async function syncToNotion() {
    if (!_config.notion_token) {
      throw new Error('Token Notion non renseigné. Veuillez le saisir dans les paramètres.');
    }
    if (!_config.notion_page_id) {
      throw new Error('ID de page Notion non renseigné. Veuillez le saisir dans les paramètres.');
    }

    /* Nettoyage des données sensibles — on n'envoie pas le token vers Notion */
    const configAEnvoyer = Object.assign({}, _config);
    delete configAEnvoyer.notion_token; /* Le token ne quitte pas l'appareil */

    const jsonConfig = `MUF-Config: ${JSON.stringify(configAEnvoyer, null, 2)}`;

    /* Vérification longueur (Notion : max 2000 caractères par fragment) */
    if (jsonConfig.length > 1990) {
      throw new Error(
        'Configuration trop volumineuse pour Notion. Réduisez le nombre d\'emails fréquents ou la longueur de la signature.'
      );
    }

    const blocId = await retrouverOuCreerBlocConfig();

    /* Mise à jour du contenu du bloc */
    const repMaj = await fetch(
      `https://api.notion.com/v1/blocks/${blocId}`,
      {
        method:  'PATCH',
        headers: headersNotion(),
        body: JSON.stringify({
          code: {
            rich_text: [{
              type: 'text',
              text: { content: jsonConfig },
            }],
            language: 'json',
          },
        }),
      }
    );

    if (!repMaj.ok) {
      const err = await repMaj.json().catch(() => ({}));
      throw new Error(
        `Notion : échec de la mise à jour (${repMaj.status}) — ${err.message || repMaj.statusText}`
      );
    }

    console.log('[Parametrage] Config synchronisée vers Notion avec succès.');
  }

  /* ----------------------------------------------------------
     Synchronisation ← Notion (lecture)
     ---------------------------------------------------------- */
  async function syncFromNotion() {
    if (!_config.notion_token || !_config.notion_page_id) {
      /* Pas de token ou d'ID → synchronisation silencieuse ignorée */
      return;
    }

    const pageId = _config.notion_page_id;

    const repListe = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`,
      { headers: headersNotion() }
    );

    if (!repListe.ok) {
      const err = await repListe.json().catch(() => ({}));
      throw new Error(
        `Notion : impossible de lire la page (${repListe.status}) — ${err.message || repListe.statusText}`
      );
    }

    const data = await repListe.json();
    const blocs = data.results || [];

    const blocConfig = blocs.find(b => {
      if (b.type !== 'code') return false;
      const fragments = b.code?.rich_text || [];
      return fragments.some(f =>
        (f.plain_text || '').startsWith('MUF-Config:')
      );
    });

    if (!blocConfig) {
      console.info('[Parametrage] Aucune config trouvée dans Notion — config locale conservée.');
      return;
    }

    /* Extraction du JSON depuis le contenu du bloc */
    const contenu = (blocConfig.code.rich_text || [])
      .map(f => f.plain_text || '')
      .join('');

    const posDeuxPoints = contenu.indexOf(':');
    if (posDeuxPoints === -1) {
      throw new Error('Notion : format du bloc de configuration invalide.');
    }

    const jsonBrut = contenu.slice(posDeuxPoints + 1).trim();

    let configDistante;
    try {
      configDistante = JSON.parse(jsonBrut);
    } catch (e) {
      throw new Error(`Notion : le contenu du bloc config n'est pas un JSON valide — ${e.message}`);
    }

    /* Fusion : on préserve le token local (non stocké sur Notion) */
    const tokenLocal      = _config.notion_token;
    const pageIdLocal     = _config.notion_page_id;
    _config = Object.assign({}, CONFIG_DEFAUT, configDistante, {
      notion_token:   tokenLocal,
      notion_page_id: pageIdLocal,
    });

    sauvegarderStorage();
    console.log('[Parametrage] Config chargée depuis Notion avec succès.');
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

    /**
     * Écrire la config dans la page Notion du technicien.
     * Retourne une Promise.
     * @returns {Promise<void>}
     */
    syncToNotion,

    /**
     * Lire la config depuis Notion et fusionner avec le local.
     * Retourne une Promise.
     * @returns {Promise<void>}
     */
    syncFromNotion,
  };

  /* Exposition globale */
  window.Parametrage = Parametrage;

})();
