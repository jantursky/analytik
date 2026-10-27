import { defineMeta } from 'blume'

export default defineMeta({
  title: 'Deploy',
  order: 5,
  pages: [
    'cloudflare-workers-d1',
    'vercel-supabase',
    'railway-postgres',
    'bun-node-sqlite',
    'backups-retention-and-upgrades',
  ],
})
