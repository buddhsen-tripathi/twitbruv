import type { Context } from 'hono'
import {
  RateLimiter,
  createRedisClient,
  type FixedWindowLimit,
} from '@workspace/rate-limit'
import type { HonoEnv } from '../middleware/session.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

function intEnv(key: string, fallback: number) {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Defaults mirror the architecture plan. Each overridable via env.
export const BUCKETS = {
  'posts.create': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_POSTS_PER_MINUTE', 5) },
    { windowMs: HOUR, max: intEnv('RATE_LIMIT_POSTS_PER_HOUR', 30) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_POSTS_PER_DAY', 300) },
  ],
  'posts.reply': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_REPLIES_PER_MINUTE', 20) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_REPLIES_PER_DAY', 1000) },
  ],
  'posts.like': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_LIKES_PER_MINUTE', 60) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_LIKES_PER_DAY', 1000) },
  ],
  'posts.bookmark': [
    { windowMs: DAY, max: intEnv('RATE_LIMIT_BOOKMARKS_PER_DAY', 1000) },
  ],
  'posts.repost': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_REPOSTS_PER_MINUTE', 30) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_REPOSTS_PER_DAY', 500) },
  ],
  'users.follow': [{ windowMs: DAY, max: intEnv('RATE_LIMIT_FOLLOWS_PER_DAY', 400) }],
  'media.upload': [{ windowMs: HOUR, max: intEnv('RATE_LIMIT_UPLOADS_PER_HOUR', 30) }],
  // Analytics pings are batched client-side. A generous per-minute cap catches abuse without
  // hurting legitimate scrollers.
  'analytics.ingest': [{ windowMs: MIN, max: intEnv('RATE_LIMIT_ANALYTICS_PER_MINUTE', 60) }],
  'dms.send': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_DMS_PER_MINUTE', 30) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_DMS_PER_DAY', 1000) },
  ],
  'dms.start': [{ windowMs: HOUR, max: intEnv('RATE_LIMIT_DM_STARTS_PER_HOUR', 30) }],
  // Typing pings are debounced client-side to ~one per 3s; this cap is generous.
  'dms.typing': [{ windowMs: MIN, max: intEnv('RATE_LIMIT_TYPING_PER_MINUTE', 60) }],
  // Account creation. Tight per-IP cap to make spam signups expensive without breaking
  // legitimate household/coworker shared-IP signups.
  'auth.signup': [
    { windowMs: HOUR, max: intEnv('RATE_LIMIT_SIGNUPS_PER_HOUR', 5) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_SIGNUPS_PER_DAY', 20) },
  ],
  // Login attempts — guard against credential stuffing / brute force.
  'auth.signin': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_SIGNINS_PER_MINUTE', 10) },
    { windowMs: HOUR, max: intEnv('RATE_LIMIT_SIGNINS_PER_HOUR', 60) },
  ],
  'users.block': [{ windowMs: DAY, max: intEnv('RATE_LIMIT_BLOCKS_PER_DAY', 100) }],
  'users.mute': [{ windowMs: DAY, max: intEnv('RATE_LIMIT_MUTES_PER_DAY', 100) }],
  'posts.edit': [
    { windowMs: MIN, max: intEnv('RATE_LIMIT_POST_EDITS_PER_MINUTE', 10) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_POST_EDITS_PER_DAY', 200) },
  ],
  'articles.write': [
    { windowMs: HOUR, max: intEnv('RATE_LIMIT_ARTICLES_PER_HOUR', 20) },
    { windowMs: DAY, max: intEnv('RATE_LIMIT_ARTICLES_PER_DAY', 100) },
  ],
} satisfies Record<string, Array<FixedWindowLimit>>

export type BucketName = keyof typeof BUCKETS

export class RateLimitError extends Error {
  constructor(
    public readonly bucket: BucketName,
    public readonly retryAfterSec: number,
    public readonly resetAt: number,
  ) {
    super(`rate_limited:${bucket}`)
  }
}

export interface RateLimitChecker {
  /**
   * Throws {@link RateLimitError} when the bucket is exhausted. On success, writes rate-limit
   * headers onto the response. Call this at the top of any mutating handler.
   */
  (c: Context<HonoEnv>, bucket: BucketName): Promise<void>
}

export function makeRateLimit(redisUrl: string): RateLimitChecker {
  const limiter = new RateLimiter({ redis: createRedisClient(redisUrl) })

  return async function check(c, bucket) {
    const windows = BUCKETS[bucket]
    const session = c.get('session')
    const subject =
      session?.user.id ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'anon'

    for (const window of windows) {
      const key = `${bucket}:${subject}:${window.windowMs}`
      const result = await limiter.check(key, window)
      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
        throw new RateLimitError(bucket, retryAfterSec, result.resetAt)
      }
      c.header('X-RateLimit-Remaining', String(result.remaining))
    }
  }
}

/** Hook on the global app onError to render rate-limit errors consistently. */
export function handleRateLimitError(err: unknown, c: Context<HonoEnv>) {
  if (!(err instanceof RateLimitError)) return null
  c.header('Retry-After', String(err.retryAfterSec))
  c.header('X-RateLimit-Reset', String(Math.ceil(err.resetAt / 1000)))
  return c.json(
    { error: 'rate_limited', bucket: err.bucket, retryAfterSec: err.retryAfterSec },
    429,
  )
}
