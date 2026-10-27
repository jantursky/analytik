# analytik on Cloudflare

A Worker that serves the [analytik](https://github.com/jantursky/analytik) dashboard, the tracker script and the API, with its data in a D1 database.

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

The schema is created on the first request, so after a package upgrade you only need to deploy again.
