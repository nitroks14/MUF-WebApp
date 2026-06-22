/**
 * MUF-WebApp — Client « Cerveau Multivac » (window.MUF.brain)
 *
 * CLIENT MINCE (wrapper HTTP) au-dessus de l'API « Cerveau » hébergée côté VM.
 * Ce module N'EST PAS le moteur : il se contente d'envoyer une question et de
 * remonter la réponse. Toute l'intelligence (RAG, embeddings, LLM) vit côté
 * serveur. Ici, on gère uniquement : URL de base, JWT d'auth, timeout, et le
 * mapping question/contexte/options → corps de requête.
 *
 * Principes (alignés sur le reste du projet) :
 *   - IIFE strict, exposition via window.MUF (cf. js/utils.js).
 *   - OFFLINE-FIRST / DÉGRADÉ GRACIEUX : si l'URL n'est pas configurée, si le
 *     réseau est KO, ou s'il n'y a pas de token, ask() RENVOIE UNE PROMESSE
 *     REJETÉE (Error claire) — JAMAIS de throw synchrone, JAMAIS de
 *     console.error bloquant. Les plugins consomment toujours via le pattern :
 *       if (window.MUF && window.MUF.brain && window.MUF.brain.ask) {
 *         window.MUF.brain.ask(question).then(...).catch(...);
 *       }
 *     Un rejet est donc un cas NORMAL (Cerveau indisponible) et non une erreur
 *     applicative à logguer bruyamment.
 *
 * Contrat de l'API (côté VM) :
 *   POST {BRAIN_URL}/v1/ask
 *     Headers : Authorization: Bearer <JWT Supabase>, Content-Type: application/json
 *     Body    : { question, contexte?: {...}, options?: {...} }
 *     Réponse : { reponse, confiance, provider_utilise, meta, debug? }
 *
 * ⚠️ La génération est LENTE (LLM « thinking » : ~12-16 s). Le timeout client
 *    par défaut est donc volontairement large (30 s), surchargeable via
 *    options.timeout.
 *
 * API publique — window.MUF.brain :
 *   .ask(question, options) → Promise<{ reponse, confiance, provider_utilise, meta, debug? }>
 *       question : string (la question utilisateur).
 *       options  : {
 *         contexte? : { type_machine?, generation?, options? }  → corps.contexte
 *         options?  : { provider?, top_k?, rerank?, debug? }     → corps.options
 *         timeout?  : number (ms, défaut 30000)
 *         signal?   : AbortSignal externe optionnel (annulation par l'appelant)
 *       }
 *   .ready() → Promise<void> résolue quand l'auth est prête ET l'URL configurée,
 *              rejetée sinon (sans bruit). Utile pour tester la dispo en amont.
 */

'use strict';

