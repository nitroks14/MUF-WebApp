/**
 * MUF-WebApp — Configuration globale
 *
 * L'URL du backend Scaleway est centralisée ici.
 * Ne jamais la dupliquer ailleurs dans le code frontend.
 *
 * En production : remplacer la valeur par l'URL réelle du namespace Scaleway.
 * Ex : 'https://mufwebapp-auth-xxxxxxxx.functions.fnc.fr-par.scw.cloud'
 */

'use strict';

(function () {
  window.MUF_CONFIG = {
    /**
     * URL de base du backend Scaleway Functions.
     * Doit se terminer SANS slash.
     * Mettre à jour après déploiement sur Scaleway.
     */
    BACKEND_URL: 'https://VOTRE-NAMESPACE.functions.fnc.fr-par.scw.cloud',
  };
})();
