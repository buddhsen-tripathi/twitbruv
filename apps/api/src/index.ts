import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { buildContext } from './lib/context.ts'
import { handleRateLimitError } from './lib/rate-limit.ts'
import { sessionMiddleware, type HonoEnv } from './middleware/session.ts'
import { meRoute } from './routes/me.ts'
import { usersRoute } from './routes/users.ts'
import { postsRoute } from './routes/posts.ts'
import { feedRoute } from './routes/feed.ts'
import { hashtagsRoute } from './routes/hashtags.ts'
import { searchRoute } from './routes/search.ts'
import { createMediaRoute } from './routes/media.ts'
import { articlesRoute } from './routes/articles.ts'
import { notificationsRoute } from './routes/notifications.ts'
import { analyticsRoute } from './routes/analytics.ts'
import { dmsRoute } from './routes/dms.ts'
import { adminRoute } from './routes/admin.ts'

const ctx = await buildContext()
const app = new Hono<HonoEnv>()

app.use('*', logger())
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: ctx.env.AUTH_TRUSTED_ORIGINS,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Set-Cookie'],
    maxAge: 86400,
  }),
)
app.use('*', sessionMiddleware(ctx))

app.get('/healthz', (c) => c.json({ ok: true }))
app.get('/readyz', (c) => c.json({ ok: true }))

// Mount better-auth (handles /api/auth/*).
app.on(['POST', 'GET'], '/api/auth/*', (c) => ctx.auth.handler(c.req.raw))

app.route('/api/me', meRoute)
app.route('/api/users', usersRoute)
app.route('/api/posts', postsRoute)
app.route('/api/feed', feedRoute)
app.route('/api/hashtags', hashtagsRoute)
app.route('/api/search', searchRoute)
app.route('/api/media', createMediaRoute({ s3: ctx.s3, mediaEnv: ctx.mediaEnv, boss: ctx.boss }))
app.route('/api/articles', articlesRoute)
app.route('/api/notifications', notificationsRoute)
app.route('/api/analytics', analyticsRoute)
app.route('/api/dms', dmsRoute)
app.route('/api/admin', adminRoute)

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((err, c) => {
  const rateLimited = handleRateLimitError(err, c)
  if (rateLimited) return rateLimited
  console.error(err)
  return c.json({ error: 'internal_error', message: err.message }, 500)
})

const port = ctx.env.PORT
console.log(`api listening on http://localhost:${port}`)
export default { port, fetch: app.fetch }
