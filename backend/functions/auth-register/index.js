/**
 * Scaleway Function — POST /auth/register
 *
 * Corps attendu (JSON) :
 *   { prenom, nom, email, password }
 *
 * Règles :
 *   - email doit se terminer par @multivac.fr
 *   - password haché avec bcrypt (coût 12)
 *   - pas de doublon email
 *   - retourne un JWT (7 jours)
 *
 * Variables d'environnement requises :
 *   USERS_STORAGE_URL  — URL Scaleway Object Storage (bucket JSON)
 *   STORAGE_SECRET_KEY — clé secrète d'accès Object Storage
 *   JWT_SECRET         — secret pour signer les JWT
 *   ALLOWED_EMAIL_DOMAIN — domaine autorisé (défaut : multivac.fr)
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

const DOMAINE_AUTORISE = process.env.ALLOWED_EMAIL_DOMAIN || 'multivac.fr';
const JWT_SECRET       = process.env.JWT_SECRET || '';
const JWT_EXPIRATION   = '7d';

module.exports.handler = async function (event) {
  /* Gestion CORS preflight */
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

  const { prenom, nom, email, password } = body;

  /* -- Validation des champs -- */
  if (!prenom || !prenom.trim()) return reponseErreur(400, 'Le prénom est requis.');
  if (!nom    || !nom.trim())    return reponseErreur(400, 'Le nom est requis.');
  if (!email  || !email.trim())  return reponseErreur(400, 'L\'adresse email est requise.');
  if (!password)                 return reponseErreur(400, 'Le mot de passe est requis.');
  if (password.length < 8)      return reponseErreur(400, 'Le mot de passe doit contenir au moins 8 caractères.');

  const emailNormalise = email.trim().toLowerCase();

  /* -- Validation domaine email -- */
  if (!emailNormalise.endsWith('@' + DOMAINE_AUTORISE)) {
    return reponseErreur(400, `L'adresse email doit se terminer par @${DOMAINE_AUTORISE}.`);
  }

  /* -- Vérification doublon -- */
  let utilisateurs;
  try {
    utilisateurs = await lireUtilisateurs();
  } catch (e) {
    console.error('[register] Erreur lecture stockage :', e);
    return reponseErreur(500, 'Erreur serveur — impossible d\'accéder au stockage.');
  }

  if (utilisateurs.find(function (u) { return u.email === emailNormalise; })) {
    return reponseErreur(409, 'Un compte existe déjà pour cette adresse email.');
  }

  /* -- Hachage mot de passe -- */
  let hash;
  try {
    hash = await bcrypt.hash(password, 12);
  } catch (e) {
    console.error('[register] Erreur bcrypt :', e);
    return reponseErreur(500, 'Erreur serveur — hachage impossible.');
  }

  /* -- Création utilisateur -- */
  const nouvelUtilisateur = {
    id:         Date.now().toString(36) + Math.random().toString(36).slice(2),
    prenom:     prenom.trim(),
    nom:        nom.trim(),
    email:      emailNormalise,
    password:   hash,
    createdAt:  new Date().toISOString(),
  };

  utilisateurs.push(nouvelUtilisateur);

  try {
    await ecrireUtilisateurs(utilisateurs);
  } catch (e) {
    console.error('[register] Erreur écriture stockage :', e);
    return reponseErreur(500, 'Erreur serveur — impossible de sauvegarder le compte.');
  }

  /* -- Génération JWT -- */
  if (!JWT_SECRET) {
    console.error('[register] JWT_SECRET non configurée !');
    return reponseErreur(500, 'Erreur serveur — configuration JWT manquante.');
  }

  const token = jwt.sign(
    { sub: nouvelUtilisateur.id, email: emailNormalise },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );

  return reponseOk(201, {
    token,
    user: {
      id:     nouvelUtilisateur.id,
      prenom: nouvelUtilisateur.prenom,
      nom:    nouvelUtilisateur.nom,
      email:  emailNormalise,
    },
  });
};
