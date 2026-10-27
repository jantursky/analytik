# Analytik on Vercel

One Vercel function that serves the [Analytik](https://github.com/jantursky/analytik) dashboard, the tracker script and the API, with its data in Postgres (Supabase, Neon or any other).

## Deploy

1. Create a Postgres database and copy its **pooled** connection string: Supabase's transaction pooler (port 6543) or Neon's pooled connection (host ending in `-pooler`).
2. Set three environment variables in the Vercel project: `DATABASE_URL` (that string), `ADMIN_PASSWORD` (the password you sign in with) and `SESSION_SECRET` (at least 32 random characters, for example `openssl rand -hex 32`).
3. Deploy with `npx vercel --prod`, or let the Deploy button above do steps 2 and 3.

Open the project's address, sign in, add your site and paste the tracking snippet it shows. The schema is created on the first request.

The `vercel.json` rewrite sends every path to the one function, which answers `/` with the dashboard, `/analytik.js` with the tracker and `/api/*` with the API.
