/**
 * MUF-WebApp — Module Auth
 *
 * Gère :
 *   - Stockage / lecture / suppression du JWT en localStorage
 *   - Appels API vers le backend Scaleway (register, login, reset)
 *   - Vérification du token au démarrage
 *   - Exposition de l'utilisateur connecté via window.Auth.getUser()
 *
 * API publique : window.Auth
 *   .isAuthenticated()         → boolean
 *   .getToken()                → string | null
 *   .getUser()                 → { prenom, nom, email } | null
 *   .login(email, mdp)         → Promise<{ ok, error }>
 *   .register(prenom, nom, email, mdp) → Promise<{ ok, error }>
 *   .resetRequest(email)       → Promise<{ ok, error }>
 *   .logout()                  → void
 *   .verifyToken()             → Promise<boolean>
 */

'use strict';

(function () {

  const CLE_TOKEN = 'muf_jwt';
  const CLE_USER  = 'muf_user';

  /* ----------------------------------------------------------
     Helpers localStorage
     ---------------------------------------------------------- */
  function lireToken() {
    try { return localStorage.getItem(CLE_TOKEN); } catch (e) { return null; }
  }

  function sauvegarderToken(token) {
    try { localStorage.setItem(CLE_TOKEN, token); } catch (e) {
      console.error('[Auth] Impossible de sauvegarder le token :', e);
    }
  }

  function lireUser() {
    try {
      const raw = localStorage.getItem(CLE_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function sauvegarderUser(user) {
    try { localStorage.setItem(CLE_USER, JSON.stringify(user)); } catch (e) {
      console.error('[Auth] Impossible de sauvegarder le profil :', e);
    }
  }

  function effacerSession() {
    try {
      localStorage.removeItem(CLE_TOKEN);
      localStorage.removeItem(CLE_USER);
    } catch (e) {
      console.error('[Auth] Erreur lors de la déconnexion :', e);
    }
  }

  /* ----------------------------------------------------------
     URL de base du backend
     ---------------------------------------------------------- */
  function backendUrl(chemin) {
    const base = (window.MUF_CONFIG && window.MUF_CONFIG.BACKEND_URL) || '';
    if (!base || base.includes('VOTRE-NAMESPACE')) {
      console.warn('[Auth] BACKEND_URL non configurée dans js/config.js');
    }
    return base + chemin;
  }

  /* ----------------------------------------------------------
     Appel API générique avec gestion d'erreur
     ---------------------------------------------------------- */
  async function appelApi(chemin, corps) {
    try {
      const reponse = await fetch(backendUrl(chemin), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(corps),
      });

      let data;
      try { data = await reponse.json(); } catch (e) { data = {}; }

      if (!reponse.ok) {
        return { ok: false, error: data.error || data.message || 'Erreur serveur.' };
      }

      return { ok: true, data };
    } catch (e) {
      console.error('[Auth] Erreur réseau :', e);
      return { ok: false, error: 'Impossible de joindre le serveur. Vérifiez votre connexion.' };
    }
  }

  /* ----------------------------------------------------------
     API publique
     ---------------------------------------------------------- */
  const Auth = {

    isAuthenticated() {
      return !!lireToken();
    },

    getToken() {
      return lireToken();
    },

    getUser() {
      return lireUser();
    },

    async login(email, mdp) {
      const res = await appelApi('/auth/login', { email, password: mdp });
      if (res.ok && res.data.token) {
        sauvegarderToken(res.data.token);
        sauvegarderUser(res.data.user || { email });
      }
      return res;
    },

    async register(prenom, nom, email, mdp) {
      const res = await appelApi('/auth/register', {
        prenom,
        nom,
        email,
        password: mdp,
      });
      if (res.ok && res.data.token) {
        sauvegarderToken(res.data.token);
        sauvegarderUser(res.data.user || { prenom, nom, email });
      }
      return res;
    },

    async resetRequest(email) {
      return appelApi('/auth/reset-request', { email });
    },

    logout() {
      effacerSession();
    },

    /**
     * Vérifie le token JWT auprès du backend.
     * Met à jour le profil si le backend renvoie des infos à jour.
     * Retourne true si le token est valide, false sinon.
     */
    async verifyToken() {
      const token = lireToken();
      if (!token) return false;

      try {
        const reponse = await fetch(backendUrl('/auth/me'), {
          method:  'GET',
          headers: { Authorization: 'Bearer ' + token },
        });

        if (!reponse.ok) {
          effacerSession();
          return false;
        }

        let data;
        try { data = await reponse.json(); } catch (e) { data = {}; }

        if (data.user) {
          sauvegarderUser(data.user);
        }

        return true;
      } catch (e) {
        /* Réseau indisponible — on fait confiance au token local */
        console.warn('[Auth] Vérification token impossible (hors ligne ?), session maintenue.');
        return !!token;
      }
    },
  };

  /* Exposition globale */
  window.Auth = Auth;

})();
