-- ============================================================
-- NEON DRIFT - PHASE 4: accounts + profiles
-- Apply AFTER schema.sql.
-- ============================================================

-- ---- Profiles table (1:1 with auth.users) ----
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone can read profiles (needed so leaderboard can show names)
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select to anon, authenticated using (true);

-- Only the owner can update their own profile
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- Auto-create a profile row on signup ----
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- Link scores to user_id (nullable for anon backward-compat) ----
alter table public.scores
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_scores_user_id on public.scores (user_id);

-- ---- Replace SELECT policy: anon + authenticated can both read ----
drop policy if exists "anon_select_scores" on public.scores;
drop policy if exists "scores_select_all" on public.scores;
create policy "scores_select_all" on public.scores
  for select to anon, authenticated using (true);

-- ---- Replace INSERT policies: split anon vs authenticated ----
-- Anon: must NOT set user_id; same plausibility checks as before.
drop policy if exists "anon_insert_scores" on public.scores;
create policy "anon_insert_scores" on public.scores
  for insert to anon
  with check (
    user_id is null
    and wave between 1 and 500
    and score >= 0 and score <= wave * 50000
    and best_combo between 0 and 10000
    and cores >= 0
    and anon_id is not null and length(anon_id) <= 60
    and (display_name is null or length(display_name) <= 20)
  );

-- Authenticated: user_id MUST equal the caller's auth.uid().
drop policy if exists "auth_insert_scores" on public.scores;
create policy "auth_insert_scores" on public.scores
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and wave between 1 and 500
    and score >= 0 and score <= wave * 50000
    and best_combo between 0 and 10000
    and cores >= 0
    and anon_id is not null and length(anon_id) <= 60
    and (display_name is null or length(display_name) <= 20)
  );

-- ---- Grant view access to authenticated role too ----
grant select on public.global_stats_view to authenticated;
