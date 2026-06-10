/**
 * MUF-WebApp — Module Auth (Supabase)
 *
 * Authentification entièrement déléguée à Supabase Auth (supabase-js v2).
 * Aucune logique d'auth maison ni serveur applicatif dédié.
 *
 * L'API publique est INCHANGÉE pour ne rien casser côté appelants :
 *   window.Auth
 *     .isAuthenticated()                  → boolean (session présente)
 *     .getToken()                         → string | null (access_token)
 *     .getUser()                          → { id, prenom, nom, email } | null
 *     .login(email, mdp)                  → Promise<{ ok, error }>
 *     .register(prenom, nom, email, mdp)  → Promise<{ ok, error }>
 *     .resetRequest(email)                → Promise<{ ok, error }>
 *     .logout()                           → Promise<void>
 *     .verifyToken()                      → Promise<boolean>
 *
 * Ajouts (utilisés par l'overlay auth pour le flux reset) :
 *     .updatePassword(nouveauMdp)         → Promise<{ ok, error }>
 *     .updateUserMetadata(champs)         → Promise<{ ok, error }>  (merge NON destructif dans user_metadata)
 *     .getUserMetadata()                  → object  (copie de user_metadata courant, synchrone)
 *     .refreshUser()                      → Promise<object|null>  (recharge le profil depuis Supabase)
 *     .ready()                            → Promise<SupabaseClient>
 *     .onChange(cb)                       → void  (notifié à chaque changement de session)
 *
 * La session (access/refresh token) est entièrement gérée et persistée par
 * supabase-js dans localStorage : multi-appareils → même compte, persistance
 * au rechargement, rafraîchissement automatique du token.
 */

'use strict';

