# SenyaSabi Admin

1. Run `supabase/senyasabi_admin_rpc.sql` in the Supabase SQL editor.
2. Put your values in `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).
3. `npm install` then `npm run dev`.
4. `npm run build` outputs a static site in `dist/`. Set the same two variables
   in your host's environment settings before building.

Use only the anon (public) key. Never put the service_role key here: Vite bundles
VITE_ variables into the browser. Access is protected by the is_admin() check in the SQL.
