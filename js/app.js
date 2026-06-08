/**
 * MUF-WebApp — Moteur principal
 * Routing hash-based + chargement dynamique des plugins
 *
 * Convention : chaque plugin vit dans plugins/<nom>/index.html
 * L'URL prend la forme : index.html#plugin-<nom>
 */

'use strict';

/* ============================================================
   Configuration — liste des plugins disponibles
   Ajouter un plugin ici pour qu'il apparaisse dans la nav
   ============================================================ */
const PLUGINS = [
  {
    id:   'clients',
    nom:  'Clients',
    desc: 'Référentiel des clients et de leurs machines (recherche, doublons)',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4
                   4 0 100-8 4 4 0 000 8zm6-8a4 4 0 11-8 0 4 4 0 018 0z"/>
            </svg>`,
  },
  {
    id:   'parametrage',
    nom:  'Paramétrage',
    desc: 'Configuration de l\'application',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0
                   002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0
                   001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0
                   00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0
                   00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0
                   00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0
                   00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0
                   001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07
                   2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>`,
  },
  {
    id:   'demande-os',
    nom:  "Demande d'OS",
    desc: "Générer un brouillon Outlook de demande de création d'ordre de service",
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0
                   002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>`,
  },
  {
    id:   'calage-embiellages',
    nom:  'Calage embiellages',
    desc: 'Contrôle de la cote X sur les embiellages formage et soudure',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0
                   0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
            </svg>`,
  },
  {
    id:   'liste-pieces',
    nom:  'Liste de pièces',
    desc: 'Générer une fiche de pièces détachées au format Excel',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                   01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>`,
  },
  {
    id:   'calcul-vide',
    nom:  'Calcul mise sous vide',
    desc: 'Estimer le temps de mise sous vide d\'un outillage',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>`,
  },
  {
    id:   'rapport-intervention',
    nom:  'Rapport d\'intervention',
    desc: 'Rédiger un rapport d\'intervention',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0
                   002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0
                   002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
            </svg>`,
  },
  {
    id:   'retour-garantie',
    nom:  'Retour pièces garantie',
    desc: 'Générer un bon de retour pièces sous garantie et l\'envoyer par Outlook',
    icone: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
              viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
            </svg>`,
  },
  /* Exemple de futurs plugins — décommenter quand ils existent :
  {
    id:   'diagnostic',
    nom:  'Diagnostic',
    desc: 'Outils de diagnostic machine',
    icone: '...',
  },
  {
    id:   'interventions',
    nom:  'Interventions',
    desc: 'Suivi des interventions terrain',
    icone: '...',
  },
  */
];

/* ============================================================
   Références DOM
   ============================================================ */
const appContent   = document.getElementById('app-content');
const drawerNav    = document.getElementById('drawer-nav');
const headerTitle  = document.getElementById('header-title');

/* Éléments du drawer repliable (header unifié PC/iPad/iPhone) */
const navToggle  = document.getElementById('nav-toggle');
const navDrawer  = document.getElementById('nav-drawer');
const navOverlay = document.getElementById('nav-overlay');

/* Durée d'animation de fermeture du drawer, en millisecondes.
   DOIT rester égale à la CSS custom property --drawer-anim (css/main.css) :
   le drawer n'est masqué (hidden) qu'une fois la transition CSS terminée. */
const DRAWER_ANIM_MS = 300;

/* ============================================================
   Construction de la navigation (drawer repliable unique)
   Appelée une seule fois au démarrage.
   Le libellé est enveloppé dans .nav-label pour autoriser le
   retour à la ligne (lisibilité iPhone) sans tronquer le texte.
   ============================================================ */
function construireNavigation() {
  if (!drawerNav) return;

  PLUGINS.forEach(plugin => {
    const hash = `#plugin-${plugin.id}`;

    const lien = document.createElement('a');
    lien.href = hash;
    lien.dataset.plugin = plugin.id;
    lien.setAttribute('role', 'listitem');
    lien.innerHTML = `
      <span class="nav-icon" aria-hidden="true">${plugin.icone}</span>
      <span class="nav-label">${plugin.nom}</span>
    `;
    drawerNav.appendChild(lien);
  });
}

/* ============================================================
   Mise à jour de l'état actif dans la navigation
   ============================================================ */
