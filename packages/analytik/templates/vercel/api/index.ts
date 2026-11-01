import postgres from 'postgres'
import { resendSender } from 'analytik/email'
import { createAnalytik } from 'analytik/server'
import { withDashboard } from 'analytik/standalone'
import { postgresStorage } from 'analytik/storage/postgres'

// Supabase's transaction pooler and Neon's pooled connection have no prepared statements, so they stay off.
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 })

const { app } = createAnalytik({
  storage: postgresStorage(sql),
  admin: { password: process.env.ADMIN_PASSWORD!, secret: process.env.SESSION_SECRET! },
  // Optional: set RESEND_API_KEY and EMAIL_FROM for payment alerts, a summary and a tracker-down warning (Settings → Email).
  email:
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM
      ? {
          send: resendSender({ apiKey: process.env.RESEND_API_KEY }),
          from: process.env.EMAIL_FROM,
          to: process.env.EMAIL_TO,
          // Vercel Cron sends this as `Authorization: Bearer <CRON_SECRET>`.
          cronSecret: process.env.CRON_SECRET,
        }
      : undefined,
})

export default withDashboard(app)
