-- ============================================================
-- NEON DRIFT - SUPABASE SCHEMA
-- ============================================================
-- Run this in the Supabase SQL editor after creating the project.
-- It creates the scores table, the global stats view, and sets up
-- row-level security so the anon key can only do what we want.
-- ============================================================

-- ---- Scores table ----
create table if not exists public.scores (
  id            bigserial primary key,
  anon_id       text not null,
  display_name  text,
  wave          integer not null check (wave >= 1 and wave <= 500),
  score         integer not null check (score >= 0),
  best_combo    integer not null default 0 check (best_combo >= 0),
  cores         integer not null default 0 check (cores >= 0),
  run_duration_ms integer,
  upgrades_picked jsonb default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- Indexes for leaderboard query (sort by score desc) and per-player best
create index if not exists idx_scores_score_desc on public.scores (score desc);
create index if not exists idx_scores_anon_id on public.scores (anon_id);
create index if not exists idx_scores_created_at on public.scores (created_at desc);

-- ---- Global stats view ----
-- Aggregates for the title screen: total runs, record wave, record score
create or replace view public.global_stats_view as
select
  count(*)::integer as total_runs,
  coalesce(max(wave), 0)::integer as record_wave,
  coalesce(max(score), 0)::integer as record_score,
  coalesce(max(best_combo), 0)::integer as record_combo,
  count(distinct anon_id)::integer as total_players
from public.scores;

-- ---- Row-level security ----
alter table public.scores enable row level security;

-- Anon can read top scores (for leaderboard)
drop policy if exists "anon_select_scores" on public.scores;
create policy "anon_select_scores" on public.scores
  for select
  to anon
  using (true);

-- Anon can insert scores (gameplay submissions)
drop policy if exists "anon_insert_scores" on public.scores;
create policy "anon_insert_scores" on public.scores
  for insert
  to anon
  with check (
    wave >= 1 and wave <= 500
    and score >= 0 and score <= wave * 50000
    and best_combo >= 0 and best_combo <= 10000
    and cores >= 0
    and anon_id is not null
    and length(anon_id) <= 60
    and (display_name is null or length(display_name) <= 20)
  );

-- No update, no delete for anon users (explicitly deny by omission)

-- Grant select on the view
grant select on public.global_stats_view to anon;

-- ---- Optional: upgrades analytics (separate table for richer telemetry) ----
-- If you want per-upgrade-pick analytics later, uncomment:
-- create table if not exists public.upgrade_picks (
--   id         bigserial primary key,
--   anon_id    text not null,
--   wave       integer not null,
--   upgrade_id text not null,
--   rarity     text not null,
--   created_at timestamptz not null default now()
-- );
-- alter table public.upgrade_picks enable row level security;
-- create policy "anon_insert_upgrade_picks" on public.upgrade_picks
--   for insert to anon with check (true);
