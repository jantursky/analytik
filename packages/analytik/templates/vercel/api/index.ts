import postgres from 'postgres'
import { createAnalytik } from 'analytik/server'
import { withDashboard } from 'analytik/standalone'
import { postgresStorage } from 'analytik/storage/postgres'

// Supabase's transaction pooler and Neon's pooled connection have no prepared statements, so they stay off.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })

const { app } = createAnalytik({
  storage: postgresStorage(sql),
  admin: { password: process.env.ADMIN_PASSWORD!, secret: process.env.SESSION_SECRET! },
})

export default withDashboard(app)
