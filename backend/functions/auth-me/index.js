/**
 * Scaleway Function — GET /auth/me
 *
 * En-tête attendu :
 *   Authorization: Bearer <jwt>
 *
 * Vérifie le token JWT et retourne le profil utilisateur.
 *
 * Variables d'environnement requises :
 *   USERS_STORAGE_URL  — URL Scaleway Object Storage
 *   STORAGE_SECRET_KEY — clé secrète Object Storage
 *   JWT_SECRET         — secret pour vérifier le JWT
 */

'use strict';

const jwt = require('jsonwebtoken');
const {
  lireUtilisateurs,
  corsHeaders,
  reponseErreur,
  reponseOk,
} = require('../_shared/storage');

const JWT_SECRET = process.env.JWT_SECRET || '';

module.exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return reponseErreur(405, 'Méthode non autorisée.');
  }

  /* -- Extraction du token depuis l'en-tête Authorization -- */
  const authHeader = (event.headers && event.headers['authorization']) ||
                     (event.headers && event.headers['Authorization']) || '';

  if (!authHeader.startsWith('Bearer ')) {
    return reponseErreur(401, 'Token d\'authentification manquant.');
  }

  const token = authHeader.slice(7);

  /* -- Vérification JWT -- */
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return reponseErreur(401, 'Token invalide ou expiré.');
  }

  /* -- Récupération profil -- */
  let utilisateurs;
  try {
    utilisateurs = await lireUtilisateurs();
  } catch (e) {
    console.error('[me] Erreur lecture stockage :', e);
    return reponseErreur(500, 'Erreur serveur.');
  }

  const utilisateur = utilisateurs.find(function (u) { return u.id === payload.sub; });

  if (!utilisateur) {
    return reponseErreur(401, 'Utilisateur introuvable — token révoqué ou compte supprimé.');
  }

  return reponseOk(200, {
    user: {
      id:     utilisateur.id,
      prenom: utilisateur.prenom,
      nom:    utilisateur.nom,
      email:  utilisateur.email,
    },
  });
};
