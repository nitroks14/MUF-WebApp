# Configuration Supabase — MUF-WebApp

L'authentification (inscription, connexion, réinitialisation de mot de passe)
repose sur **Supabase Auth**. Aucun backend maison n'est nécessaire : tout passe
par `supabase-js` v2 chargé via CDN, côté navigateur.

> Projet Supabase : `https://audwdqqrrnubbzszzdgw.supabase.co`
> Les valeurs `SUPABASE_URL` et `SUPABASE_ANON_KEY` (clé *publishable*) sont
> **publiques par conception** et vivent dans `js/config.js`. Elles peuvent
> figurer dans le dépôt sans risque ; la sécurité repose sur les politiques
> Supabase, pas sur le secret de cette clé.

---

## 1. Réglages à faire dans le dashboard Supabase

Tout se passe dans **Authentication** (menu de gauche du projet).

### 1.1 Activer le provider Email

`Authentication → Providers → Email`

- **Enable Email provider** : **ON**
- **Confirm email** : voir le choix recommandé ci-dessous.

### 1.2 Confirmation d'email — choix recommandé : **OFF**

`Authentication → Providers → Email → Confirm email`

**Recommandation : désactiver la confirmation d'email (OFF).**

Justification :
- Le garde-fou principal est déjà la validation **`@multivac.fr`** (regex côté
  frontend, dans `index.html` / `js/auth.js`). Seuls des emails Multivac peuvent
  créer un compte.
- L'email intégré de Supabase est **fortement limité en débit** (voir §3). Moins
  on en dépend, plus l'usage interne est fluide.
- Avec la confirmation OFF, l'inscription ouvre directement une session :
  l'email ne sert alors **plus que** pour la **réinitialisation de mot de passe**.

> Le code gère **les deux cas** :
> - Confirmation **OFF** → après `signUp`, session immédiate → l'app démarre.
> - Confirmation **ON** → `signUp` ne renvoie pas de session : l'utilisateur voit
>   un message « vérifiez votre email pour confirmer » et est renvoyé vers l'écran
>   de connexion. Aucune modification de code n'est requise pour basculer.

### 1.3 URL de redirection (pour le lien de reset)

`Authentication → URL Configuration`

- **Site URL** : l'URL GitHub Pages de l'app
  → `https://nitroks14.github.io/MUF-WebApp/`
- **Redirect URLs** : ajouter (autorise le retour du lien de réinitialisation)
  → `https://nitroks14.github.io/MUF-WebApp/`
  → `https://nitroks14.github.io/MUF-WebApp/#auth-nouveau-mdp`

  Pour les tests en local, ajouter aussi votre origine locale, par ex. :
  → `http://localhost:5500/` (et `.../#auth-nouveau-mdp`)

> Le lien de réinitialisation envoyé par Supabase renvoie l'utilisateur sur l'app
> avec le hash `#auth-nouveau-mdp`. `supabase-js` (`detectSessionInUrl: true`)
> établit alors une session temporaire, et l'écran « Nouveau mot de passe »
> s'affiche automatiquement (`supabase.auth.updateUser({ password })`).

### 1.4 (Optionnel) Restreindre les domaines autorisés côté serveur

La validation `@multivac.fr` est faite côté frontend. Si vous souhaitez un
garde-fou **serveur** supplémentaire, vous pouvez ajouter une contrainte via un
trigger SQL ou les réglages d'allow-list de domaine. Non requis pour cette tâche.

---

## 2. Ce qui est géré automatiquement par le code

- **Session** : persistée par `supabase-js` dans le `localStorage`
  (`persistSession: true`, `autoRefreshToken: true`). Connexion sur plusieurs
  appareils → **même compte**. Vérifiée à chaque démarrage via
  `supabase.auth.getSession()`.
- **Mot de passe** : géré et haché **par Supabase**. Jamais stocké ni manipulé en
  clair côté application.
- **Prénom / Nom** : stockés dans les `user_metadata` à l'inscription, relus via
  `Auth.getUser()` (`{ id, prenom, nom, email }`).

---

## 3. ⚠️ Limite importante : emails Supabase (avant déploiement)

Le **service email intégré de Supabase est fortement limité en débit**
(quelques emails/heure au maximum). Il est **prévu pour le développement et les
tests uniquement**.

Concrètement :
- Pour développer et tester à quelques personnes : **OK, rien à faire**.
- Avant le déploiement aux **~80 techniciens** (et surtout si la confirmation
  d'email est laissée ON, ou pour fiabiliser les emails de reset) : il faut
  configurer un **SMTP personnalisé**.

### SMTP personnalisé recommandé : **Brevo** 🇫🇷

- Fournisseur français, palier gratuit ~**300 emails/jour**.
- À configurer dans : `Authentication → Emails → SMTP Settings`
  (renseigner host, port, user, mot de passe SMTP fournis par Brevo, et
  l'adresse d'expéditeur).

> Ce point **ne bloque ni le développement ni les tests initiaux**. C'est un
> prérequis **avant la mise en production** auprès des techniciens.

---

## 4. Récapitulatif des actions manuelles restantes

| Action | Où | Statut attendu |
| --- | --- | --- |
| Activer le provider Email | Auth → Providers → Email | ON |
| Confirmation d'email | Auth → Providers → Email → Confirm email | OFF (recommandé) |
| Site URL = URL GitHub Pages | Auth → URL Configuration | renseignée |
| Redirect URLs (dont `#auth-nouveau-mdp`) | Auth → URL Configuration | ajoutées |
| SMTP personnalisé (Brevo) | Auth → Emails → SMTP Settings | **avant prod** |