function mettreAJourNavActive(pluginId) {
  if (drawerNav) {
    drawerNav.querySelectorAll('a').forEach(lien => {
      const actif = lien.dataset.plugin === pluginId;
      lien.classList.toggle('active', actif);
      if (actif) {
        lien.setAttribute('aria-current', 'page');
      } else {
        lien.removeAttribute('aria-current');
      }
    });
  }

  /* Titre de l'en-tête — reste visible même barre repliée */
  if (headerTitle) {
    if (pluginId) {
      const plugin = PLUGINS.find(p => p.id === pluginId);
      headerTitle.textContent = plugin ? plugin.nom : 'MUF-WebApp';
    } else {
      headerTitle.textContent = 'Accueil';
    }
  }
}

/* ============================================================
   Drawer repliable — logo = bouton toggle (PC / iPad / iPhone)
   Un appui sur le logo déplie la barre depuis le haut, un nouvel
   appui la replie. État reflété par aria-expanded + chevron animé.
   ============================================================ */
function ouvrirDrawer() {
  if (!navDrawer || !navToggle) return;
  navDrawer.hidden = false;
  if (navOverlay) navOverlay.hidden = false;
  /* Force un reflow pour que la transition CSS s'applique depuis hidden */
  void navDrawer.offsetHeight;
  navDrawer.classList.add('open');
  if (navOverlay) navOverlay.classList.add('open');
  navToggle.setAttribute('aria-expanded', 'true');
}

function fermerDrawer() {
  if (!navDrawer || !navToggle) return;
  navDrawer.classList.remove('open');
  if (navOverlay) navOverlay.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  /* Masque réellement après l'animation (et libère le voile). */
  window.setTimeout(() => {
    if (navToggle.getAttribute('aria-expanded') === 'false') {
      navDrawer.hidden = true;
      if (navOverlay) navOverlay.hidden = true;
    }
  }, DRAWER_ANIM_MS);
}

function basculerDrawer() {
  if (!navToggle) return;
  const ouvert = navToggle.getAttribute('aria-expanded') === 'true';
  if (ouvert) {
    fermerDrawer();
  } else {
    ouvrirDrawer();
  }
}

function initialiserDrawer() {
  if (!navToggle || !navDrawer) return;

  /* Appui sur le logo → toggle */
  navToggle.addEventListener('click', basculerDrawer);

  /* Clic sur un lien → on referme le drawer (le routing fait le reste) */
  if (drawerNav) {
    drawerNav.addEventListener('click', evt => {
      if (evt.target.closest('a')) fermerDrawer();
    });
  }

  /* Clic sur le voile → referme */
  if (navOverlay) navOverlay.addEventListener('click', fermerDrawer);

  /* Touche Échap → referme */
  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape' &&
        navToggle.getAttribute('aria-expanded') === 'true') {
      fermerDrawer();
      navToggle.focus();
    }
  });
}

/* ============================================================
   Chargeur de plugins
   Stratégie : fetch le HTML du plugin, l'injecter dans #app-content
   Les scripts inline dans le HTML du plugin sont réexécutés via
   la recréation des balises <script>.
   ============================================================ */
async function chargerPlugin(nom) {
  /* Affichage du spinner de chargement */
  appContent.innerHTML = `
    <div class="plugin-loading" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <span>Chargement de ${nom}…</span>
    </div>
  `;

  const url = `./plugins/${nom}/index.html`;

  try {
    const reponse = await fetch(url);

    if (!reponse.ok) {
      throw new Error(`HTTP ${reponse.status} — ${reponse.statusText}`);
    }

    const html = await reponse.text();

    /* Injection du HTML dans la zone principale */
    appContent.innerHTML = html;

    /* Réexécution des scripts inline du plugin */
    appContent.querySelectorAll('script').forEach(scriptOriginal => {
      const scriptNouveau = document.createElement('script');
      /* Copie des attributs */
      Array.from(scriptOriginal.attributes).forEach(attr => {
        scriptNouveau.setAttribute(attr.name, attr.value);
      });
      /* Copie du contenu inline */
      if (scriptOriginal.textContent) {
        scriptNouveau.textContent = scriptOriginal.textContent;
      }
      scriptOriginal.replaceWith(scriptNouveau);
    });

  } catch (erreur) {
    console.error(`[MUF] Erreur chargement plugin "${nom}" :`, erreur);

    appContent.innerHTML = `
      <div class="plugin-error" role="alert">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none"
             viewBox="0 0 24 24" stroke="#E53E3E" stroke-width="1.5" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0
               001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        </svg>
        <p class="plugin-error-title">Impossible de charger le module</p>
        <p class="plugin-error-msg">
          Le module <strong>${nom}</strong> n'est pas disponible.<br>
          Vérifiez que le fichier <code>plugins/${nom}/index.html</code> existe.
        </p>
        <a href="#" class="btn btn-outline mt-16">Retour à l'accueil</a>
      </div>
    `;
  }
}

