-- ============================================================
-- NEON DRIFT - PHASE 9: self-serve account deletion
-- Apply AFTER phase7_challenges.sql.
-- ============================================================
-- App Store guideline 5.1.1(v) requires apps that offer sign-up to also
-- let users delete their account from inside the app. The anon key can't
-- touch auth.users, so this runs as the function owner.
--
-- Deleting the auth.users row cascades to profiles and friendships.
-- scores.user_id is ON DELETE SET NULL, which would leave the pilot's name
-- on the leaderboard, so their attributed scores are removed first.
-- ============================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.scores where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
