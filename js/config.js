/**
 * MUF-WebApp — Configuration globale
 *
 * Centralise la configuration publique de l'application.
 * Ces valeurs Supabase sont PUBLIQUES (URL + clé "publishable" anon) :
 * elles sont conçues pour vivre côté navigateur et peuvent donc figurer
 * sans risque dans le dépôt. La sécurité repose sur les Row Level Security
 * policies côté Supabase, jamais sur le secret de cette clé.
 *
 * Ne jamais dupliquer ces valeurs ailleurs dans le code frontend :
 * tout le monde lit window.MUF_CONFIG.
 */

'use strict';

(function () {
  window.MUF_CONFIG = {
    /**
     * URL du projet Supabase (sans slash final).
     */
    SUPABASE_URL: 'https://uzvoihrglczwdnlnsrvf.supabase.co',

    /**
     * Clé "publishable" (anon) Supabase — publique par conception.
     * Format sb_publishable_... : nécessite supabase-js v2 récent.
     */
    SUPABASE_ANON_KEY: 'sb_publishable_-XTtMQlv_ePEPly8NFjAFA_LuUscg36',

    /**
     * Domaine email autorisé à l'inscription (garde-fou frontend).
     */
    ALLOWED_EMAIL_DOMAIN: 'multivac.fr',

    /**
     * URL HTTPS du « Cerveau Multivac » exposé via `tailscale serve`
     * (sans slash final). Joignable uniquement depuis un appareil MEMBRE du
     * tailnet (p.ex. iPad/iPhone de l'utilisateur) ; non résolvable depuis un
     * appareil hors tailnet. Valeur PUBLIQUE : l'accès est protégé par le JWT
     * Supabase (Authorization: Bearer), pas par le secret de cette URL.
     * Si vidée, le client js/brain.js (window.MUF.brain) repasse en mode
     * dégradé silencieux (ask() rejette proprement, aucun appel réseau).
     */
    BRAIN_URL: 'https://vm-pc.tail1b2aa8.ts.net',
  };
})();
