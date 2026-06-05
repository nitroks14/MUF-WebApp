/**
 * MUF-WebApp Backend — Module partagé
 *
 * Fournit :
 *   - lireUtilisateurs()    → Promise<Array>
 *   - ecrireUtilisateurs()  → Promise<void>
 *   - corsHeaders()         → object
 *   - reponseOk()           → objet réponse Scaleway
 *   - reponseErreur()       → objet réponse Scaleway
 *
 * Stockage : Scaleway Object Storage (S3-compatible)
 *   Bucket : configuré via USERS_BUCKET_NAME
 *   Objet  : users.json
 *   Région : fr-par
 *
 * Variables d'environnement requises :
 *   SCW_ACCESS_KEY     — Access Key Scaleway IAM
 *   SCW_SECRET_KEY     — Secret Key Scaleway IAM
 *   USERS_BUCKET_NAME  — nom du bucket Object Storage
 *   SCW_REGION         — région (défaut : fr-par)
 */

'use strict';

const https        = require('https');
const crypto       = require('crypto');
const USERS_OBJECT = 'users.json';

const SCW_ACCESS_KEY   = process.env.SCW_ACCESS_KEY || '';
const SCW_SECRET_KEY   = process.env.SCW_SECRET_KEY || '';
const BUCKET_NAME      = process.env.USERS_BUCKET_NAME || '';
const REGION           = process.env.SCW_REGION || 'fr-par';
const S3_ENDPOINT      = `${BUCKET_NAME}.s3.${REGION}.scw.cloud`;

/* ----------------------------------------------------------
   CORS — autorise les appels depuis GitHub Pages
   ---------------------------------------------------------- */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };
}

/* ----------------------------------------------------------
   Réponses standardisées
   ---------------------------------------------------------- */
function reponseOk(statusCode, data) {
  return {
    statusCode,
    headers: corsHeaders(),
    body:    JSON.stringify(data),
  };
}

function reponseErreur(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body:    JSON.stringify({ error: message }),
  };
}

/* ----------------------------------------------------------
   Signature AWS Signature v4 (compatible Scaleway Object Storage)
   ---------------------------------------------------------- */
function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding || undefined);
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate    = hmac('AWS4' + secretKey, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function buildAuthHeader({ method, path, query, headers, payload, datestamp, amzdate }) {
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(function (k) { return k.toLowerCase() + ':' + headers[k] + '\n'; })
    .join('');

  const signedHeaders = Object.keys(headers)
    .sort()
    .map(function (k) { return k.toLowerCase(); })
    .join(';');

  const payloadHash = sha256Hex(payload || '');

  const canonicalRequest = [
    method,
    path,
    query || '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = datestamp + '/' + REGION + '/s3/aws4_request';

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzdate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSignatureKey(SCW_SECRET_KEY, datestamp, REGION, 's3');
  const signature  = hmac(signingKey, stringToSign, 'hex');

  return (
    'AWS4-HMAC-SHA256 Credential=' + SCW_ACCESS_KEY + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders +
    ', Signature=' + signature
  );
}

/* ----------------------------------------------------------
   Requête HTTP vers Object Storage
   ---------------------------------------------------------- */
function requeteS3({ method, objectKey, body }) {
  return new Promise(function (resolve, reject) {
    const now       = new Date();
    const amzdate   = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const datestamp = amzdate.slice(0, 8);
    const path      = '/' + objectKey;
    const payload   = body || '';

    const headers = {
      'Host':                 S3_ENDPOINT,
      'x-amz-date':          amzdate,
      'x-amz-content-sha256': sha256Hex(payload),
    };

    if (body) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const authorization = buildAuthHeader({
      method, path, query: '', headers, payload, datestamp, amzdate,
    });

    const reqHeaders = Object.assign({}, headers, { Authorization: authorization });

    const options = {
      hostname: S3_ENDPOINT,
      path,
      method,
      headers: reqHeaders,
    };

    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        if (res.statusCode === 404 && method === 'GET') {
          resolve(null); /* Objet inexistant → liste vide */
        } else if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error('S3 HTTP ' + res.statusCode + ' : ' + data));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(payload);
    req.end();
  });
}

/* ----------------------------------------------------------
   Lecture du fichier users.json
   ---------------------------------------------------------- */
async function lireUtilisateurs() {
  const raw = await requeteS3({ method: 'GET', objectKey: USERS_OBJECT });
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[storage] users.json corrompu :', e);
    return [];
  }
}

/* ----------------------------------------------------------
   Écriture du fichier users.json
   ---------------------------------------------------------- */
async function ecrireUtilisateurs(utilisateurs) {
  const body = JSON.stringify(utilisateurs);
  await requeteS3({ method: 'PUT', objectKey: USERS_OBJECT, body });
}

module.exports = {
  lireUtilisateurs,
  ecrireUtilisateurs,
  corsHeaders,
  reponseOk,
  reponseErreur,
};
