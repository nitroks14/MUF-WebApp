/**
 * MUF-WebApp — Service Worker
 * Stratégie :
 *   - Network-first pour le SHELL APPLICATIF (index.html, CSS, scripts js/*.js)
 *     avec repli cache hors-ligne. Indispensable : le HTML, le CSS et le JS du
 *     shell forment un TOUT cohérent et doivent toujours être servis dans la
 *     MÊME version. Les servir en cache-first désynchronisait le HTML (servi
 *     network-first en navigation) d'un CSS/JS périmé après mise à jour, d'où
 *     un header non stylé + un accueil vide (régression corrigée en v76).
 *   - Cache-first pour les LIBS VENDORISÉES immuables (js/libs/**) : elles ne
 *     changent pas entre déploiements → chargement instantané et offline garanti.
 *   - Network-first pour les plugins (toujours la version fraîche), repli cache.
 *   - Navigation fallback : toute requête de navigation (ouverture de l'app,
 *     PWA installée) qui échoue hors-ligne renvoie index.html depuis le cache.
 *     C'est ce qui permet à l'app de S'OUVRIR sans réseau.
 */

'use strict';

/* Nom du cache — incrémenter la version pour invalider l'ancien cache.
   Version courante : v77. Historique des versions → voir CHANGELOG.md. */
const CACHE_NOM     = 'muf-webapp-v77';
const CACHE_PLUGINS = 'muf-plugins-v77';

/* Document de repli pour les navigations hors-ligne (PWA / refresh offline). */
const FALLBACK_DOC = './index.html';

/* Liste des assets statiques à précacher.
   supabase-js est désormais VENDORISÉ en local (js/libs/supabase.umd.js) :
   il est donc précaché ici, ce qui permet le démarrage hors-ligne. */
const ASSETS_STATIQUES = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/auth.css',
  './js/config.js',
  './js/libs/supabase.umd.js',
  './js/supabase-client.js',
  './js/auth.js',
  './js/db.js',
  './js/sync-manager.js',
  './js/app.js',
  './js/parametrage.js',
  './js/client-autocomplete.js',
  './js/client-learning.js',
  './js/aruco-marker.js',
  './js/aruco-vision.js',
  './js/libs/lz-string.min.js',
  './js/libs/fuse.min.js',
  './js/libs/qrcode.min.js',
  './js/libs/jsQR.min.js',
  /* Libs de plugins VENDORISÉES (offline complet) : jsPDF, xlsx + ExcelJS,
     Blockly. Précachées ici car chargées en lazy depuis la racine.
     Historique détaillé des versions du Service Worker → voir CHANGELOG.md. */
  './js/libs/jspdf.umd.min.js',
  './js/libs/xlsx.full.min.js',
  './js/libs/exceljs.min.js',
  './js/libs/blockly/blockly.min.js',
];

/* Plugins : leur HTML est précaché pour garantir la navigation hors-ligne.
   (Sans ça, un plugin déjà visité online pourrait n'être en cache que partiellement.) */
const ASSETS_PLUGINS = [
  './plugins/clients/index.html',
  './plugins/parametrage/index.html',
  './plugins/demande-os/index.html',
  './plugins/calage-embiellages/index.html',
  './plugins/liste-pieces/index.html',
  './plugins/calcul-vide/index.html',
  './plugins/rapport-intervention/index.html',
  './plugins/retour-garantie/index.html',
  './plugins/editeur-taxonomie/index.html',
];

/* ============================================================
   Helper — précache résilient
   cache.addAll() échoue ENTIÈREMENT si un seul asset est KO. On précache
   donc chaque asset individuellement : un asset manquant (optionnel) ne doit
   jamais faire échouer toute l'installation du SW (cause classique de
   « l'app ne s'ouvre plus offline »).
   ============================================================ */
async function precacheResilient(nomCache, liste) {
  const cache = await caches.open(nomCache);
  await Promise.all(
    liste.map(async (url) => {
      try {
        const reponse = await fetch(url, { cache: 'reload' });
        if (reponse && reponse.ok) {
          await cache.put(url, reponse.clone());
        } else {
          console.warn('[SW] Précache ignoré (réponse non OK) :', url);
        }
      } catch (err) {
        console.warn('[SW] Précache ignoré (échec réseau) :', url);
      }
    })
  );
}

/* ============================================================
   Installation — précache des assets statiques + plugins
   ============================================================ */
self.addEventListener('install', evenement => {
  evenement.waitUntil(
    (async () => {
      await precacheResilient(CACHE_NOM, ASSETS_STATIQUES);
      await precacheResilient(CACHE_PLUGINS, ASSETS_PLUGINS);
    })()
  );

  /* Activation immédiate sans attendre la fermeture des onglets existants */
  self.skipWaiting();
});

/* ============================================================
   Activation — nettoyage des anciens caches
   ============================================================ */
self.addEventListener('activate', evenement => {
  evenement.waitUntil(
    caches.keys().then(nomsCaches => {
      return Promise.all(
        nomsCaches
          .filter(nom => nom !== CACHE_NOM && nom !== CACHE_PLUGINS)
          .map(nom => caches.delete(nom))
      );
    })
  );

  /* Prise de contrôle immédiate de tous les onglets ouverts */
  self.clients.claim();
});

