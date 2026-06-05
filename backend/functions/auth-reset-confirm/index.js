/**
 * Scaleway Function — POST /auth/reset-confirm
 *
 * Corps attendu (JSON) :
 *   { token, password }
 *
 * Vérifie le token de reset, hache le nouveau mot de passe,
 * met à jour le profil et invalide le token.
 *
 * Variables d'environnement requises :
 *   USERS_STORAGE_URL  — URL Scaleway Object Storage
 *   STORAGE_SECRET_KEY — clé secrète Object Storage
 *   JWT_SECRET         — secret pour vérifier le token de reset
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const {
  lireUtilisateurs,
  ecrireUtilisateurs,
  corsHeaders,
  reponseErreur,
  reponseOk,
} = require('../_shared/storage');

const JWT_SECRET = process.env.JWT_SECRET || '';

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

  const { token, password } = body;

  if (!token)    return reponseErreur(400, 'Token de réinitialisation requis.');
  if (!password) return reponseErreur(400, 'Nouveau mot de passe requis.');
  if (password.length < 8) {
    return reponseErreur(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  }

  /* -- Vérification du token JWT de reset -- */
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return reponseErreur(400, 'Token de réinitialisation invalide ou expiré.');
  }

  if (payload.type !== 'reset') {
    return reponseErreur(400, 'Token invalide.');
  }

  /* -- Récupération utilisateur -- */
  let utilisateurs;
  try {
    utilisateurs = await lireUtilisateurs();
  } catch (e) {
    console.error('[reset-confirm] Erreur lecture stockage :', e);
    return reponseErreur(500, 'Erreur serveur.');
  }

  const index = utilisateurs.findIndex(function (u) { return u.id === payload.sub; });

  if (index === -1) {
    return reponseErreur(400, 'Utilisateur introuvable.');
  }

  const utilisateur = utilisateurs[index];

  /* Vérification que le token correspond bien à celui stocké (usage unique) */
  if (!utilisateur.resetToken || utilisateur.resetToken !== token) {
    return reponseErreur(400, 'Token de réinitialisation déjà utilisé ou invalide.');
  }

  /* Vérification expiration stockée (double sécurité) */
  if (utilisateur.resetTokenExp && Date.now() > utilisateur.resetTokenExp) {
    return reponseErreur(400, 'Token de réinitialisation expiré.');
  }

  /* -- Hachage nouveau mot de passe -- */
  let hash;
  try {
    hash = await bcrypt.hash(password, 12);
  } catch (e) {
    console.error('[reset-confirm] Erreur bcrypt :', e);
    return reponseErreur(500, 'Erreur serveur — hachage impossible.');
  }

  /* -- Mise à jour + invalidation du token de reset -- */
  utilisateurs[index] = Object.assign({}, utilisateur, {
    password:      hash,
    resetToken:    null,
    resetTokenExp: null,
    updatedAt:     new Date().toISOString(),
  });

  try {
    await ecrireUtilisateurs(utilisateurs);
  } catch (e) {
    console.error('[reset-confirm] Erreur écriture stockage :', e);
    return reponseErreur(500, 'Erreur serveur — sauvegarde impossible.');
  }

  return reponseOk(200, { message: 'Mot de passe réinitialisé avec succès.' });
};
