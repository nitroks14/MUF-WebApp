/**
 * Scaleway Function — POST /auth/reset-request
 *
 * Corps attendu (JSON) :
 *   { email }
 *
 * Génère un token de reset (1h), le stocke dans la liste des utilisateurs,
 * puis envoie un email via Scaleway Transactional Email (SES-compatible).
 *
 * Variables d'environnement requises :
 *   USERS_STORAGE_URL     — URL Scaleway Object Storage
 *   STORAGE_SECRET_KEY    — clé secrète Object Storage
 *   JWT_SECRET            — secret pour signer le token de reset
 *   RESET_BASE_URL        — URL de base du frontend (ex: https://nitroks14.github.io/MUF-WebApp)
 *   TEM_API_KEY           — clé API Scaleway Transactional Email
 *   TEM_FROM_EMAIL        — adresse expéditrice vérifiée (ex: noreply@multivac.fr)
 *   TEM_FROM_NAME         — nom affiché (ex: MUF-WebApp)
 *   ALLOWED_EMAIL_DOMAIN  — domaine autorisé (défaut : multivac.fr)
 */

'use strict';

const jwt   = require('jsonwebtoken');
const https = require('https');
const {
  lireUtilisateurs,
  ecrireUtilisateurs,
  corsHeaders,
  reponseErreur,
  reponseOk,
} = require('../_shared/storage');

const JWT_SECRET         = process.env.JWT_SECRET || '';
const RESET_BASE_URL     = process.env.RESET_BASE_URL || '';
const TEM_API_KEY        = process.env.TEM_API_KEY || '';
const TEM_FROM_EMAIL     = process.env.TEM_FROM_EMAIL || '';
const TEM_FROM_NAME      = process.env.TEM_FROM_NAME || 'MUF-WebApp';
const DOMAINE_AUTORISE   = process.env.ALLOWED_EMAIL_DOMAIN || 'multivac.fr';
const RESET_EXPIRATION   = '1h';

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

  const { email } = body;

  if (!email || !email.trim()) return reponseErreur(400, 'L\'adresse email est requise.');

  const emailNormalise = email.trim().toLowerCase();

  if (!emailNormalise.endsWith('@' + DOMAINE_AUTORISE)) {
    return reponseErreur(400, `L'adresse email doit se terminer par @${DOMAINE_AUTORISE}.`);
  }

  /* -- Récupération utilisateur -- */
  let utilisateurs;
  try {
    utilisateurs = await lireUtilisateurs();
  } catch (e) {
    console.error('[reset-request] Erreur lecture stockage :', e);
    return reponseErreur(500, 'Erreur serveur.');
  }

  const utilisateur = utilisateurs.find(function (u) { return u.email === emailNormalise; });

  /*
   * Réponse identique que l'utilisateur existe ou non
   * (anti-énumération d'email)
   */
  if (!utilisateur) {
    return reponseOk(200, { message: 'Si ce compte existe, un email de réinitialisation a été envoyé.' });
  }

  /* -- Génération token de reset -- */
  if (!JWT_SECRET) {
    console.error('[reset-request] JWT_SECRET non configurée !');
    return reponseErreur(500, 'Erreur serveur — configuration manquante.');
  }

  const resetToken = jwt.sign(
    { sub: utilisateur.id, email: emailNormalise, type: 'reset' },
    JWT_SECRET,
    { expiresIn: RESET_EXPIRATION }
  );

  /* Stockage du token dans le profil utilisateur (pour invalidation après usage) */
  const index = utilisateurs.indexOf(utilisateur);
  utilisateurs[index] = Object.assign({}, utilisateur, {
    resetToken:    resetToken,
    resetTokenExp: Date.now() + 3600000, /* +1h en ms */
  });

  try {
    await ecrireUtilisateurs(utilisateurs);
  } catch (e) {
    console.error('[reset-request] Erreur écriture stockage :', e);
    return reponseErreur(500, 'Erreur serveur — sauvegarde impossible.');
  }

  /* -- Envoi email via Scaleway Transactional Email -- */
  const lienReset = RESET_BASE_URL + '?reset_token=' + encodeURIComponent(resetToken);

  const contenuEmail = [
    'Bonjour ' + utilisateur.prenom + ',',
    '',
    'Vous avez demandé la réinitialisation de votre mot de passe MUF-WebApp.',
    '',
    'Cliquez sur le lien suivant pour définir un nouveau mot de passe (valable 1 heure) :',
    lienReset,
    '',
    'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet email.',
    '',
    'L\'équipe MUF-WebApp — Multivac France',
  ].join('\n');

  try {
    await envoyerEmail({
      to:      emailNormalise,
      subject: 'Réinitialisation de votre mot de passe MUF-WebApp',
      text:    contenuEmail,
    });
  } catch (e) {
    console.error('[reset-request] Erreur envoi email :', e);
    /* Ne pas bloquer la réponse si l'email échoue — logguer seulement */
  }

  return reponseOk(200, { message: 'Si ce compte existe, un email de réinitialisation a été envoyé.' });
};

/* ----------------------------------------------------------
   Envoi email via Scaleway Transactional Email (API REST)
   ---------------------------------------------------------- */
function envoyerEmail({ to, subject, text }) {
  return new Promise(function (resolve, reject) {
    if (!TEM_API_KEY || !TEM_FROM_EMAIL) {
      reject(new Error('Variables TEM_API_KEY / TEM_FROM_EMAIL non configurées.'));
      return;
    }

    const payload = JSON.stringify({
      from: { email: TEM_FROM_EMAIL, name: TEM_FROM_NAME },
      to:   [{ email: to }],
      subject,
      text,
    });

    const options = {
      hostname: 'api.scaleway.com',
      path:     '/transactional-email/v1alpha1/regions/fr-par/emails',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Auth-Token':   TEM_API_KEY,
      },
    };

    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error('Scaleway TEM HTTP ' + res.statusCode + ' : ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
