-- ============================================================
-- NEON DRIFT - PHASE 7: weekly challenges
-- Apply AFTER phase5_friends.sql.
-- ============================================================

-- Nullable date tag identifying the ISO week a run belongs to, if any.
-- Non-challenge runs keep it NULL.
alter table public.scores
  add column if not exists challenge_week date;

-- Partial index so weekly leaderboard queries stay fast without
-- bloating the row-wide scores index.
create index if not exists idx_scores_challenge_week_score
  on public.scores (challenge_week, score desc)
  where challenge_week is not null;
