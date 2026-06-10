-- =====================================================================
-- MUF-WebApp — Référentiel "clients" (schéma de référence)
-- =====================================================================
--
-- ⚠️ Ce fichier est fourni À TITRE DE RÉFÉRENCE / DOCUMENTATION.
--    La table `clients` est déjà créée côté serveur Supabase.
--    NE PAS rejouer ce script tel quel sur la base de production :
--    il sert uniquement à versionner le schéma à côté du code afin que
--    la couche offline (js/db.js) et la synchro (js/sync-manager.js)
--    restent alignées avec la structure serveur.
--
-- Sécurité : Row Level Security (RLS) active — chaque utilisateur ne voit
-- et n'écrit que ses propres lignes (auth.uid() = user_id).
-- Stratégie de suppression : SOFT-DELETE via la colonne `deleted`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  nom         text        not null,
  adresse     text,
  contact     text,
  email       text,                                       -- email de l'interlocuteur (optionnel)
  code_client text,                                       -- code client interne (optionnel, "si connu")
  machines    jsonb       not null default '[]'::jsonb,  -- liste de { type, numero, annee? }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean     not null default false
);

-- ---------------------------------------------------------------------
-- Migration (colonnes ajoutées après la création initiale de la table).
-- Idempotent : à rejouer sans risque si la table existe déjà.
--   email       : email de l'interlocuteur
--   code_client : code client interne
-- L'année des machines voyage dans le JSONB `machines` (objets
-- { type, numero, annee }) — aucun changement de schéma requis pour elle.
-- ---------------------------------------------------------------------
alter table public.clients add column if not exists email       text;
alter table public.clients add column if not exists code_client text;

-- Index d'appui pour la synchro delta (updated_at) et le filtrage par usager.
create index if not exists clients_user_id_idx    on public.clients (user_id);
create index if not exists clients_updated_at_idx on public.clients (updated_at);

-- ---------------------------------------------------------------------
-- Trigger : mise à jour automatique de updated_at à chaque UPDATE
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- NB perf (advisor Supabase auth_rls_initplan) : auth.uid() est enveloppé dans
-- un sous-select `(select auth.uid())` pour n'être évalué qu'UNE fois par requête
-- (et non par ligne). Comportement identique, plan optimisé. Migration appliquée
-- en prod le 2026-06-10 (optimize_clients_rls_initplan).
--
-- NB sécurité : la base porte aussi un event trigger `public.rls_auto_enable()`
-- (SECURITY DEFINER) qui active automatiquement la RLS sur toute nouvelle table
-- du schéma `public`. Son EXECUTE a été retiré à PUBLIC le 2026-06-10
-- (migration revoke_public_execute_rls_auto_enable) — l'event trigger continue
-- de se déclencher indépendamment de ce privilège.
alter table public.clients enable row level security;

-- Lecture : uniquement ses propres lignes (y compris les soft-deletes, afin
-- que la synchro côté client puisse les répliquer / les masquer localement).
drop policy if exists clients_select_own on public.clients;
create policy clients_select_own
  on public.clients
  for select
  using ((select auth.uid()) = user_id);

-- Insertion : la ligne créée doit appartenir à l'utilisateur courant.
-- (user_id n'est pas envoyé par le client : le défaut auth.uid() le remplit.)
drop policy if exists clients_insert_own on public.clients;
create policy clients_insert_own
  on public.clients
  for insert
  with check ((select auth.uid()) = user_id);

-- Mise à jour : uniquement ses propres lignes (le soft-delete passe par ici).
drop policy if exists clients_update_own on public.clients;
create policy clients_update_own
  on public.clients
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Suppression physique : une policy DELETE EXISTE en production (chaque usager
-- peut supprimer physiquement ses propres lignes). L'app n'utilise que le
-- soft-delete (colonne `deleted`), donc cette policy n'est pas exercée en
-- pratique — mais elle est présente côté serveur, versionnée ici pour cohérence.
drop policy if exists clients_delete_own on public.clients;
create policy clients_delete_own
  on public.clients
  for delete
  using ((select auth.uid()) = user_id);