/* ============================================================
   Écran d'accueil
   Affiché quand aucun hash n'est présent dans l'URL
   ============================================================ */
function afficherAccueil() {
  /* Construction de la grille de plugins */
  const cardsPlugins = PLUGINS.map(plugin => `
    <a href="#plugin-${plugin.id}" class="plugin-card" aria-label="Ouvrir ${plugin.nom}">
      <span class="plugin-card-icon" aria-hidden="true">${plugin.icone}</span>
      <span class="plugin-card-name">${plugin.nom}</span>
      <span class="plugin-card-desc">${plugin.desc}</span>
    </a>
  `).join('');

  appContent.innerHTML = `
    <div class="card mb-24">
      <div class="card-header">
        <h1 class="card-title">Bienvenue dans MUF-WebApp</h1>
      </div>
      <div class="card-body">
        <p class="text-muted">
          Application couteau suisse pour techniciens terrain Multivac France.
          Sélectionnez un module dans la navigation ou ci-dessous.
        </p>
      </div>
    </div>

    <section aria-labelledby="titre-modules">
      <h2 id="titre-modules" class="font-semibold text-primary mb-16">
        Modules disponibles
      </h2>
      <div class="plugin-grid">
        ${cardsPlugins.length > 0 ? cardsPlugins : `
          <p class="text-muted">Aucun module installé pour le moment.</p>
        `}
      </div>
    </section>
  `;
}

/* ============================================================
   Bouton engrenage taxonomie — affiché uniquement sur le plugin RI
   ============================================================ */
function mettreAJourBoutonTaxo() {
  var hash = window.location.hash;
  var estRI = (hash === '#plugin-rapport-intervention');
  var btn = document.getElementById('taxo-gear-btn');
  if (btn) btn.classList.toggle('visible', estRI);
}

/* ============================================================
   Routeur — lit le hash de l'URL et décide quoi afficher
   ============================================================ */
function router() {
  const hash = window.location.hash; /* ex : "#plugin-parametrage" */

  if (!hash || hash === '#') {
    /* Accueil */
    mettreAJourNavActive(null);
    afficherAccueil();
    mettreAJourBoutonTaxo();
    return;
  }

  const matchPlugin = hash.match(/^#plugin-(.+)$/);
  if (matchPlugin) {
    const nomPlugin = matchPlugin[1];
    mettreAJourNavActive(nomPlugin);
    chargerPlugin(nomPlugin);
    mettreAJourBoutonTaxo();
    return;
  }

  if (hash === '#editeur-taxonomie') {
    mettreAJourNavActive(null);
    chargerPlugin('editeur-taxonomie');
    mettreAJourBoutonTaxo();
    return;
  }

  /* Hash inconnu → accueil */
  mettreAJourNavActive(null);
  afficherAccueil();
  mettreAJourBoutonTaxo();
}

/* ============================================================
   Enregistrement du Service Worker (PWA)
   ============================================================ */
function enregistrerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./service-worker.js')
        .then(registration => {
          console.log('[MUF] Service Worker enregistré :', registration.scope);
        })
        .catch(erreur => {
          console.warn('[MUF] Échec enregistrement Service Worker :', erreur);
        });
    });
  }
}

/* ============================================================
   Initialisation
   ============================================================ */
function init() {
  construireNavigation();
  initialiserDrawer();
  mettreAJourBoutonTaxo();

  /* Écoute des changements de hash (navigation) */
  window.addEventListener('hashchange', router);

  /* Route initiale au chargement */
  router();

  /* PWA */
  enregistrerServiceWorker();
}

/* Démarrage quand le DOM est prêt */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
