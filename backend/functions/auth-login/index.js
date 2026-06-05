/**
 * Scaleway Function — POST /auth/login
 *
 * Corps attendu (JSON) :
 *   { email, password }
 *
 * Retourne un JWT (7 jours) si les identifiants sont valides.
 *
 * Variables d'environnement requises :
 *   USERS_STORAGE_URL  — URL Scaleway Object Storage
 *   STORAGE_SECRET_KEY — clé secrète Object Storage
 *   JWT_SECRET         — secret pour signer les JWT
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const {
  lireUtilisateurs,
  corsHeaders,
  reponseErreur,
  reponseOk,
} = require('../_shared/storage');

const JWT_SECRET     = process.env.JWT_SECRET || '';
const JWT_EXPIRATION = '7d';

module.exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return reponseErreur(405, 'Méthode non autorisée.');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return reponseErreur(400, 'Corps de requête JSON invalide.');
  }

  const { email, password } = body;

  if (!email || !email.trim()) return reponseErreur(400, 'L\'adresse email est requise.');
  if (!password)               return reponseErreur(400, 'Le mot de passe est requis.');

  const emailNormalise = email.trim().toLowerCase();

  /* -- Récupération utilisateur -- */
  let utilisateurs;
  try {
    utilisateurs = await lireUtilisateurs();
  } catch (e) {
    console.error('[login] Erreur lecture stockage :', e);
    return reponseErreur(500, 'Erreur serveur — impossible d\'accéder au stockage.');
  }

  const utilisateur = utilisateurs.find(function (u) { return u.email === emailNormalise; });

  /* Message générique volontaire — ne pas préciser si c'est l'email ou le MDP */
  if (!utilisateur) {
    return reponseErreur(401, 'Email ou mot de passe incorrect.');
  }

  /* -- Vérification mot de passe -- */
  let mdpValide;
  try {
    mdpValide = await bcrypt.compare(password, utilisateur.password);
  } catch (e) {
    console.error('[login] Erreur bcrypt :', e);
    return reponseErreur(500, 'Erreur serveur — vérification impossible.');
  }

  if (!mdpValide) {
    return reponseErreur(401, 'Email ou mot de passe incorrect.');
  }

  /* -- Génération JWT -- */
  if (!JWT_SECRET) {
    console.error('[login] JWT_SECRET non configurée !');
    return reponseErreur(500, 'Erreur serveur — configuration JWT manquante.');
  }

  const token = jwt.sign(
    { sub: utilisateur.id, email: emailNormalise },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );

  return reponseOk(200, {
    token,
    user: {
      id:     utilisateur.id,
      prenom: utilisateur.prenom,
      nom:    utilisateur.nom,
      email:  emailNormalise,
    },
  });
};
