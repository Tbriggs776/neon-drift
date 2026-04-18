// Shared Supabase client. Auth + leaderboard both import from here to avoid
// constructing two clients (each one starts its own auth listener).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export let supabase = null;
export let online = false;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Magic-link sign-in needs a persisted session so the user stays
        // logged in across reloads. The device anon_id lives in localStorage
        // separately and isn't affected by this.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    online = true;
  } catch (e) {
    console.warn('Supabase init failed, running offline:', e);
  }
}
