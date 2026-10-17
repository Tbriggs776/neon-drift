-- ============================================================
-- NEON DRIFT - PHASE 11: security advisor fixes
-- Apply AFTER phase10_progress_sync.sql.
-- ============================================================

-- The stats view runs with the caller's permissions instead of its
-- owner's. scores is readable by everyone already (scores_select_all), so
-- the title-screen stats are unchanged.
alter view public.global_stats_view set (security_invoker = true);

-- Pin the trigger function's search path.
alter function public.handle_friendship_accept() set search_path = public;

-- handle_new_user only runs as the signup trigger; nobody should call it
-- through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Still reported by the advisor, on purpose:
-- - delete_my_account() is callable by signed-in users. That's its job; it
--   only ever deletes the caller's own account (auth.uid()).
-- - Leaked password protection is an Auth setting in the Supabase
--   dashboard, not SQL.
