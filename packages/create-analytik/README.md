# create-analytik

Sets up [analytik](https://github.com/jantursky/analytik) on Cloudflare Workers, with the dashboard included, and puts it online.

```bash
npm create analytik@latest my-stats
```

It makes the project folder, installs the packages, signs you in to Cloudflare, creates the D1 database, deploys the Worker and sets the secrets. It prints the address and a generated dashboard password at the end.

Add `-- --no-deploy` to only write the files, or `-- --name shop-stats` to pick the Worker's name:

```bash
npm create analytik@latest my-stats -- --no-deploy
```

The same thing is available as `npx analytik create my-stats`. More in the [Cloudflare guide](https://analytik-docs.vercel.app/deploy/cloudflare-workers-d1).
