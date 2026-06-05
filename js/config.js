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
    SUPABASE_URL: 'https://audwdqqrrnubbzszzdgw.supabase.co',

    /**
     * Clé "publishable" (anon) Supabase — publique par conception.
     * Format sb_publishable_... : nécessite supabase-js v2 récent.
     */
    SUPABASE_ANON_KEY: 'sb_publishable_-AjDH0UMjucDE5MI_9A6QQ_Ip2BzSbC',

    /**
     * Domaine email autorisé à l'inscription (garde-fou frontend).
     */
    ALLOWED_EMAIL_DOMAIN: 'multivac.fr',
  };
})();