(function () {

  /* ----------------------------------------------------------
     Accès au client Supabase partagé (js/supabase-client.js)
     Le client est un module ES : on l'attend via une Promise.
     ---------------------------------------------------------- */
  function obtenirClientPret() {
    if (window.MUF_SUPABASE) return Promise.resolve(window.MUF_SUPABASE);
    if (window.MUF_SUPABASE_READY) return window.MUF_SUPABASE_READY;
    /* Le module n'a pas encore exécuté : on attend son événement. */
    return new Promise(function (resolve) {
      window.addEventListener('muf-supabase-ready', function (e) {
        resolve(e.detail || window.MUF_SUPABASE);
      }, { once: true });
    });
  }

  /* ----------------------------------------------------------
     Cache synchrone de l'utilisateur courant
     getUser() est appelé de façon synchrone par certains plugins
     (et par Parametrage.get('nom'/'prenom')). On maintient donc une
     vue mémoire mise à jour à chaque changement de session.
     ---------------------------------------------------------- */
  var _userCache = null;        /* { id, prenom, nom, email } | null */
  var _metaCache = {};          /* copie de supaUser.user_metadata (brut) — pour merge non destructif */
  var _session   = null;        /* session supabase courante | null */
  var _listeners = [];          /* callbacks externes (onChange) */

  /**
   * Convertit un objet user Supabase en profil applicatif simple,
   * en conservant le contrat historique { id, prenom, nom, email }.
   * Prénom / Nom sont lus depuis user_metadata (renseignés à l'inscription)
   * avec des fallbacks propres.
   */
  function mapperUser(supaUser) {
    if (!supaUser) return null;
    var meta = supaUser.user_metadata || {};
    return {
      id:     supaUser.id || '',
      prenom: meta.prenom || meta.first_name || '',
      nom:    meta.nom    || meta.last_name  || '',
      email:  supaUser.email || meta.email || '',
    };
  }

  function majSession(session) {
    _session   = session || null;
    var supaUser = session && session.user ? session.user : null;
    _userCache = supaUser ? mapperUser(supaUser) : null;
    /* Conserve une copie du user_metadata brut afin de pouvoir le fusionner
       sans écraser les champs existants (prénom, nom, préférences…). */
    _metaCache = supaUser && supaUser.user_metadata
      ? Object.assign({}, supaUser.user_metadata)
      : {};
    _listeners.forEach(function (cb) {
      try { cb(_userCache, _session); } catch (e) { /* listener défaillant ignoré */ }
    });
  }

  /* Branche l'écoute des changements de session dès que le client est prêt. */
  obtenirClientPret().then(function (supabase) {
    /* État initial (session déjà persistée en localStorage le cas échéant). */
    supabase.auth.getSession().then(function (res) {
      majSession(res && res.data ? res.data.session : null);
    });

    /* Mises à jour : login, logout, refresh token, PASSWORD_RECOVERY... */
    supabase.auth.onAuthStateChange(function (_event, session) {
      majSession(session);
    });
  });

  /* ----------------------------------------------------------
     Normalisation des messages d'erreur Supabase → FR
     ---------------------------------------------------------- */
  function messageErreur(error) {
    if (!error) return 'Une erreur est survenue.';
    var m = (error.message || '').toLowerCase();

    if (m.includes('invalid login credentials')) {
      return 'Email ou mot de passe incorrect.';
    }
    if (m.includes('email not confirmed')) {
      return 'Votre email n\'a pas encore été confirmé. Vérifiez votre boîte de réception.';
    }
    if (m.includes('user already registered') || m.includes('already been registered')) {
      return 'Un compte existe déjà pour cette adresse email.';
    }
    if (m.includes('password should be at least')) {
      return 'Le mot de passe est trop court (8 caractères minimum).';
    }
    if (m.includes('rate limit') || m.includes('too many requests') || m.includes('email rate limit')) {
      return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    }
    if (m.includes('failed to fetch') || m.includes('networkerror')) {
      return 'Impossible de joindre le service. Vérifiez votre connexion.';
    }
    /* Message Supabase brut en dernier recours (déjà lisible en général). */
    return error.message || 'Une erreur est survenue.';
  }

  /* ----------------------------------------------------------
     URL de redirection pour le lien de reset (retour sur l'app)
     On revient sur l'app avec un marqueur de vue pour afficher
     l'écran "définir un nouveau mot de passe".
     ---------------------------------------------------------- */
  function urlRedirectionReset() {
    var base = window.location.origin + window.location.pathname;
    return base + '#auth-nouveau-mdp';
  }

  /* ----------------------------------------------------------
     API publique — window.Auth
     ---------------------------------------------------------- */
  var Auth = {

    /** Promesse résolue quand le client Supabase est prêt. */
    ready: function () {
      return obtenirClientPret();
    },

    /** S'abonner aux changements de session (appelé immédiatement avec l'état courant). */
    onChange: function (cb) {
      if (typeof cb !== 'function') return;
      _listeners.push(cb);
      cb(_userCache, _session);
    },

    /** Une session est-elle active ? (lecture synchrone du cache) */
    isAuthenticated: function () {
      return !!_session;
    },

    /** access_token courant (ou null). */
    getToken: function () {
      return _session && _session.access_token ? _session.access_token : null;
    },

    /** Profil courant { id, prenom, nom, email } ou null (synchrone). */
    getUser: function () {
      return _userCache;
    },

    /**
     * Connexion par email / mot de passe.
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    login: async function (email, mdp) {
      try {
        var supabase = await obtenirClientPret();
        var resultat = await supabase.auth.signInWithPassword({
          email: (email || '').trim().toLowerCase(),
          password: mdp,
        });
        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }
        majSession(resultat.data ? resultat.data.session : null);
        return { ok: true };
      } catch (e) {
        console.error('[Auth] login :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /**
     * Inscription. Prénom / Nom stockés dans user_metadata.
     * @returns {Promise<{ok:boolean, error?:string, needsConfirmation?:boolean}>}
     */
    register: async function (prenom, nom, email, mdp) {
      try {
        var emailNorm = (email || '').trim().toLowerCase();
        /* Défense en profondeur : seules les adresses @multivac.fr sont
           autorisées. La vraie barrière est côté Supabase (Allowed email
           domains) ; cette garde évite simplement un appel réseau inutile
           et donne un message clair côté client. */
        if (!emailNorm.endsWith('@multivac.fr')) {
          return { ok: false, error: 'Seules les adresses @multivac.fr sont autorisées.' };
        }
        var supabase = await obtenirClientPret();
        var resultat = await supabase.auth.signUp({
          email: emailNorm,
          password: mdp,
          options: {
            data: {
              prenom: (prenom || '').trim(),
              nom:    (nom || '').trim(),
            },
            emailRedirectTo: window.location.origin + window.location.pathname,
          },
        });

        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }

        /* Si la confirmation d'email est activée côté Supabase, signUp ne
           renvoie pas de session : on le signale à l'appelant. */
        var session = resultat.data ? resultat.data.session : null;
        if (!session) {
          return { ok: true, needsConfirmation: true };
        }

        majSession(session);
        return { ok: true, needsConfirmation: false };
      } catch (e) {
        console.error('[Auth] register :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /**
     * Demande d'email de réinitialisation de mot de passe.
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    resetRequest: async function (email) {
      try {
        var supabase = await obtenirClientPret();
        var resultat = await supabase.auth.resetPasswordForEmail(
          (email || '').trim().toLowerCase(),
          { redirectTo: urlRedirectionReset() }
        );
        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }
        return { ok: true };
      } catch (e) {
        console.error('[Auth] resetRequest :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /**
     * Définit un nouveau mot de passe pour l'utilisateur courant.
     * Utilisé au retour du lien de reset (une session temporaire est alors
     * établie par supabase-js via detectSessionInUrl).
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    updatePassword: async function (nouveauMdp) {
      try {
        var supabase = await obtenirClientPret();
        var resultat = await supabase.auth.updateUser({ password: nouveauMdp });
        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }
        return { ok: true };
      } catch (e) {
        console.error('[Auth] updatePassword :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /**
     * Copie synchrone du user_metadata courant (ou {} si pas de session).
     * Sert de source de vérité « cloud » pour les préférences (Paramétrage).
     * @returns {object}
     */
    getUserMetadata: function () {
      return Object.assign({}, _metaCache);
    },

    /**
     * Met à jour user_metadata de façon NON destructive : les champs passés
     * sont fusionnés avec l'existant (prénom, nom, autres préférences conservés).
     * @param {object} champs - clés/valeurs à fusionner dans user_metadata
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    updateUserMetadata: async function (champs) {
      if (!champs || typeof champs !== 'object') {
        return { ok: false, error: 'Données invalides.' };
      }
      try {
        var supabase = await obtenirClientPret();
        /* Merge non destructif : on repart de la dernière vue connue du metadata. */
        var fusion = Object.assign({}, _metaCache, champs);
        var resultat = await supabase.auth.updateUser({ data: fusion });
        if (resultat.error) {
          return { ok: false, error: messageErreur(resultat.error) };
        }
        /* Rafraîchit le cache local à partir de l'utilisateur renvoyé. */
        var maj = resultat.data ? resultat.data.user : null;
        if (maj && maj.user_metadata) {
          _metaCache = Object.assign({}, maj.user_metadata);
          _userCache = mapperUser(maj);
        } else {
          _metaCache = fusion;
        }
        return { ok: true };
      } catch (e) {
        console.error('[Auth] updateUserMetadata :', e);
        return { ok: false, error: messageErreur(e) };
      }
    },

    /**
     * Recharge le profil utilisateur depuis Supabase (source de vérité) et met
     * à jour les caches synchrones. À appeler au retour online pour récupérer
     * les éventuelles modifications faites depuis un autre appareil.
     * @returns {Promise<object|null>} profil { id, prenom, nom, email } ou null
     */
    refreshUser: async function () {
      try {
        var supabase = await obtenirClientPret();
        var res = await supabase.auth.getUser();
        var supaUser = res && res.data ? res.data.user : null;
        if (res.error || !supaUser) {
          return _userCache;
        }
        _userCache = mapperUser(supaUser);
        _metaCache = supaUser.user_metadata
          ? Object.assign({}, supaUser.user_metadata)
          : {};
        return _userCache;
      } catch (e) {
        console.warn('[Auth] refreshUser impossible (hors ligne ?) :', e);
        return _userCache;
      }
    },

    /** Déconnexion. */
    logout: async function () {
      try {
        var supabase = await obtenirClientPret();
        await supabase.auth.signOut();
      } catch (e) {
        console.error('[Auth] logout :', e);
      } finally {
        majSession(null);
      }
    },

    /**
     * Vérifie qu'une session valide existe (au démarrage de l'app).
     * supabase-js rafraîchit automatiquement le token si nécessaire.
     * @returns {Promise<boolean>}
     */
    verifyToken: async function () {
      try {
        var supabase = await obtenirClientPret();
        var res = await supabase.auth.getSession();
        var session = res && res.data ? res.data.session : null;
        majSession(session);
        return !!session;
      } catch (e) {
        console.warn('[Auth] verifyToken impossible (hors ligne ?) :', e);
        /* En l'absence de réseau, on s'appuie sur le cache déjà chargé. */
        return !!_session;
      }
    },
  };

  /* Exposition globale */
  window.Auth = Auth;

})();
