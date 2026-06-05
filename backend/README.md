# MUF-WebApp — Backend Scaleway Functions

Backend d'authentification de MUF-WebApp, déployé sur **Scaleway Serverless Functions** (région Paris, RGPD natif).

---

## Architecture

```
backend/
  functions/
    _shared/
      storage.js          Module partagé (Object Storage + helpers HTTP)
    auth-register/
      index.js            POST /auth/register
    auth-login/
      index.js            POST /auth/login
    auth-reset-request/
      index.js            POST /auth/reset-request
    auth-reset-confirm/
      index.js            POST /auth/reset-confirm
    auth-me/
      index.js            GET  /auth/me
  package.json
  README.md
```

Les utilisateurs sont stockés dans un fichier `users.json` dans un **bucket Scaleway Object Storage** (aucune base de données externe requise).

---

## Pré-requis

- Compte Scaleway actif (https://console.scaleway.com)
- CLI Scaleway installée : https://github.com/scaleway/scaleway-cli
- Node.js >= 18 installé localement (pour les dépendances)

---

## Étape 1 — Créer le bucket Object Storage

Dans la console Scaleway > Object Storage > Créer un bucket :

- **Région** : Paris (fr-par)
- **Nom** : `muf-webapp-users` (ou autre — noter le nom exact)
- **Visibilité** : Privé

Garder l'URL du bucket de côté : `muf-webapp-users.s3.fr-par.scw.cloud`

---

## Étape 2 — Créer les credentials IAM

Dans Scaleway > IAM > API Keys > Créer une clé :

- Associer à un utilisateur ou à une application dédiée
- Donner les permissions : `ObjectStorageObjectsRead`, `ObjectStorageObjectsWrite` sur le bucket créé

Noter :
- `SCW_ACCESS_KEY` (format : `SCWXXXXXXXXXXXXXXXXX`)
- `SCW_SECRET_KEY` (format : longue chaîne)

---

## Étape 3 — Créer le namespace Scaleway Functions

Dans Scaleway > Serverless Functions > Créer un namespace :

- **Région** : Paris (fr-par)
- **Nom** : `muf-webapp-auth`
- **Runtime** : Node.js 20

L'URL du namespace ressemblera à :
`https://muf-webapp-auth-xxxxxxxx.functions.fnc.fr-par.scw.cloud`

---

## Étape 4 — Déployer les fonctions

### 4a. Installer les dépendances

```bash
cd backend
npm install
```

### 4b. Zipper chaque fonction avec ses dépendances

Chaque fonction doit inclure `node_modules/` et le dossier `_shared/`.

```bash
# Exemple pour auth-register
cd backend
cp -r node_modules functions/auth-register/
cp -r functions/_shared functions/auth-register/
cd functions/auth-register
zip -r auth-register.zip .
```

Répéter pour `auth-login`, `auth-reset-request`, `auth-reset-confirm`, `auth-me`.

### 4c. Créer et déployer chaque fonction via la console Scaleway

Pour chaque fonction :

1. Scaleway > Serverless Functions > Namespace `muf-webapp-auth` > Créer une fonction
2. **Nom** : `auth-register` (ou le nom de la fonction)
3. **Handler** : `index.handler`
4. **Runtime** : Node.js 20
5. **Uploader le ZIP**
6. **HTTP** : activer (pas de vérification JWT Scaleway — le JWT est géré manuellement)
7. Ajouter les **variables d'environnement** (voir section ci-dessous)
8. **Déployer**

---

## Variables d'environnement

A configurer dans chaque fonction Scaleway (Scaleway > Function > Variables d'environnement) :

| Variable              | Description                                      | Exemple                                      |
|-----------------------|--------------------------------------------------|----------------------------------------------|
| `SCW_ACCESS_KEY`      | Access Key IAM Scaleway                          | `SCWXXXXXXXXXXXXXXXXX`                       |
| `SCW_SECRET_KEY`      | Secret Key IAM Scaleway                          | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`       |
| `USERS_BUCKET_NAME`   | Nom du bucket Object Storage                     | `muf-webapp-users`                           |
| `SCW_REGION`          | Région Scaleway                                  | `fr-par`                                     |
| `JWT_SECRET`          | Secret JWT (chaîne aléatoire longue et unique)   | Générer avec : `openssl rand -hex 64`        |
| `ALLOWED_EMAIL_DOMAIN`| Domaine email autorisé                           | `multivac.fr`                                |
| `RESET_BASE_URL`      | URL frontend pour le lien de reset               | `https://nitroks14.github.io/MUF-WebApp`     |
| `TEM_API_KEY`         | Clé API Scaleway Transactional Email             | (dans Scaleway > Transactional Email)        |
| `TEM_FROM_EMAIL`      | Adresse expéditrice vérifiée                     | `noreply@multivac.fr`                        |
| `TEM_FROM_NAME`       | Nom affiché dans les emails                      | `MUF-WebApp`                                 |

**Fonctions qui n'ont besoin que d'un sous-ensemble :**
- `auth-me` : `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `USERS_BUCKET_NAME`, `SCW_REGION`, `JWT_SECRET`
- `auth-login` : idem + `ALLOWED_EMAIL_DOMAIN`
- `auth-register` : toutes sauf `TEM_*` et `RESET_BASE_URL`
- `auth-reset-request` : toutes
- `auth-reset-confirm` : `SCW_*`, `USERS_BUCKET_NAME`, `SCW_REGION`, `JWT_SECRET`

---

## Étape 5 — Configurer le frontend

Editer `js/config.js` à la racine du repo :

```js
window.MUF_CONFIG = {
  BACKEND_URL: 'https://muf-webapp-auth-xxxxxxxx.functions.fnc.fr-par.scw.cloud',
};
```

Remplacer l'URL par celle du namespace Scaleway (affichée dans la console après déploiement).

---

## Étape 6 — Configurer Scaleway Transactional Email

1. Scaleway > Transactional Email > Ajouter un domaine (`multivac.fr`)
2. Suivre les instructions de vérification DNS
3. Récupérer la clé API dans Scaleway > IAM > API Keys (avec permission `TransactionalEmailEmailsWrite`)
4. Renseigner `TEM_API_KEY` et `TEM_FROM_EMAIL` dans les variables d'environnement de `auth-reset-request`

---

## Sécurité — points d'attention

- `JWT_SECRET` doit être unique, long (minimum 64 caractères hex), jamais versionné dans Git
- Le fichier `users.json` contient les hash bcrypt — le bucket doit rester **privé**
- Les mots de passe ne sont jamais logués ni stockés en clair
- Les tokens de reset sont à usage unique (invalidés après utilisation)
- La réponse de `/auth/reset-request` est identique que l'email existe ou non (anti-énumération)

---

## Test rapide des endpoints

```bash
# Register
curl -X POST https://VOTRE-NAMESPACE.functions.fnc.fr-par.scw.cloud/auth/register \
  -H "Content-Type: application/json" \
  -d '{"prenom":"Jean","nom":"Dupont","email":"jean.dupont@multivac.fr","password":"motdepasse123"}'

# Login
curl -X POST https://VOTRE-NAMESPACE.functions.fnc.fr-par.scw.cloud/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jean.dupont@multivac.fr","password":"motdepasse123"}'

# Me (remplacer TOKEN par le JWT retourné par login)
curl https://VOTRE-NAMESPACE.functions.fnc.fr-par.scw.cloud/auth/me \
  -H "Authorization: Bearer TOKEN"
```
