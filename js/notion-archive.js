/**
 * MUF-WebApp — Module NotionArchive
 * Archivage silencieux en arrière-plan vers des bases Notion dédiées.
 *
 * API publique : window.NotionArchive
 *   .archiverDemandeOS(data)    — upsert client + machine
 *   .archiverListePieces(data)  — upsert client + machine + entrée Listes de pièces
 *   .archiverCalculVide(data)   — upsert client + machine + entrée Calculs mise sous vide
 *   .archiverRapport(data)      — upsert client + machine + entrée Rapports d'intervention
 *   .initialiserBases()         — crée les 5 bases dans la page Notion du technicien
 *   .drainerFile()              — traite les entrées en attente dans localStorage
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Constantes
     ---------------------------------------------------------- */
  var CLE_QUEUE    = 'muf_archive_queue';
  var TIMEOUT_MS   = 8000;
  var NOTION_VER   = '2022-06-28';
  var API_BASE     = 'https://api.notion.com/v1';

  /* IDs des bases par défaut — écrasés si déjà configurés dans Parametrage */
  var DB_DEFAULTS = {
    notion_db_clients:       '09d86cf2-5cc3-48eb-aab7-95c40db21cc0',
    notion_db_machines:      'f161c257-40d7-4831-b4ba-0a9c768a57e7',
    notion_db_listes_pieces: 'd51837fd-dffc-4827-9fa0-68c1f5e0d3f1',
    notion_db_calculs_vide:  '34333608-c415-4f5f-b44e-6ba3c0bd9e63',
    notion_db_rapports:      '998f5fe3-76d0-4ccc-a0f9-ccb4869cecf3',
  };

  /* ----------------------------------------------------------
     Helpers internes
     ---------------------------------------------------------- */

  function token() {
    return window.Parametrage ? window.Parametrage.get('notion_token') : '';
  }

  function headers() {
    return {
      'Authorization':  'Bearer ' + token(),
      'Content-Type':   'application/json',
      'Notion-Version': NOTION_VER,
    };
  }

  /**
   * Retourne l'ID de base configuré (via Parametrage ou valeur par défaut).
   * Supprime les tirets pour les appels d'URL.
   */
  function dbId(cle) {
    var val = (window.Parametrage && window.Parametrage.get(cle)) || DB_DEFAULTS[cle] || '';
    return val.replace(/-/g, '');
  }

  /**
   * Retourne l'ID de base avec tirets (pour les propriétés relation).
   */
  function dbIdAvecTirets(cle) {
    var val = (window.Parametrage && window.Parametrage.get(cle)) || DB_DEFAULTS[cle] || '';
    /* Normaliser en format avec tirets si reçu sans */
    if (val && val.indexOf('-') === -1 && val.length === 32) {
      return val.slice(0, 8) + '-' + val.slice(8, 12) + '-' +
             val.slice(12, 16) + '-' + val.slice(16, 20) + '-' + val.slice(20);
    }
    return val;
  }

  /**
   * fetch avec timeout de TIMEOUT_MS ms.
   */
  function fetchAvecTimeout(url, opts) {
    return Promise.race([
      fetch(url, opts),
      new Promise(function (_, rejeter) {
        setTimeout(function () { rejeter(new Error('timeout')); }, TIMEOUT_MS);
      }),
    ]);
  }

  /**
   * Convertit une URL de page Notion vers l'ID sans tirets pour l'URL.
   * Format sortie : https://www.notion.so/<id-sans-tirets>
   */
  function pageUrl(id) {
    return 'https://www.notion.so/' + id.replace(/-/g, '');
  }

  /**
   * Tronquer un texte à maxLen caractères pour respecter la limite Notion.
   */
  function tronquer(texte, maxLen) {
    if (!texte) return '';
    var s = String(texte);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  /* ----------------------------------------------------------
     File d'attente localStorage
     ---------------------------------------------------------- */

  function lireFile() {
    try {
      var brut = localStorage.getItem(CLE_QUEUE);
      if (!brut) return [];
      return JSON.parse(brut) || [];
    } catch (e) {
      return [];
    }
  }

  function sauvegarderFile(file) {
    try {
      localStorage.setItem(CLE_QUEUE, JSON.stringify(file));
    } catch (e) {
      console.warn('[NotionArchive] Impossible d\'écrire la file :', e);
    }
  }

  function ajouterAFile(type, data) {
    var file = lireFile();
    file.push({ type: type, data: data, ts: Date.now() });
    sauvegarderFile(file);
    console.info('[NotionArchive] Ajouté en file (offline) :', type);
  }

  /* ----------------------------------------------------------
     Upsert Client
     Cherche par "Nom" exact, crée si absent.
     Retourne l'URL de la page Notion.
     ---------------------------------------------------------- */
  function upsertClient(nomClient) {
    var url = API_BASE + '/databases/' + dbId('notion_db_clients') + '/query';
    var payload = JSON.stringify({
      filter: {
        property: 'Nom',
        title: { equals: tronquer(nomClient, 100) },
      },
      page_size: 1,
    });

    return fetchAvecTimeout(url, {
      method:  'POST',
      headers: headers(),
      body:    payload,
    }).then(function (rep) {
      return rep.json();
    }).then(function (json) {
      if (json.results && json.results.length > 0) {
        return pageUrl(json.results[0].id);
      }
      /* Créer le client */
      return fetchAvecTimeout(API_BASE + '/pages', {
        method:  'POST',
        headers: headers(),
        body: JSON.stringify({
          parent:     { database_id: dbId('notion_db_clients') },
          properties: {
            Nom: { title: [{ text: { content: tronquer(nomClient, 100) } }] },
          },
        }),
      }).then(function (rep) { return rep.json(); })
        .then(function (page) { return pageUrl(page.id); });
    });
  }

  /* ----------------------------------------------------------
     Upsert Machine
     Cherche par "Type" exact, crée si absent en liant au client.
     Retourne l'URL de la page Notion.
     ---------------------------------------------------------- */
  function upsertMachine(typeMachine, urlClient) {
    var url = API_BASE + '/databases/' + dbId('notion_db_machines') + '/query';
    var payload = JSON.stringify({
      filter: {
        property: 'Type',
        title: { equals: tronquer(typeMachine, 100) },
      },
      page_size: 1,
    });

    /* Extraire l'ID depuis l'URL client pour la relation */
    var clientIdBrut = urlClient ? urlClient.replace('https://www.notion.so/', '') : '';
    var clientId = clientIdBrut.length === 32
      ? clientIdBrut.slice(0, 8) + '-' + clientIdBrut.slice(8, 12) + '-' +
        clientIdBrut.slice(12, 16) + '-' + clientIdBrut.slice(16, 20) + '-' +
        clientIdBrut.slice(20)
      : clientIdBrut;

    return fetchAvecTimeout(url, {
      method:  'POST',
      headers: headers(),
      body:    payload,
    }).then(function (rep) {
      return rep.json();
    }).then(function (json) {
      if (json.results && json.results.length > 0) {
        return pageUrl(json.results[0].id);
      }
      /* Créer la machine */
      var props = {
        Type: { title: [{ text: { content: tronquer(typeMachine, 100) } }] },
      };
      if (clientId) {
        props['Client'] = { relation: [{ id: clientId }] };
      }
      return fetchAvecTimeout(API_BASE + '/pages', {
        method:  'POST',
        headers: headers(),
        body: JSON.stringify({
          parent:     { database_id: dbId('notion_db_machines') },
          properties: props,
        }),
      }).then(function (rep) { return rep.json(); })
        .then(function (page) { return pageUrl(page.id); });
    });
  }

  /* ----------------------------------------------------------
     Extraction d'un ID Notion depuis une URL de page
     ---------------------------------------------------------- */
  function idDepuisUrl(pageUrlStr) {
    if (!pageUrlStr) return '';
    var brut = pageUrlStr.replace('https://www.notion.so/', '');
    if (brut.length === 32) {
      return brut.slice(0, 8) + '-' + brut.slice(8, 12) + '-' +
             brut.slice(12, 16) + '-' + brut.slice(16, 20) + '-' + brut.slice(20);
    }
    return brut;
  }

  /* ----------------------------------------------------------
     Exécuteur de base : upsert client + machine
     ---------------------------------------------------------- */
  function upsertClientEtMachine(data) {
    var nomClient   = data.nomClient   || '';
    var typeMachine = data.typeMachine || '';
    return upsertClient(nomClient).then(function (urlClient) {
      return upsertMachine(typeMachine, urlClient).then(function (urlMachine) {
        return { urlClient: urlClient, urlMachine: urlMachine };
      });
    });
  }

  /* ----------------------------------------------------------
     Archivage Demande OS
     Pas de base transactionnelle dédiée — upsert client + machine uniquement.
     ---------------------------------------------------------- */
  function archiverDemandeOS(data) {
    if (!token() || !navigator.onLine) {
      ajouterAFile('demandeOS', data);
      return;
    }
    upsertClientEtMachine(data).catch(function (err) {
      console.warn('[NotionArchive] archiverDemandeOS échoué :', err);
    });
  }

  /* ----------------------------------------------------------
     Archivage Liste de pièces
     ---------------------------------------------------------- */
  function archiverListePieces(data) {
    if (!token() || !navigator.onLine) {
      ajouterAFile('listePieces', data);
      return;
    }
    upsertClientEtMachine(data).then(function (res) {
      var props = {
        Reference: { title: [{ text: { content: tronquer(data.reference || '', 100) } }] },
      };
      if (data.date) {
        props['Date'] = { date: { start: data.date } };
      }
      if (res.urlClient) {
        props['Client'] = { relation: [{ id: idDepuisUrl(res.urlClient) }] };
      }
      if (res.urlMachine) {
        props['Machine'] = { relation: [{ id: idDepuisUrl(res.urlMachine) }] };
      }
      if (data.contenu) {
        props['Contenu'] = { rich_text: [{ text: { content: tronquer(data.contenu, 2000) } }] };
      }
      return fetchAvecTimeout(API_BASE + '/pages', {
        method:  'POST',
        headers: headers(),
        body: JSON.stringify({
          parent:     { database_id: dbId('notion_db_listes_pieces') },
          properties: props,
        }),
      });
    }).catch(function (err) {
      console.warn('[NotionArchive] archiverListePieces échoué :', err);
    });
  }

  /* ----------------------------------------------------------
     Archivage Calcul mise sous vide
     ---------------------------------------------------------- */
  function archiverCalculVide(data) {
    if (!token() || !navigator.onLine) {
      ajouterAFile('calculVide', data);
      return;
    }
    upsertClientEtMachine(data).then(function (res) {
      var props = {
        Reference: { title: [{ text: { content: tronquer(data.reference || '', 100) } }] },
      };
      if (data.date) {
        props['Date'] = { date: { start: data.date } };
      }
      if (res.urlClient) {
        props['Client'] = { relation: [{ id: idDepuisUrl(res.urlClient) }] };
      }
      if (res.urlMachine) {
        props['Machine'] = { relation: [{ id: idDepuisUrl(res.urlMachine) }] };
      }
      if (data.resultat) {
        props['Resultat'] = { rich_text: [{ text: { content: tronquer(data.resultat, 2000) } }] };
      }
      return fetchAvecTimeout(API_BASE + '/pages', {
        method:  'POST',
        headers: headers(),
        body: JSON.stringify({
          parent:     { database_id: dbId('notion_db_calculs_vide') },
          properties: props,
        }),
      });
    }).catch(function (err) {
      console.warn('[NotionArchive] archiverCalculVide échoué :', err);
    });
  }

  /* ----------------------------------------------------------
     Archivage Rapport d'intervention
     ---------------------------------------------------------- */
  function archiverRapport(data) {
    if (!token() || !navigator.onLine) {
      ajouterAFile('rapport', data);
      return;
    }
    upsertClientEtMachine(data).then(function (res) {
      var props = {
        Reference: { title: [{ text: { content: tronquer(data.reference || '', 100) } }] },
      };
      if (data.date) {
        props['Date'] = { date: { start: data.date } };
      }
      if (res.urlClient) {
        props['Client'] = { relation: [{ id: idDepuisUrl(res.urlClient) }] };
      }
      if (res.urlMachine) {
        props['Machine'] = { relation: [{ id: idDepuisUrl(res.urlMachine) }] };
      }
      if (data.statut) {
        props['Statut'] = { select: { name: data.statut } };
      }
      if (data.technicien) {
        props['Technicien'] = { rich_text: [{ text: { content: tronquer(data.technicien, 200) } }] };
      }
      return fetchAvecTimeout(API_BASE + '/pages', {
        method:  'POST',
        headers: headers(),
        body: JSON.stringify({
          parent:     { database_id: dbId('notion_db_rapports') },
          properties: props,
        }),
      });
    }).catch(function (err) {
      console.warn('[NotionArchive] archiverRapport échoué :', err);
    });
  }

  /* ----------------------------------------------------------
     Drainer la file d'attente
     ---------------------------------------------------------- */
  function drainerFile() {
    if (!token() || !navigator.onLine) return;
    var file = lireFile();
    if (file.length === 0) return;

    console.info('[NotionArchive] Drain de la file : ' + file.length + ' entrée(s).');

    /* Vider la file avant traitement pour éviter les doublons en cas d'erreur */
    sauvegarderFile([]);

    file.forEach(function (item) {
      try {
        switch (item.type) {
          case 'demandeOS':
            upsertClientEtMachine(item.data).catch(function (e) {
              console.warn('[NotionArchive] Drain demandeOS échoué :', e);
            });
            break;
          case 'listePieces':
            archiverListePieces(item.data);
            break;
          case 'calculVide':
            archiverCalculVide(item.data);
            break;
          case 'rapport':
            archiverRapport(item.data);
            break;
          default:
            console.warn('[NotionArchive] Type inconnu dans la file :', item.type);
        }
      } catch (e) {
        console.warn('[NotionArchive] Erreur drain item :', e);
      }
    });
  }

  /* ----------------------------------------------------------
     Création d'une propriété title pour les schémas
     ---------------------------------------------------------- */
  function propTitle() { return { title: {} }; }
  function propRichText() { return { rich_text: {} }; }
  function propDate() { return { date: {} }; }
  function propNumber() { return { number: {} }; }
  function propEmail() { return { email: {} }; }
  function propRelation(dbIdAvecT) { return { relation: { database_id: dbIdAvecT, single_property: {} } }; }
  function propSelect(options) {
    return { select: { options: options.map(function (n) { return { name: n }; }) } };
  }

  /* ----------------------------------------------------------
     Créer une base Notion dans la page du technicien
     ---------------------------------------------------------- */
  function creerBase(titre, properties) {
    var pageId = window.Parametrage ? window.Parametrage.get('notion_page_id') : '';
    if (!pageId) return Promise.reject(new Error('notion_page_id non configuré'));

    return fetchAvecTimeout(API_BASE + '/databases', {
      method:  'POST',
      headers: headers(),
      body: JSON.stringify({
        parent: { type: 'page_id', page_id: pageId },
        title:  [{ type: 'text', text: { content: titre } }],
        properties: properties,
      }),
    }).then(function (rep) {
      if (!rep.ok) {
        return rep.json().then(function (err) {
          throw new Error('Notion ' + rep.status + ' : ' + (err.message || rep.statusText));
        });
      }
      return rep.json();
    });
  }

  /* ----------------------------------------------------------
     Initialiser les 5 bases
     ---------------------------------------------------------- */
  function initialiserBases() {
    if (!token()) {
      return Promise.reject(new Error('Token Notion absent. Veuillez le renseigner dans Paramétrage.'));
    }
    if (!window.Parametrage || !window.Parametrage.get('notion_page_id')) {
      return Promise.reject(new Error('ID de page Notion absent. Veuillez le renseigner dans Paramétrage.'));
    }

    var idClients, idMachines;

    /* 1. Clients */
    return creerBase('Clients', {
      Nom:           propTitle(),
      Ville:         propRichText(),
      'Code postal': propRichText(),
      Interlocuteur: propRichText(),
      Email:         propEmail(),
    }).then(function (db) {
      idClients = db.id;
      window.Parametrage.set('notion_db_clients', idClients);
      console.info('[NotionArchive] Base Clients créée :', idClients);

      /* 2. Machines */
      return creerBase('Machines', {
        Type:         propTitle(),
        'N° de série': propRichText(),
        Client:       propRelation(idClients),
        Annee:        propNumber(),
      });
    }).then(function (db) {
      idMachines = db.id;
      window.Parametrage.set('notion_db_machines', idMachines);
      console.info('[NotionArchive] Base Machines créée :', idMachines);

      /* 3. Listes de pièces */
      return creerBase('Listes de pièces', {
        Reference: propTitle(),
        Date:      propDate(),
        Client:    propRelation(idClients),
        Machine:   propRelation(idMachines),
        Contenu:   propRichText(),
      });
    }).then(function (db) {
      window.Parametrage.set('notion_db_listes_pieces', db.id);
      console.info('[NotionArchive] Base Listes de pièces créée :', db.id);

      /* 4. Calculs mise sous vide */
      return creerBase('Calculs mise sous vide', {
        Reference: propTitle(),
        Date:      propDate(),
        Client:    propRelation(idClients),
        Machine:   propRelation(idMachines),
        Resultat:  propRichText(),
      });
    }).then(function (db) {
      window.Parametrage.set('notion_db_calculs_vide', db.id);
      console.info('[NotionArchive] Base Calculs mise sous vide créée :', db.id);

      /* 5. Rapports d'intervention */
      return creerBase("Rapports d'intervention", {
        Reference:   propTitle(),
        Date:        propDate(),
        Client:      propRelation(idClients),
        Machine:     propRelation(idMachines),
        Statut:      propSelect(['En cours', 'Terminé']),
        Technicien:  propRichText(),
      });
    }).then(function (db) {
      window.Parametrage.set('notion_db_rapports', db.id);
      console.info('[NotionArchive] Base Rapports créée :', db.id);
      console.info('[NotionArchive] Toutes les bases ont été créées avec succès.');
    });
  }

  /* ----------------------------------------------------------
     Exposition globale
     ---------------------------------------------------------- */
  window.NotionArchive = {
    archiverDemandeOS:   archiverDemandeOS,
    archiverListePieces: archiverListePieces,
    archiverCalculVide:  archiverCalculVide,
    archiverRapport:     archiverRapport,
    initialiserBases:    initialiserBases,
    drainerFile:         drainerFile,
  };

})();
