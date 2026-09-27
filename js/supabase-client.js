// Creates one shared Supabase client for the whole site.
// Loaded after supabase-config.js, before navbar.js / auth.js.
const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
