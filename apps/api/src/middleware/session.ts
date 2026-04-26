import type { MiddlewareHandler } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { eq, schema } from '@workspace/db'
import type { AppContext } from '../lib/context.ts'
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfMatches,
  csrfTokenForSession,
} from '../lib/csrf.ts'

export type Role = 'user' | 'admin' | 'owner'

export type HonoEnv = {
  Variables: {
    ctx: AppContext
    session: {
      user: { id: string; email: string; role: Role; banned: boolean }
      session: { id: string }
    } | null
    // Set by hono/request-id; mounted globally in apps/api/src/index.ts.
    requestId: string
  }
}

export function sessionMiddleware(ctx: AppContext): MiddlewareHandler<HonoEnv> {
  const csrfSecure = ctx.env.BETTER_AUTH_URL.startsWith('https')
  return async (c, next) => {
    let resolved: HonoEnv['Variables']['session'] = null
    // Bind Databuddy anonymous + session IDs from the client so server-side events
    // are stitched to the same visitor journey in the analytics dashboard.
    // These are analytics identity only — not trusted for auth or billing.
    const headerOrNull = (name: string) => {
      const value = c.req.header(name)?.trim()
      return value || null
    }
    const dbIds = {
      anonymousId: headerOrNull('X-Db-Anon-Id'),
      sessionId: headerOrNull('X-Db-Session-Id'),
    }
    const requestCtx: AppContext = {
      ...ctx,
      track: (name, userId, properties) => ctx.track(name, userId, properties, dbIds),
    }
    c.set('ctx', requestCtx)
    try {
      const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers })
      // Banned users get treated as logged out — no enumeration of routes that would otherwise
      // succeed, no follow-on writes. They can still log in, but every request short-circuits here.
      if (session && !(session as { user: { banned?: boolean } }).user.banned) {
        resolved = session as HonoEnv['Variables']['session']
      }
    } catch {
      resolved = null
    }
    c.set('session', resolved)
    if (resolved) {
      // Issue/refresh the CSRF cookie. Deterministic HMAC of the session id — stable for the
      // session's lifetime, rotates automatically on re-login. SameSite=Strict so it never
      // crosses origins; not httpOnly so the web client can mirror it back as X-CSRF-Token.
      setCookie(
        c,
        CSRF_COOKIE_NAME,
        csrfTokenForSession(resolved.session.id, ctx.env.BETTER_AUTH_SECRET),
        {
          sameSite: 'Strict',
          secure: csrfSecure,
          httpOnly: false,
          path: '/',
          ...(ctx.env.AUTH_COOKIE_DOMAIN ? { domain: ctx.env.AUTH_COOKIE_DOMAIN } : {}),
        },
      )
    } else if (c.req.header('cookie')?.includes(`${CSRF_COOKIE_NAME}=`)) {
      // Session is gone (logout, expiry, ban) but the client still holds a stale CSRF cookie
      // tied to the old session id. Clear it so the next login bootstraps cleanly without a
      // first-mutation 403. Skipped for fully-anonymous traffic to avoid Set-Cookie noise on
      // federation/crawler requests.
      deleteCookie(c, CSRF_COOKIE_NAME, {
        path: '/',
        ...(ctx.env.AUTH_COOKIE_DOMAIN ? { domain: ctx.env.AUTH_COOKIE_DOMAIN } : {}),
      })
    }
    await next()
  }
}

export function requireAuth(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const session = c.get('session')
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    await next()
  }
}

// Role check goes back to the DB because better-auth's session.user surface doesn't include
// custom fields like `role` by default. Per-request DB hit is fine — admin endpoints are low
// volume — and it means a role change takes effect on the very next request.
export function requireRole(...roles: Array<Role>): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const session = c.get('session')
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    const { db } = c.get('ctx')
    const [row] = await db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, session.user.id))
      .limit(1)
    const role = (row?.role ?? 'user') as Role
    if (!roles.includes(role)) return c.json({ error: 'forbidden' }, 403)
    // Make the looked-up role visible to handlers (e.g. admin route checks owner-only logic).
    session.user.role = role
    await next()
  }
}

export const requireAdmin = () => requireRole('admin', 'owner')
export const requireOwner = () => requireRole('owner')

/**
 * Reject mutating requests whose `Origin` header isn't in the trusted list. This makes bare
 * curl/Postman writes fail by default — those clients omit the Origin header entirely. CORS
 * already gates browser cross-origin reads; this closes the server-side gap for state changes.
 *
 * GETs / HEADs / OPTIONS are skipped (idempotent + needed for CORS preflight). OAuth callbacks
 * (`/api/auth/callback/*`) are skipped because they're top-level navigations from external
 * providers and won't carry an Origin header.
 */
export function requireSameOrigin(trustedOrigins: Array<string>): MiddlewareHandler<HonoEnv> {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
  const trusted = new Set(trustedOrigins)
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) return next()
    const path = c.req.path
    if (path.startsWith('/api/auth/callback/')) return next()
    const origin = c.req.header('Origin')
    if (!origin || !trusted.has(origin)) {
      return c.json({ error: 'invalid_origin' }, 403)
    }
    await next()
  }
}

/**
 * Double-submit CSRF check. Closes the gap requireSameOrigin can't: a non-browser caller with
 * a stolen session cookie can spoof the Origin header trivially. The CSRF token is an HMAC of
 * the session id sent both as a SameSite=Strict cookie and an X-CSRF-Token header — an
 * attacker without our BETTER_AUTH_SECRET can't compute it, and the strict cookie never rides
 * along on cross-site requests.
 *
 * Skipped on safe methods (no state change), on /api/auth/* (better-auth runs its own origin
 * check + better-auth flows can't read the cookie before login), and when there's no session
 * (requireAuth on the route handles it; nothing to defend yet).
 */
export function requireCsrf(): MiddlewareHandler<HonoEnv> {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
  return async (c, next) => {
    if (safeMethods.has(c.req.method)) return next()
    if (c.req.path.startsWith('/api/auth/')) return next()
    const session = c.get('session')
    if (!session) return next()
    const provided = c.req.header(CSRF_HEADER_NAME)
    if (!provided) return c.json({ error: 'csrf_missing' }, 403)
    const expected = csrfTokenForSession(session.session.id, c.get('ctx').env.BETTER_AUTH_SECRET)
    if (!csrfMatches(provided, expected)) return c.json({ error: 'csrf_invalid' }, 403)
    await next()
  }
}
