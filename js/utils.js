/**
 * MUF-WebApp — Utilitaires partagés (window.MUF)
 *
 * Helpers transverses, sans dépendance, chargés très tôt dans le shell
 * (avant les autres scripts applicatifs et les plugins) afin d'être
 * disponibles partout.
 */

'use strict';

(function (global) {
  /* Échappement HTML par regex (pas de DOM créé à chaque appel), aligné sur
     les implémentations locales historiques de js/client-autocomplete.js,
     js/client-learning.js et plugins/clients. Les 5 caractères sensibles
     sont échappés ; « & » EN PREMIER pour ne pas ré-échapper les entités
     qu'on vient d'introduire. Sûr en contexte de texte ET d'attribut HTML
     (échappe " et '). */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.MUF = global.MUF || {};
  global.MUF.escapeHtml = escapeHtml;
})(window);