(function (global) {

  /* Timeout par défaut large : la génération LLM « thinking » prend ~12-16 s.
     On laisse une marge confortable (réseau Tailscale + cold start éventuel). */
  var TIMEOUT_DEFAUT_MS = 30000;

  /* Chemin de l'endpoint « ask » sur l'API Cerveau. */
  var CHEMIN_ASK = '/v1/ask';

  /* ----------------------------------------------------------
     URL de base — lue à CHAQUE appel depuis window.MUF_CONFIG.
     Lue dynamiquement (et non figée au chargement) pour qu'un
     renseignement tardif de BRAIN_URL soit pris en compte sans
     rechargement. Vide par défaut tant que l'exposition HTTPS
     (tailscale serve) n'existe pas → mode dégradé silencieux.
     ---------------------------------------------------------- */
  function urlBase() {
    var cfg = global.MUF_CONFIG || {};
    var u = cfg.BRAIN_URL;
    if (typeof u !== 'string') return '';
    /* Retire un éventuel slash final pour concaténer proprement le chemin. */
    return u.trim().replace(/\/+$/, '');
  }

  /* Le Cerveau est-il configuré (URL renseignée) ? */
  function estConfigure() {
    return urlBase() !== '';
  }

  /* ----------------------------------------------------------
     Récupération du JWT Supabase.
     window.Auth.getToken() est SYNCHRONE (cf. js/auth.js) : il renvoie
     l'access_token courant ou null. Si Auth n'est pas encore prêt, on
     tente window.Auth.ready() puis on relit le token. On renvoie toujours
     une Promise<string> (token) ou un rejet silencieux.
     ---------------------------------------------------------- */
  function obtenirToken() {
    var Auth = global.Auth;
    if (!Auth || typeof Auth.getToken !== 'function') {
      return Promise.reject(new Error('Cerveau : module Auth indisponible.'));
    }

    var token = Auth.getToken();
    if (token) return Promise.resolve(token);

    /* Pas de token tout de suite : Auth n'est peut-être pas encore prêt.
       On attend ready() (si dispo) puis on relit une fois. */
    if (typeof Auth.ready === 'function') {
      return Auth.ready().then(function () {
        var t = Auth.getToken();
        if (t) return t;
        throw new Error('Cerveau : aucune session authentifiée (token absent).');
      });
    }

    return Promise.reject(new Error('Cerveau : aucune session authentifiée (token absent).'));
  }

  /* ----------------------------------------------------------
     Construit le corps de la requête à partir des arguments publics.
     On ne transmet contexte / options QUE s'ils sont fournis, pour
     laisser le serveur appliquer ses propres valeurs par défaut.
     ---------------------------------------------------------- */
  function construireCorps(question, options) {
    var corps = { question: String(question == null ? '' : question) };

    if (options && options.contexte && typeof options.contexte === 'object') {
      corps.contexte = options.contexte;
    }
    if (options && options.options && typeof options.options === 'object') {
      corps.options = options.options;
    }

    return corps;
  }

  /* ----------------------------------------------------------
     ready() — résout si le Cerveau est utilisable (URL + token),
     rejette silencieusement sinon. Ne fait AUCUN appel réseau.
     ---------------------------------------------------------- */
  function ready() {
    if (!estConfigure()) {
      return Promise.reject(new Error('Cerveau : BRAIN_URL non configurée (service indisponible).'));
    }
    return obtenirToken().then(function () { /* token OK → prêt */ });
  }

  /* ----------------------------------------------------------
     ask(question, options) — appel principal.
     Renvoie TOUJOURS une Promise. Tous les chemins d'échec passent par
     un REJET (jamais de throw synchrone) pour un dégradé gracieux.
     ---------------------------------------------------------- */
  function ask(question, options) {
    options = options || {};

    /* Validation minimale de la question. */
    if (typeof question !== 'string' || question.trim() === '') {
      return Promise.reject(new Error('Cerveau : question vide.'));
    }

    /* Court-circuit immédiat si non configuré (mode dégradé attendu tant que
       l'URL HTTPS Tailscale n'est pas renseignée). */
    if (!estConfigure()) {
      return Promise.reject(new Error('Cerveau : BRAIN_URL non configurée (service indisponible).'));
    }

    /* fetch indisponible (très vieux contexte) → rejet propre. */
    if (typeof global.fetch !== 'function') {
      return Promise.reject(new Error('Cerveau : fetch indisponible dans cet environnement.'));
    }

    var timeout = (typeof options.timeout === 'number' && options.timeout > 0)
      ? options.timeout
      : TIMEOUT_DEFAUT_MS;

    return obtenirToken().then(function (token) {
      var url = urlBase() + CHEMIN_ASK;
      var corps = construireCorps(question, options);

      /* AbortController : timeout interne + relais d'un éventuel signal externe
         fourni par l'appelant (annulation manuelle). */
      var controleur = new AbortController();
      var minuteur = setTimeout(function () { controleur.abort(); }, timeout);

      if (options.signal) {
        if (options.signal.aborted) {
          controleur.abort();
        } else {
          options.signal.addEventListener('abort', function () {
            controleur.abort();
          });
        }
      }

      return global.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify(corps),
        signal: controleur.signal,
      }).then(function (rep) {
        if (!rep.ok) {
          /* On lit le corps (best effort) pour un message d'erreur exploitable. */
          return rep.text().then(function (texte) {
            var detail = texte ? (' — ' + texte.slice(0, 300)) : '';
            throw new Error('Cerveau : HTTP ' + rep.status + ' ' + rep.statusText + detail);
          });
        }
        return rep.json();
      }).catch(function (err) {
        /* Normalise l'erreur d'abort (timeout OU annulation externe) en message
           clair, et re-propage tout le reste tel quel. */
        if (err && err.name === 'AbortError') {
          throw new Error('Cerveau : délai dépassé (' + timeout + ' ms) ou requête annulée.');
        }
        throw err;
      }).then(
        function (data) { clearTimeout(minuteur); return data; },
        function (err)  { clearTimeout(minuteur); throw err; }
      );
    });
  }

  /* ----------------------------------------------------------
     Exposition globale sur window.MUF (créé par js/utils.js, chargé avant).
     Repli défensif si utils.js n'avait pas tourné (ne devrait pas arriver
     vu l'ordre de chargement, mais garde le module autonome).
     ---------------------------------------------------------- */
  global.MUF = global.MUF || {};
  global.MUF.brain = {
    ask: ask,
    ready: ready,
  };

})(window);
