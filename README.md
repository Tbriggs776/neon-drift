# Neon Drift

Roguelike synthwave bullet hell. Endless waves, mini-bosses every 5, Warden every 25. Browser-based, PWA-installable, canvas-rendered, single-player with a global leaderboard.

## Stack

- **Frontend**: Vanilla JS + HTML Canvas (no framework)
- **Build**: Vite
- **Backend**: Supabase (leaderboard + anonymous analytics)
- **Host**: Vercel
- **Audio**: MP3 assets served from CDN
- **PWA**: Service worker + manifest for offline play and home-screen install

## Project Structure

```
neon-drift/
├── index.html              # Entry HTML (Vite)
├── src/
│   ├── game.js             # Main game loop and logic
│   ├── leaderboard.js      # Supabase client + score submission
│   ├── styles.css          # All game styles
│   └── body.html           # Body markup snippet (imported into index.html at build)
├── public/
│   ├── audio/              # Sound effects and background music (MP3)
│   ├── icon-192.png        # PWA icon
│   ├── icon-512.png        # PWA icon
│   ├── manifest.webmanifest
│   └── sw.js               # Service worker
├── supabase/
│   └── schema.sql          # Database schema + RLS policies
├── package.json
├── vite.config.js
├── vercel.json             # Vercel deploy config + caching headers
└── .env.example            # Copy to .env.local and fill in
```

## First-Time Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a new Supabase project

1. Go to https://supabase.com/dashboard/new
2. Name it `neon-drift`, choose a region close to your users
3. Save the database password somewhere safe (you won't need it for this app, but you don't want to lose it)
4. Wait 2-3 minutes for provisioning to complete

### 3. Apply the schema

1. In the Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Paste the contents of `supabase/schema.sql`
4. Click **Run**. You should see "Success. No rows returned."

This creates:
- `public.scores` table (all run submissions)
- `public.global_stats_view` (aggregated stats for title screen)
- Row-level security policies so the anon key can only INSERT plausible scores and SELECT the leaderboard. No update/delete.

### 4. Grab your Supabase keys

In the Supabase dashboard:
- **Project Settings → API → Project URL** — copy this (e.g. `https://abcd1234.supabase.co`)
- **Project Settings → API → Project API Keys → anon public** — copy this

### 5. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and paste your values:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

### 6. Run locally

```bash
npm run dev
```

Open http://localhost:5173. The leaderboard should be live. Play a run, die, and check the Supabase dashboard → Table Editor → `scores` to confirm the submission landed.

## Deploy to Vercel

### Option A: Git-based (recommended)

1. Push the project to a GitHub repo
2. Go to https://vercel.com/new
3. Import the repo
4. In the **Environment Variables** section, add:
   - `VITE_SUPABASE_URL` = your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
5. Click **Deploy**

Vercel autodetects Vite. The `vercel.json` in this repo configures aggressive caching for audio/assets and no-cache for the service worker.

The default subdomain will be `neon-drift.vercel.app` (or similar if taken). You can change it in Project Settings → Domains.

### Option B: CLI

```bash
npm install -g vercel
vercel login
vercel

# First-time setup — follow prompts, choose "neon-drift" as project name
# When asked about environment variables, add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

vercel --prod   # ship to production
```

## How the Leaderboard Works

- Every player gets a random `anon_id` stored in `localStorage` on first visit (no account required)
- Optional display name: set it in the input on the title screen. Saved to `localStorage`
- When a run ends, the client calls `submitScore()` with wave, score, combo, cores, duration, and which upgrades were picked
- The client does a plausibility check (score can't exceed `wave * 50000`, wave must be 1-500, etc.) before sending
- The Supabase row-level security policy re-checks plausibility server-side via CHECK constraints
- The leaderboard screen shows the top 20 scores globally and the player's personal best
- Title screen shows aggregated global stats: total runs, record wave, record score

### What this catches and doesn't catch

**Catches:** casual tampering, bugs, noise submissions, misconfigured clients, value overflow.

**Doesn't catch:** a motivated cheater who reverse-engineers the client and submits valid-looking high scores. For that you'd need server-side run validation (replay every upgrade pick and verify the final state is reachable). Not worth building until the audience is big enough to matter.

## Analytics

The `upgrades_picked` column on `scores` is a JSONB array of upgrade IDs chosen during the run. You can query things like:

```sql
-- Most picked upgrades across all runs
select upgrade_id, count(*) as picks
from scores, jsonb_array_elements_text(upgrades_picked) as upgrade_id
group by upgrade_id
order by picks desc;

-- Average wave reached per build archetype (if you add tags)
select
  case
    when upgrades_picked ? 'drone1' then 'drone-heavy'
    when upgrades_picked ? 'beam' then 'beam-build'
    else 'other'
  end as archetype,
  avg(wave) as avg_wave,
  count(*) as runs
from scores
group by archetype;
```

## PWA Installation

Once deployed, visitors on mobile can tap **Add to Home Screen** to install Neon Drift as a standalone app. It launches fullscreen, works offline (after first load), and has its own icon.

- iOS: Safari → Share → Add to Home Screen
- Android: Chrome → Menu → Install app
- Desktop: Chrome/Edge → URL bar install icon

## Local Asset Caching

The service worker caches:
- `/index.html`, `/manifest.webmanifest`
- `/audio/*.mp3` (background music + SFX)
- All emitted `/assets/*.js` and `/assets/*.css` from the Vite build

Supabase API calls are never cached so leaderboard data is always fresh.

## Roadmap Notes (not shipped, for later)

- **Accounts** — Supabase Auth with email magic link. Add when there's demand for cross-device progress sync.
- **Capacitor app** — wrap for App Store / Play Store. Add after PWA traction warrants the $99/yr Apple Developer fee.
- **Cosmetic unlocks / IAP** — Stripe integration, unlock ship skins. Add after a core audience exists.
- **Per-upgrade-pick analytics table** — uncomment the `upgrade_picks` table in schema.sql if you want per-decision telemetry rather than per-run.
- **Run replays** — record input stream, replay for anti-cheat server-side validation. Big effort, only worth it if cheating becomes a real problem.

## Known Limitations

- The leaderboard plausibility checks are client + DB CHECK constraints only. A motivated cheater with browser dev tools could submit tampered scores. See above.
- The game loop uses `requestAnimationFrame` and is frame-rate sensitive at very high refresh rates (>240Hz). Untested on those displays.
- Safari on iOS locks audio until user interaction. First click on "Launch Run" unlocks it.
- PWA service worker caches aggressively. When you deploy an update, users may see the old version until they close all tabs and reopen. This is normal PWA behavior.
