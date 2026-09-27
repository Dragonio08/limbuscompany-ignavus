// Creates one shared Supabase client for the whole site, attached to
// `window` so every other script can reach it reliably regardless of
// load order or browser caching quirks.
// Loaded after supabase-config.js, before navbar.js / auth.js.
window.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
