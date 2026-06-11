/**
 * MUF-WebApp — Anti-autofill navigateur (helper partagé, RÉFÉRENCE PROJET)
 *
 * PROBLÈME
 *   Chrome (desktop + Android) et Safari iOS IGNORENT `autocomplete="off"` pour
 *   leur autofill « profil » (nom, email, adresse postale) : ils proposent quand
 *   même l'email perso et les adresses enregistrées de l'utilisateur, y compris
 *   sur des champs `type="number"`. Le set « fort » historique du projet
 *   (autocomplete=off + autocorrect/autocapitalize/spellcheck + data-lpignore /
 *   data-1p-ignore / data-form-type) bloque bien les GESTIONNAIRES de mots de
 *   passe (LastPass, 1Password) mais PAS l'autofill natif Chrome/Safari.
 *
 * TECHNIQUE RETENUE (la seule réellement robuste sur Chrome/Safari)
 *   Chrome ne mémorise et ne propose des valeurs QUE pour des champs dont
 *   l'attribut `autocomplete` a une valeur SÉMANTIQUE qu'il reconnaît
 *   (`email`, `name`, `street-address`, `off`…). En posant à la place un
 *   TOKEN LEURRE ALÉATOIRE non reconnu (ex. `nope-7f3a1c`), le navigateur ne
 *   sait plus à quel type rattacher le champ : il n'a donc aucune valeur de
 *   profil à proposer. C'est ce jeton inconnu — et non `off` — qui coupe
 *   réellement l'autofill. Réf. : Chromium issue 40093420 (« autofill does not
 *   respect autocomplete=off »), workaround « random token » documenté.
 *
 *   Pour les champs les plus tenaces (email / nom / adresse), Chrome se rabat
 *   aussi sur les heuristiques de `name` / `id` (mots-clés `email`, `name`,
 *   `address`…). On neutralise donc EN PLUS l'attribut `name` de ces champs par
 *   un leurre (l'original est conservé dans `data-original-name`). L'app lit ses
 *   champs par `id` et ne soumet aucun formulaire natif : renommer `name` est
 *   sans effet fonctionnel (vérifié — seuls les groupes de radios utilisent
 *   `name`, et ils ne sont PAS traités, voir plus bas).
 *
 * SET COMPLET APPLIQUÉ À CHAQUE CHAMP
 *   - autocomplete = <token leurre aléatoire>   → bloque l'autofill natif Chrome/Safari
 *   - autocorrect="off" autocapitalize="off" spellcheck="false"
 *   - data-lpignore="true" data-1p-ignore data-form-type="other"  → LastPass/1Password
 *   - (champs à risque email/nom/adresse) name = <leurre>, id conservé
 *
 * PÉRIMÈTRE
 *   - Appliqué par app.js à #app-content après le chargement de CHAQUE plugin,
 *     puis maintenu par un MutationObserver pour les champs ajoutés dynamiquement
 *     (lignes de tableau liste-pieces / retour-garantie, blocs conditionnels…).
 *   - Couvre input texte/email/search/tel/url/number/password/date + textarea
 *     + select. EXCLUT radio / checkbox / file / hidden / range / color / button
 *     (pas d'autofill, et le `name` des radios pilote leurs groupes : à préserver).
 *
 * OPT-OUT
 *   Un champ portant `data-autofill-keep` est ignoré (autofill sémantique VOULU).
 *   Les formulaires d'AUTH du shell (#auth-overlay : connexion / inscription /
 *   reset) ne sont jamais traités car app.js scope le helper sur #app-content
 *   uniquement : leurs autocomplete sémantiques (email, current-password…) sont
 *   préservés.
 *
 * NON-RÉGRESSION
 *   - window.ClientAutocomplete (liste déroulante VOULUE de recherche clients)
 *     applique son propre faisceau d'attributs et n'est pas perturbé : on ne
 *     touche ni aux écouteurs ni à la valeur des champs, seulement aux attributs
 *     anti-autofill (déjà présents).
 *   - On ne modifie JAMAIS `readonly` (technique anti-autofill « readonly au
 *     montage » du champ de recherche clients) ni la valeur d'un champ.
 *
 * API — window.AntiAutofill
 *   .apply(root)    → applique le set sur tous les champs de `root` (défaut: document).
 *                     Retourne le nombre de champs traités.
 *   .observe(root)  → applique puis surveille `root` (MutationObserver) pour
 *                     équiper les champs ajoutés ensuite. Retourne l'observer.
 *   .protect(field) → applique le set sur un champ unique (usage avancé).
 */

'use strict';

