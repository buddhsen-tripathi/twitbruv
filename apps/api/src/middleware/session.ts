import type { MiddlewareHandler } from 'hono'
import type { AppContext } from '../lib/context.ts'

export type Role = 'user' | 'admin' | 'owner'

export type HonoEnv = {
  Variables: {
    ctx: AppContext
    session: {
      user: { id: string; email: string; role: Role; banned: boolean }
      session: { id: string }
    } | null
  }
}

export function sessionMiddleware(ctx: AppContext): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    c.set('ctx', ctx)
    try {
      const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers })
      // Banned users get treated as logged out — no enumeration of routes that would otherwise
      // succeed, no follow-on writes. They can still log in, but every request short-circuits here.
      if (session && (session as { user: { banned?: boolean } }).user.banned) {
        c.set('session', null)
      } else {
        c.set('session', session as HonoEnv['Variables']['session'])
      }
    } catch {
      c.set('session', null)
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

export function requireRole(...roles: Array<Role>): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const session = c.get('session')
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    if (!roles.includes(session.user.role)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  }
}

export const requireAdmin = () => requireRole('admin', 'owner')
export const requireOwner = () => requireRole('owner')
