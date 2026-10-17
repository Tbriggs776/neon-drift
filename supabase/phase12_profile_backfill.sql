-- ============================================================
-- NEON DRIFT - PHASE 12: every account has a profile row
-- Apply AFTER phase11_security_hardening.sql.
-- ============================================================
-- Accounts created before the on_auth_user_created trigger existed never
-- got a profiles row, so saving a pilot name updated nothing. Backfill
-- them, and let pilots create their own row so the client can heal any
-- that are still missing (setProfileDisplayName upserts).

insert into public.profiles (id)
select u.id from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));
