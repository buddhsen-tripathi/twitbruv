import Redis from 'ioredis'
import type { Context } from 'hono'
import type { Logger } from 'pino'

export interface FixedWindowLimit {
  windowMs: number
  max: number
}

export interface RateLimiterConfig {
  redis: Redis
  prefix?: string
}

export class RateLimiter {
  private redis: Redis
  private prefix: string

  constructor(config: RateLimiterConfig) {
    this.redis = config.redis
    this.prefix = config.prefix ?? 'rl'
  }

  /** Fixed-window limiter. Returns true when the action is allowed. */
  async check(key: string, limit: FixedWindowLimit): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const bucketMs = limit.windowMs
    const bucket = Math.floor(Date.now() / bucketMs)
    const redisKey = `${this.prefix}:${key}:${bucket}`
    const count = await this.redis.incr(redisKey)
    if (count === 1) {
      await this.redis.pexpire(redisKey, bucketMs + 50)
    }
    return {
      allowed: count <= limit.max,
      remaining: Math.max(0, limit.max - count),
      resetAt: (bucket + 1) * bucketMs,
    }
  }
}

export function createRedisClient(url: string) {
  return new Redis(url, { lazyConnect: false })
}

export { BUCKETS, type BucketName } from './limits.ts'
import { BUCKETS, type BucketName } from './limits.ts'

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
  (c: Context, bucket: BucketName): Promise<void>
}

export function makeRateLimit(redisUrl: string, log: Logger): RateLimitChecker {
  const limiter = new RateLimiter({ redis: createRedisClient(redisUrl) })
  const rlLog = log.child({ scope: 'rate-limit' })

  return async function check(c, bucket) {
    const windows = BUCKETS[bucket]
    const session = c.get('session')
    const subject =
      session?.user.id ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'anon'

    // Per window: logs and re-throws Redis errors, logs and throws RateLimitError on denial,
    // logs and sets X-RateLimit-Remaining on success.
    for (const window of windows) {
      const key = `${bucket}:${subject}:${window.windowMs}`
      let result: Awaited<ReturnType<typeof limiter.check>>
      try {
        result = await limiter.check(key, window)
      } catch (err) {
        rlLog.error(
          { err: err instanceof Error ? err.message : err, bucket, subject, windowMs: window.windowMs },
          'rl_redis_error',
        )
        throw err
      }
      if (!result.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
        rlLog.warn(
          { bucket, subject, windowMs: window.windowMs, retryAfterSec },
          'rl_block',
        )
        throw new RateLimitError(bucket, retryAfterSec, result.resetAt)
      }
      rlLog.debug(
        { bucket, subject, windowMs: window.windowMs, remaining: result.remaining },
        'rl_check',
      )
      c.header('X-RateLimit-Remaining', String(result.remaining))
    }
  }
}

/** Hook on the global app onError to render rate-limit errors consistently. */
export function handleRateLimitError(err: unknown, c: Context) {
  if (!(err instanceof RateLimitError)) return null
  c.header('Retry-After', String(err.retryAfterSec))
  c.header('X-RateLimit-Reset', String(Math.ceil(err.resetAt / 1000)))
  return c.json(
    { error: 'rate_limited', bucket: err.bucket, retryAfterSec: err.retryAfterSec },
    429,
  )
}
