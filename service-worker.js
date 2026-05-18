/**
 * MUF-WebApp — Service Worker
 * Stratégie :
 *   - Cache-first pour les assets statiques (CSS, JS, HTML principal, manifest)
 *   - Network-first pour les plugins (afin de toujours avoir la version fraîche)
 */

'use strict';

/* Nom du cache — incrémenter la version pour invalider l'ancien cache */
const CACHE_NOM     = 'muf-webapp-v16';
const CACHE_PLUGINS = 'muf-plugins-v16';

/* Liste des assets statiques à précacher */
const ASSETS_STATIQUES = [
  './',
  './index.html',
  './css/main.css',
  './js/app.js',
  './js/parametrage.js',
  './js/notion-archive.js',
  './manifest.json',
];

/* ============================================================
   Installation — précache des assets statiques
   ============================================================ */
self.addEventListener('install', evenement => {
  console.log('[SW] Installation…');

  evenement.waitUntil(
    caches.open(CACHE_NOM).then(cache => {
      console.log('[SW] Mise en cache des assets statiques');
      return cache.addAll(ASSETS_STATIQUES);
    })
  );

  /* Activation immédiate sans attendre la fermeture des onglets existants */
  self.skipWaiting();
});

/* ============================================================
   Activation — nettoyage des anciens caches
   ============================================================ */
self.addEventListener('activate', evenement => {
  console.log('[SW] Activation…');

  evenement.waitUntil(
    caches.keys().then(nomsCaches => {
      return Promise.all(
        nomsCaches
          .filter(nom => nom !== CACHE_NOM && nom !== CACHE_PLUGINS)
          .map(nom => {
            console.log('[SW] Suppression ancien cache :', nom);
            return caches.delete(nom);
          })
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
  const url = new URL(evenement.request.url);

  /* Ignorer les requêtes non-GET et celles vers d'autres origines */
  if (evenement.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  /* ---- Plugins : stratégie Network-first ---- */
  if (url.pathname.includes('/plugins/')) {
    evenement.respondWith(strategieNetworkFirst(evenement.request, CACHE_PLUGINS));
    return;
  }

  /* ---- Assets statiques : stratégie Cache-first ---- */
  evenement.respondWith(strategieCacheFirst(evenement.request, CACHE_NOM));
});

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
    if (reponseReseau.ok) {
      cache.put(requete, reponseReseau.clone());
    }
    return reponseReseau;
  } catch (erreur) {
    console.warn('[SW] Network-first : réseau indisponible, tentative cache :', requete.url);
    const cacheRep = await cache.match(requete);

    if (cacheRep) {
      return cacheRep;
    }

    return new Response('Plugin non disponible hors ligne.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}
