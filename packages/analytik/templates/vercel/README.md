# Analytik on Vercel

One Vercel function that serves the [Analytik](https://github.com/jantursky/analytik) dashboard, the tracker script and the API, with its data in Postgres (Supabase, Neon or any other).

## Deploy

1. Create a Postgres database and copy its **pooled** connection string: Supabase's transaction pooler (port 6543) or Neon's pooled connection (host ending in `-pooler`).
2. Set three environment variables in the Vercel project: `DATABASE_URL` (that string), `ADMIN_PASSWORD` (the password you sign in with) and `SESSION_SECRET` (at least 32 random characters, for example `openssl rand -hex 32`).
3. Deploy with `npx vercel --prod`, or let the Deploy button above do steps 2 and 3.

Open the project's address, sign in, add your site and paste the tracking snippet it shows. The schema is created on the first request.

## Email

To get payment alerts, a daily or weekly summary and a warning when tracking stops, add the environment variables `RESEND_API_KEY` ([Resend](https://resend.com)), `EMAIL_FROM`, `EMAIL_TO` and `CRON_SECRET` (any long random string), redeploy, and turn the emails on in Settings → Email.

`vercel.json` calls `/api/v1/cron` once a day at 07:00 UTC, which is what the Hobby plan allows: choose a summary hour of 07:00 or earlier. On Pro, change the schedule to `0 * * * *` so the summary goes out at the hour you pick. Any other sender works too: edit `api/index.ts` to use `httpSender` from `analytik/email`.

The `vercel.json` rewrite sends every path to the one function, which answers `/` with the dashboard, `/js/analytik.js` with the tracker and `/api/*` with the API.
