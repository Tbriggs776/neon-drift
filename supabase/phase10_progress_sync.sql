-- ============================================================
-- NEON DRIFT - PHASE 10: cloud save for pilot progress
-- Apply AFTER phase9_account_deletion.sql.
-- ============================================================
-- One row per signed-in pilot holding their progress: pilot XP, chosen
-- ship and color, Hangar upgrade levels, banked cores and personal bests.
-- The client merges it with the device's local save on sign-in and keeps
-- it up to date after every save (src/progressSync.js).
--
-- Deleting the auth user cascades to this row, so delete_my_account()
-- removes it too.
-- ============================================================

create table if not exists public.player_progress (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  progress   jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;

-- Pilots can read and write only their own progress.
drop policy if exists "progress_select_own" on public.player_progress;
create policy "progress_select_own" on public.player_progress
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "progress_insert_own" on public.player_progress;
create policy "progress_insert_own" on public.player_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "progress_update_own" on public.player_progress;
create policy "progress_update_own" on public.player_progress
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