(function () {

  /* Génère un token leurre court et unique : valeur d'autocomplete que les
     heuristiques du navigateur ne savent pas mapper à un type de profil connu.
     Préfixe non sémantique + aléatoire → jamais égal à email/name/off/etc. */
  function tokenLeurre(prefixe) {
    return (prefixe || 'nope') + '-' +
      Math.random().toString(36).slice(2, 8) +
      Date.now().toString(36).slice(-3);
  }

  /* Types d'input à protéger. On EXCLUT explicitement les types sans autofill
     texte et ceux dont le name est structurant (radio/checkbox). */
  var TYPES_INPUT_PROTEGES = {
    text: true, email: true, search: true, tel: true, url: true,
    number: true, password: true, date: true, 'datetime-local': true,
    month: true, week: true, time: true,
    /* un <input> sans attribut type === type "text" implicite */
    '': true,
  };

  /* Heuristique « champ à risque profil » : email/nom/adresse, là où Chrome est
     le plus insistant. On y neutralise AUSSI le name. On regarde type + id +
     name + placeholder (insensible casse/accents légers). */
  function estChampARisque(el) {
    if (el.type === 'email') return true;
    var indices = [
      el.id || '',
      el.getAttribute('name') || '',
      el.getAttribute('placeholder') || '',
    ].join(' ').toLowerCase();
    return /e-?mail|adress|address|\bnom\b|name|destinataire|binome|contact|technicien|prenom|tech/.test(indices);
  }

  /* Applique le set anti-autofill sur un champ unique. Idempotent : on peut le
     rappeler sans dommage (utile avec le MutationObserver). */
  function protect(el) {
    if (!el || el.nodeType !== 1) return false;

    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;

    /* Opt-out explicite (autofill sémantique VOULU). */
    if (el.hasAttribute('data-autofill-keep')) return false;

    /* Pour les <input>, ne traiter que les types pertinents (exclut
       radio/checkbox/file/hidden/range/color/button/submit/reset/image). */
    if (tag === 'INPUT') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (!TYPES_INPUT_PROTEGES.hasOwnProperty(type)) return false;
    }

    /* Marqueur d'idempotence : déjà équipé → ne rien refaire. */
    if (el.getAttribute('data-anti-autofill') === '1') return true;

    /* 1) Token leurre dans autocomplete : LA garde efficace contre Chrome/Safari. */
    el.setAttribute('autocomplete', tokenLeurre('nope'));

    /* 2) Désactive correction/capitalisation/orthographe (bruit clavier mobile). */
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');

    /* 3) Gestionnaires de mots de passe (LastPass / 1Password). */
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', '');
    el.setAttribute('data-form-type', 'other');

    /* 4) Champs à risque profil : neutraliser AUSSI le name (heuristiques Chrome).
          On préserve l'original (au cas où) — mais jamais sur un radio/checkbox
          (déjà exclus ci-dessus) afin de ne pas casser un groupe. */
    if (estChampARisque(el)) {
      var nameActuel = el.getAttribute('name');
      if (nameActuel && el.getAttribute('data-original-name') === null) {
        el.setAttribute('data-original-name', nameActuel);
      }
      el.setAttribute('name', tokenLeurre('field'));
    }

    el.setAttribute('data-anti-autofill', '1');
    return true;
  }

  /* Applique sur tous les champs d'un conteneur. */
  function apply(root) {
    root = root || document;
    var champs = root.querySelectorAll('input, textarea, select');
    var n = 0;
    for (var i = 0; i < champs.length; i++) {
      if (protect(champs[i])) n++;
    }
    return n;
  }

  /* Applique puis surveille le conteneur : tout champ ajouté ensuite (lignes de
     tableau, blocs conditionnels révélés, suggestions…) est équipé à la volée.
     Un seul observer par root : on le mémorise sur l'élément. */
  function observe(root) {
    root = root || document;
    apply(root);

    if (root.__antiAutofillObserver) return root.__antiAutofillObserver;
    if (typeof MutationObserver !== 'function') return null;

    /* Batching : plutôt que de scanner à CHAQUE vague de mutations (coûteux sur
       un DOM massif, ex. ajout de 20 lignes de tableau d'un coup), on accumule
       les nœuds ajoutés dans un buffer et on ne lance le traitement qu'UNE fois
       par frame via requestAnimationFrame. La couverture est identique (on
       traite exactement les mêmes nœuds, juste regroupés) ; seul le nombre de
       passes de protect() est réduit. Repli sur traitement synchrone si rAF
       indisponible. protect() étant idempotent (data-anti-autofill="1"), un
       doublon éventuel dans le buffer est sans effet. */
    var raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      : function (cb) { return setTimeout(cb, 16); };

    var bufferNodes = [];
    var flushPlanifie = false;

    function flush() {
      flushPlanifie = false;
      var aTraiter = bufferNodes;
      bufferNodes = [];
      for (var i = 0; i < aTraiter.length; i++) {
        var node = aTraiter[i];
        /* Le nœud lui-même… */
        protect(node);
        /* …et ses descendants champs. */
        if (node.querySelectorAll) {
          var sous = node.querySelectorAll('input, textarea, select');
          for (var k = 0; k < sous.length; k++) protect(sous[k]);
        }
      }
    }

    var obs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var ajoutes = mutations[i].addedNodes;
        for (var j = 0; j < ajoutes.length; j++) {
          var node = ajoutes[j];
          if (node.nodeType !== 1) continue;
          bufferNodes.push(node);
        }
      }
      if (bufferNodes.length && !flushPlanifie) {
        flushPlanifie = true;
        raf(flush);
      }
    });
    obs.observe(root, { childList: true, subtree: true });
    root.__antiAutofillObserver = obs;
    return obs;
  }

  window.AntiAutofill = {
    apply: apply,
    observe: observe,
    protect: protect,
  };

})();
