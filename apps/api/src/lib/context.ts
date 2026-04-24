import PgBoss from 'pg-boss'
import { createAuth, type AuthInstance } from '@workspace/auth/server'
import { createDb, type Database } from '@workspace/db'
import { createMailer, type Mailer } from '@workspace/email'
import { createS3, ensureBucket, type S3 } from '@workspace/media/s3'
import type { MediaEnv } from '@workspace/media/env'
import { loadEnv, type Env } from './env.ts'
import { createCache, type Cache } from './cache.ts'
import { createPubSub, type PubSub } from './pubsub.ts'
import { makeRateLimit } from './rate-limit.ts'

export interface AppContext {
  env: Env
  db: Database
  mailer: Mailer
  auth: AuthInstance
  s3: S3
  mediaEnv: MediaEnv
  boss: PgBoss
  cache: Cache
  pubsub: PubSub
  rateLimit: ReturnType<typeof makeRateLimit>
}

export async function buildContext(): Promise<AppContext> {
  const env = loadEnv()
  const db = createDb(env.DATABASE_URL)

  const mailer = createMailer({
    from: env.EMAIL_FROM,
    provider: env.EMAIL_PROVIDER,
    resendApiKey: env.RESEND_API_KEY,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })

  const auth = createAuth({
    db,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.AUTH_TRUSTED_ORIGINS,
    cookieDomain: env.AUTH_COOKIE_DOMAIN,
    sendEmail: async ({ to, subject, template, data }) => {
      await mailer.send({ to, subject, template, data })
    },
    ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {}),
    ...(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET
      ? { gitlab: { clientId: env.GITLAB_CLIENT_ID, clientSecret: env.GITLAB_CLIENT_SECRET } }
      : {}),
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {}),
  })

  const mediaEnv: MediaEnv = {
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_REGION: env.S3_REGION,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: env.S3_BUCKET,
    S3_PUBLIC_URL: env.S3_PUBLIC_URL,
  }
  const s3 = createS3(mediaEnv)

  // Dev-only: ensure the bucket exists and allows CORS from the web origin. Safe no-op on prod
  // against a pre-provisioned R2 bucket (it will overwrite the CORS policy, so do this only in dev).
  if (env.NODE_ENV !== 'production') {
    await ensureBucket({ s3, bucket: mediaEnv.S3_BUCKET, allowedOrigins: env.AUTH_TRUSTED_ORIGINS })
  }

  const boss = new PgBoss({ connectionString: env.DATABASE_URL })
  boss.on('error', (err) => console.error('pg-boss:', err))
  await boss.start()
  // NOTE: queues are declared by the worker only (apps/worker). Calling createQueue from both
  // processes concurrently deadlocks on pgboss.queue row locks in Postgres.

  const cache = createCache(env.REDIS_URL)
  const pubsub = createPubSub(env.REDIS_URL)
  const rateLimit = makeRateLimit(env.REDIS_URL)

  return { env, db, mailer, auth, s3, mediaEnv, boss, cache, pubsub, rateLimit }
}
