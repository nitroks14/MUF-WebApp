/**
 * MUF-WebApp — Client Supabase partagé
 *
 * Charge supabase-js v2 (récent — requis par les clés au format
 * sb_publishable_...) depuis le CDN esm.sh, crée UNE SEULE instance du
 * client et l'expose globalement pour tout le reste de l'application.
 *
 * Comme supabase-js v2 est un module ES, ce fichier est lui-même un module
 * (chargé via <script type="module">). Il publie :
 *
 *   window.MUF_SUPABASE        → le client (disponible après résolution)
 *   window.MUF_SUPABASE_READY  → Promise<SupabaseClient> à attendre avant
 *                                tout appel auth (auth.js l'attend déjà).
 *
 * Aucune URL / clé n'est hardcodée ici : tout vient de window.MUF_CONFIG
 * (js/config.js), chargé avant ce script.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = window.MUF_CONFIG || {};

if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
  console.error(
    '[Supabase] Configuration manquante : vérifiez SUPABASE_URL / SUPABASE_ANON_KEY dans js/config.js.'
  );
}

const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: {
    /* Persistance de session en localStorage (multi-appareils → même compte) */
    persistSession: true,
    autoRefreshToken: true,
    /* Permet de récupérer le token de reset présent dans l'URL au retour du mail */
    detectSessionInUrl: true,
  },
});

window.MUF_SUPABASE = client;

/* Signal de disponibilité consommé par js/auth.js */
window.MUF_SUPABASE_READY = Promise.resolve(client);

/* Notifie les éventuels listeners synchrones (auth.js gère aussi le cas
   où le client est déjà prêt au moment où il s'abonne). */
window.dispatchEvent(new CustomEvent('muf-supabase-ready', { detail: client }));
