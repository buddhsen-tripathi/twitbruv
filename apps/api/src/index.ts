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
import { signedGetUrl } from '@workspace/media/s3'
import { articlesRoute } from './routes/articles.ts'
import { notificationsRoute } from './routes/notifications.ts'
import { analyticsRoute } from './routes/analytics.ts'
import { dmsRoute } from './routes/dms.ts'
import { adminRoute } from './routes/admin.ts'

const ctx = await buildContext()
const app = new Hono<HonoEnv>()

app.use('*', logger())
app.use(
  '*',
  secureHeaders({
    // CORP/COEP block legitimate cross-origin loads (the web app pulling images and JSON from
    // this API). Cross-origin access control is enforced by the CORS middleware below; turning
    // these off avoids browser-level blocks on `<img src="https://api.../api/m/...">`.
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
)
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

// Signing proxy: takes a stored object key on the path, mints a 1h signed URL, and 302s the
// browser to it. We cache the redirect for a few minutes so repeated `<img>` paints don't
// thrash signing. The signed URL itself stays valid past the cache so refreshes hit the same
// underlying object cheaply.
app.get('/api/m/*', async (c) => {
  // Recover the object key by stripping every leading occurrence of the route prefix. Belt
  // and suspenders for any path-doubling that happens upstream (proxies, custom domains).
  let key = c.req.path
  while (key.startsWith('/')) key = key.slice(1)
  while (key.startsWith('api/m/')) key = key.slice('api/m/'.length)
  key = decodeURIComponent(key)
  if (!key) return c.json({ error: 'missing_key' }, 400)
  if (key.includes('..')) return c.json({ error: 'bad_key' }, 400)

  const signed = await signedGetUrl({
    s3: ctx.s3,
    bucket: ctx.mediaEnv.S3_BUCKET,
    key,
    expiresInSeconds: 60 * 60,
  })
  // Signing is microseconds; keep the redirect cache short so a bad deploy doesn't poison
  // browser caches for ages, but long enough to skip re-signing during a single page paint.
  c.header('Cache-Control', 'public, max-age=30')
  return c.redirect(signed, 302)
})
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
