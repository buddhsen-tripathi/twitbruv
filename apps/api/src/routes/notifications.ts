import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, lt, sql } from '@workspace/db'
import { schema } from '@workspace/db'
import { requireAuth, type HonoEnv } from '../middleware/session.ts'

export const notificationsRoute = new Hono<HonoEnv>()

notificationsRoute.use('*', requireAuth())

notificationsRoute.get('/unread-count', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.userId, session.user.id), isNull(schema.notifications.readAt)),
    )
  return c.json({ count: row?.n ?? 0 })
})

notificationsRoute.get('/', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const limit = Math.min(Number(c.req.query('limit') ?? 40), 100)
  const cursor = c.req.query('cursor')
  const unreadOnly = c.req.query('unread') === '1'

  const rows = await db
    .select({
      n: schema.notifications,
      actor: schema.users,
    })
    .from(schema.notifications)
    .leftJoin(schema.users, eq(schema.users.id, schema.notifications.actorId))
    .where(
      and(
        eq(schema.notifications.userId, session.user.id),
        unreadOnly ? isNull(schema.notifications.readAt) : undefined,
        cursor ? lt(schema.notifications.createdAt, new Date(cursor)) : undefined,
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)

  const items = rows.map((r) => ({
    id: r.n.id,
    kind: r.n.kind,
    createdAt: r.n.createdAt.toISOString(),
    readAt: r.n.readAt?.toISOString() ?? null,
    entityType: r.n.entityType,
    entityId: r.n.entityId,
    actor: r.actor
      ? {
          id: r.actor.id,
          handle: r.actor.handle,
          displayName: r.actor.displayName,
          avatarUrl: r.actor.avatarUrl,
          isVerified: r.actor.isVerified,
        }
      : null,
  }))
  const nextCursor = rows.length === limit ? rows[rows.length - 1]!.n.createdAt.toISOString() : null
  return c.json({ notifications: items, nextCursor })
})

notificationsRoute.post('/mark-read', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const body = (await c.req.json().catch(() => ({}))) as {
    ids?: Array<string>
    all?: boolean
  }

  if (body.all === true) {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, session.user.id),
          isNull(schema.notifications.readAt),
        ),
      )
    return c.json({ ok: true })
  }

  if (body.ids && body.ids.length > 0) {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, session.user.id),
          inArray(schema.notifications.id, body.ids),
        ),
      )
    return c.json({ ok: true })
  }

  return c.json({ error: 'nothing_to_do' }, 400)
})
