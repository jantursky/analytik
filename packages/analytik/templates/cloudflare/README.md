# Analytik on Cloudflare

A Worker that serves the [Analytik](https://github.com/jantursky/analytik) dashboard, the tracker script and the API, with its data in a D1 database.

## Deploy

```bash
npm install
npx wrangler d1 create analytik   # copy the database_id into wrangler.jsonc
npx wrangler deploy
printf '{"ADMIN_PASSWORD":"choose-a-password","SESSION_SECRET":"%s"}' "$(openssl rand -hex 32)" > secrets.json
npx wrangler secret bulk secrets.json && rm secrets.json
```

Open the Worker's URL, sign in with the password, add your site, and paste the tracking snippet it shows into your pages.

For local work, put `ADMIN_PASSWORD` and `SESSION_SECRET` in `.dev.vars` and run `npm run dev`.

## Email

To get payment alerts, a daily or weekly summary and a warning when tracking stops, add a [Resend](https://resend.com) key and the addresses as secrets, then turn the emails on in Settings → Email:

```bash
printf '{"RESEND_API_KEY":"re_...","EMAIL_FROM":"analytik@your-domain.com","EMAIL_TO":"you@example.com"}' > secrets.json
npx wrangler secret bulk secrets.json && rm secrets.json
```

The hourly cron in `wrangler.jsonc` also deletes data older than a site's retention period (Settings → Privacy → Keep data for), in bounded steps. Add a `CRON_SECRET` secret (any long random string) so events stop starting that purge themselves. The same cron sends the summary at the hour you chose. Any other sender works too: edit `src/worker.ts` to use `httpSender` or `cloudflareSender` from `analytik/email`.

The schema is created on the first request, so after a package upgrade you only need to deploy again.