/* ============================================================
   Interception des requêtes
   ============================================================ */
self.addEventListener('fetch', evenement => {
  const requete = evenement.request;
  const url = new URL(requete.url);

  /* Ignorer les requêtes non-GET et celles vers d'autres origines
     (ex. API Supabase) : elles ne sont pas mises en cache. */
  if (requete.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  /* ---- Navigation (ouverture de l'app / refresh / PWA) ----
     C'est le point clé pour l'offline : on tente le réseau, et en cas
     d'échec on sert TOUJOURS index.html depuis le cache, afin que le shell
     de l'app s'ouvre même sans réseau. */
  if (requete.mode === 'navigate') {
    evenement.respondWith(strategieNavigation(requete));
    return;
  }

  /* ---- Plugins : stratégie Network-first ---- */
  if (url.pathname.includes('/plugins/')) {
    evenement.respondWith(strategieNetworkFirst(requete, CACHE_PLUGINS));
    return;
  }

  /* ---- Libs vendorisées immuables : stratégie Cache-first ----
     Les bundles dans js/libs/** (supabase, jspdf, xlsx, exceljs, blockly,
     fuse, qrcode, jsQR, lz-string…) ne changent pas entre deux déploiements
     du shell : on les sert depuis le cache pour un démarrage instantané et
     un offline garanti. */
  if (url.pathname.includes('/js/libs/')) {
    evenement.respondWith(strategieCacheFirst(requete, CACHE_NOM));
    return;
  }

  /* ---- Shell applicatif (CSS + scripts js/*.js) : stratégie Network-first ----
     index.html (navigate), css/*.css et js/*.js forment un ensemble cohérent.
     On privilégie donc le réseau pour rester synchronisé avec le HTML servi
     en network-first, avec repli cache hors-ligne. Évite la désynchronisation
     « nouveau HTML + ancien CSS/JS » qui cassait l'affichage au lancement. */
  evenement.respondWith(strategieNetworkFirst(requete, CACHE_NOM));
});

/* ============================================================
   Stratégie Navigation (offline-first pour l'ouverture de l'app)
   1. Tente le réseau (pour récupérer la version fraîche du shell)
   2. Si échec → index.html du cache
   3. Si même index.html absent → réponse cache générique
   ============================================================ */
async function strategieNavigation(requete) {
  const cache = await caches.open(CACHE_NOM);
  try {
    const reponseReseau = await fetch(requete);
    if (reponseReseau && reponseReseau.ok) {
      /* Met à jour le cache du document de repli. */
      cache.put(FALLBACK_DOC, reponseReseau.clone());
    }
    return reponseReseau;
  } catch (erreur) {
    const fallback =
      (await cache.match(FALLBACK_DOC)) ||
      (await cache.match('./')) ||
      (await cache.match(requete));
    if (fallback) return fallback;

    return new Response(
      '<!DOCTYPE html><meta charset="utf-8"><title>Hors ligne</title>' +
        '<p>Application indisponible hors ligne : ouvrez-la une fois en ligne ' +
        'pour activer le mode hors-ligne.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* ============================================================
   Stratégie Cache-first
   1. Cherche dans le cache
   2. Si absent, récupère depuis le réseau et met en cache
   ============================================================ */
async function strategieCacheFirst(requete, nomCache) {
  const cache    = await caches.open(nomCache);
  const cacheRep = await cache.match(requete);

  if (cacheRep) {
    return cacheRep;
  }

  try {
    const reponseReseau = await fetch(requete);
    /* On ne cache que les réponses valides */
    if (reponseReseau.ok) {
      cache.put(requete, reponseReseau.clone());
    }
    return reponseReseau;
  } catch (erreur) {
    console.warn('[SW] Cache-first : ressource indisponible :', requete.url);
    /* Retourner une réponse vide en dernier recours */
    return new Response('Ressource non disponible hors ligne.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

/* ============================================================
   Stratégie Network-first
   1. Tente de récupérer depuis le réseau
   2. En cas d'échec réseau, cherche dans le cache
   ============================================================ */
async function strategieNetworkFirst(requete, nomCache) {
  const cache = await caches.open(nomCache);

  try {
    const reponseReseau = await fetch(requete);
    if (reponseReseau && reponseReseau.ok) {
      /* Réponse fraîche valide → on met le cache à jour et on la sert. */
      cache.put(requete, reponseReseau.clone());
      return reponseReseau;
    }
    /* Réponse réseau non valide (404, 5xx, page d'erreur de l'hébergeur…) :
       on préfère une version en cache si elle existe plutôt que de propager
       une réponse cassée (qui désynchroniserait le shell). */
    const cacheRepli = await cache.match(requete);
    return cacheRepli || reponseReseau;
  } catch (erreur) {
    console.warn('[SW] Network-first : réseau indisponible, tentative cache :', requete.url);
    const cacheRep = await cache.match(requete);

    if (cacheRep) {
      return cacheRep;
    }

    return new Response('Ressource non disponible hors ligne.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
