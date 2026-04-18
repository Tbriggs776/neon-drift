-- ============================================================
-- NEON DRIFT - PHASE 5: friendships + friends-only leaderboard
-- Apply AFTER phase4_accounts.sql.
-- ============================================================

create table if not exists public.friendships (
  id            bigserial primary key,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  check (requester_id <> recipient_id)
);

-- Canonical pair uniqueness: prevents both A->B and B->A existing simultaneously.
create unique index if not exists friendships_pair_uniq
  on public.friendships (
    least(requester_id::text, recipient_id::text),
    greatest(requester_id::text, recipient_id::text)
  );

create index if not exists idx_friendships_requester on public.friendships (requester_id, status);
create index if not exists idx_friendships_recipient on public.friendships (recipient_id, status);

-- Stamp accepted_at server-side when a recipient flips status to 'accepted'.
create or replace function public.handle_friendship_accept()
returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    new.accepted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_friendship_accept on public.friendships;
create trigger on_friendship_accept
  before update on public.friendships
  for each row execute function public.handle_friendship_accept();

-- ---- RLS ----
alter table public.friendships enable row level security;

-- SELECT: only the two parties to a friendship can see it.
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, recipient_id));

-- INSERT: caller must be the requester, can't request themselves, must start pending.
drop policy if exists "friendships_insert_self" on public.friendships;
create policy "friendships_insert_self" on public.friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and recipient_id <> auth.uid()
    and status = 'pending'
    and accepted_at is null
  );

-- UPDATE: only the recipient of a still-pending row can flip it to accepted.
-- (No other field changes allowed; trigger sets accepted_at.)
drop policy if exists "friendships_update_recipient_accept" on public.friendships;
create policy "friendships_update_recipient_accept" on public.friendships
  for update to authenticated
  using (recipient_id = auth.uid() and status = 'pending')
  with check (recipient_id = auth.uid() and status = 'accepted');

-- DELETE: either party can drop the row (cancel pending, decline incoming, or unfriend).
drop policy if exists "friendships_delete_own" on public.friendships;
create policy "friendships_delete_own" on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, recipient_id));
