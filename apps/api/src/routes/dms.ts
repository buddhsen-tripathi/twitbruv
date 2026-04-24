import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { and, desc, eq, isNull, lt, or, sql } from '@workspace/db'
import { schema } from '@workspace/db'
import { requireAuth, type HonoEnv } from '../middleware/session.ts'
import { notify } from '../lib/notify.ts'
import { dmChannel } from '../lib/pubsub.ts'

export const dmsRoute = new Hono<HonoEnv>()

dmsRoute.use('*', requireAuth())

const sendSchema = z.object({
  text: z.string().trim().min(1).max(4000).optional(),
  sharedPostId: z.string().uuid().optional(),
  sharedArticleId: z.string().uuid().optional(),
}).refine((b) => b.text || b.sharedPostId || b.sharedArticleId, {
  message: 'message must include text, a shared post, or a shared article',
})

const startSchema = z.object({
  userId: z.string().uuid(),
})

// Confirms the caller is an active member of the conversation. Returns the row, or null.
async function loadMembership(db: any, conversationId: string, userId: string) {
  const [row] = await db
    .select()
    .from(schema.conversationMembers)
    .where(
      and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, userId),
        isNull(schema.conversationMembers.leftAt),
      ),
    )
    .limit(1)
  return row ?? null
}

// Live feed of DM events for the current user. One SSE connection per browser tab; events are
// JSON payloads like `{ type: 'message', conversationId, message }` or `{ type: 'read', ... }`.
// Clients merge these into their local state. Falls back gracefully to polling when the socket
// drops (EventSource auto-reconnects).
dmsRoute.get('/stream', async (c) => {
  const session = c.get('session')!
  const { pubsub } = c.get('ctx')
  const me = session.user.id

  return streamSSE(c, async (stream) => {
    let unsubscribe: (() => Promise<void>) | null = null
    let closed = false

    stream.onAbort(async () => {
      closed = true
      if (unsubscribe) await unsubscribe().catch(() => {})
    })

    unsubscribe = await pubsub.subscribe(dmChannel(me), (payload) => {
      if (closed) return
      stream.writeSSE({ event: 'dm', data: JSON.stringify(payload) }).catch(() => {})
    })

    // Initial handshake so the client knows the stream is live.
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ at: Date.now() }) })

    // Heartbeat: keep the connection open across proxies (Cloudflare closes idle SSE after ~100s).
    while (!closed) {
      await stream.sleep(25_000)
      if (closed) break
      await stream
        .writeSSE({ event: 'ping', data: String(Date.now()) })
        .catch(() => {
          closed = true
        })
    }
  })
})

// List my conversations with last-message preview, other-member info (1:1), and unread count.
dmsRoute.get('/', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const me = session.user.id

  const myConvs = await db
    .select({
      conv: schema.conversations,
      member: schema.conversationMembers,
    })
    .from(schema.conversationMembers)
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.conversationMembers.conversationId),
    )
    .where(
      and(
        eq(schema.conversationMembers.userId, me),
        isNull(schema.conversationMembers.leftAt),
      ),
    )
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(50)

  if (myConvs.length === 0) return c.json({ conversations: [] })

  const convIds = myConvs.map((r) => r.conv.id)

  // Per-convo: other members (for 1:1 we just take the first non-me), latest message,
  // unread count (messages newer than my lastReadMessageId, authored by someone else).
  const [otherMembers, latestMessages, unreadRows] = await Promise.all([
    db
      .select({
        conversationId: schema.conversationMembers.conversationId,
        user: schema.users,
      })
      .from(schema.conversationMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.conversationMembers.userId))
      .where(
        and(
          sql`${schema.conversationMembers.conversationId} = ANY(${convIds})`,
          sql`${schema.conversationMembers.userId} <> ${me}`,
          isNull(schema.conversationMembers.leftAt),
        ),
      ),
    db.execute(sql`
      SELECT DISTINCT ON (conversation_id) conversation_id, id, sender_id, kind, text, created_at
      FROM ${schema.messages}
      WHERE conversation_id = ANY(${convIds}) AND deleted_at IS NULL
      ORDER BY conversation_id, created_at DESC
    `),
    db.execute(sql`
      SELECT m.conversation_id AS conv_id, COUNT(*)::int AS n
      FROM ${schema.messages} m
      JOIN ${schema.conversationMembers} cm
        ON cm.conversation_id = m.conversation_id AND cm.user_id = ${me}
      WHERE m.conversation_id = ANY(${convIds})
        AND m.sender_id <> ${me}
        AND m.deleted_at IS NULL
        AND (
          cm.last_read_message_id IS NULL OR
          m.created_at > (
            SELECT created_at FROM ${schema.messages} WHERE id = cm.last_read_message_id
          )
        )
      GROUP BY m.conversation_id
    `),
  ])

  const otherByConv = new Map<string, Array<typeof otherMembers[number]['user']>>()
  for (const r of otherMembers) {
    const list = otherByConv.get(r.conversationId) ?? []
    list.push(r.user)
    otherByConv.set(r.conversationId, list)
  }
  const latestByConv = new Map<string, any>()
  for (const r of latestMessages as unknown as Array<any>) {
    latestByConv.set(r.conversation_id, r)
  }
  const unreadByConv = new Map<string, number>()
  for (const r of unreadRows as unknown as Array<any>) {
    unreadByConv.set(r.conv_id, r.n)
  }

  const conversations = myConvs.map((r) => {
    const others = (otherByConv.get(r.conv.id) ?? []).map((u) => ({
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      isVerified: u.isVerified,
    }))
    const latest = latestByConv.get(r.conv.id)
    return {
      id: r.conv.id,
      kind: r.conv.kind,
      title: r.conv.title,
      createdAt: r.conv.createdAt.toISOString(),
      lastMessageAt: r.conv.lastMessageAt?.toISOString() ?? null,
      unreadCount: unreadByConv.get(r.conv.id) ?? 0,
      members: others,
      lastMessage: latest
        ? {
            id: latest.id,
            senderId: latest.sender_id,
            kind: latest.kind,
            text: latest.text,
            createdAt: new Date(latest.created_at).toISOString(),
          }
        : null,
    }
  })

  return c.json({ conversations })
})

// Total unread across all my conversations. Used by sidebar badge.
dmsRoute.get('/unread-count', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const me = session.user.id
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM ${schema.messages} m
    JOIN ${schema.conversationMembers} cm
      ON cm.conversation_id = m.conversation_id AND cm.user_id = ${me}
    WHERE m.sender_id <> ${me}
      AND m.deleted_at IS NULL
      AND cm.left_at IS NULL
      AND (
        cm.last_read_message_id IS NULL OR
        m.created_at > (SELECT created_at FROM ${schema.messages} WHERE id = cm.last_read_message_id)
      )
  `)
  const row = (result as unknown as Array<{ n: number }>)[0]
  return c.json({ count: row?.n ?? 0 })
})

// Find-or-create a 1:1 conversation. Idempotent so the UI can call this on every "Message" tap.
dmsRoute.post('/', async (c) => {
  const session = c.get('session')!
  const { db, rateLimit } = c.get('ctx')
  await rateLimit(c, 'dms.start')
  const me = session.user.id
  const { userId: other } = startSchema.parse(await c.req.json())
  if (other === me) return c.json({ error: 'self_conversation' }, 400)

  // Block check: either side blocking the other prevents new conversations.
  const [block] = await db
    .select({ id: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerId, me), eq(schema.blocks.blockedId, other)),
        and(eq(schema.blocks.blockerId, other), eq(schema.blocks.blockedId, me)),
      ),
    )
    .limit(1)
  if (block) return c.json({ error: 'blocked' }, 403)

  // Look for an existing 1:1 between exactly these two users where both are still members.
  const existing = await db.execute(sql`
    SELECT c.id
    FROM ${schema.conversations} c
    JOIN ${schema.conversationMembers} m1
      ON m1.conversation_id = c.id AND m1.user_id = ${me} AND m1.left_at IS NULL
    JOIN ${schema.conversationMembers} m2
      ON m2.conversation_id = c.id AND m2.user_id = ${other} AND m2.left_at IS NULL
    WHERE c.kind = 'dm'
    LIMIT 1
  `)
  const existingRow = (existing as unknown as Array<{ id: string }>)[0]
  if (existingRow) return c.json({ id: existingRow.id, created: false })

  const id = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.conversations)
      .values({ kind: 'dm', createdById: me })
      .returning({ id: schema.conversations.id })
    if (!created) throw new Error('failed_to_create_conversation')
    await tx.insert(schema.conversationMembers).values([
      { conversationId: created.id, userId: me, role: 'admin' },
      { conversationId: created.id, userId: other, role: 'member' },
    ])
    return created.id
  })

  return c.json({ id, created: true })
})

// Paginated message history for a conversation. Returned newest-first; clients reverse for display.
dmsRoute.get('/:id/messages', async (c) => {
  const session = c.get('session')!
  const { db } = c.get('ctx')
  const me = session.user.id
  const conversationId = c.req.param('id')
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100)
  const cursor = c.req.query('cursor')

  const membership = await loadMembership(db, conversationId, me)
  if (!membership) return c.json({ error: 'not_a_member' }, 403)

  const rows = await db
    .select({ message: schema.messages, sender: schema.users })
    .from(schema.messages)
    .innerJoin(schema.users, eq(schema.users.id, schema.messages.senderId))
    .where(
      and(
        eq(schema.messages.conversationId, conversationId),
        isNull(schema.messages.deletedAt),
        cursor ? lt(schema.messages.createdAt, new Date(cursor)) : undefined,
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(limit)

  const messages = rows.map((r) => ({
    id: r.message.id,
    conversationId: r.message.conversationId,
    senderId: r.message.senderId,
    kind: r.message.kind,
    text: r.message.text,
    sharedPostId: r.message.sharedPostId,
    sharedArticleId: r.message.sharedArticleId,
    editedAt: r.message.editedAt?.toISOString() ?? null,
    createdAt: r.message.createdAt.toISOString(),
    sender: {
      id: r.sender.id,
      handle: r.sender.handle,
      displayName: r.sender.displayName,
      avatarUrl: r.sender.avatarUrl,
      isVerified: r.sender.isVerified,
    },
  }))
  const nextCursor =
    rows.length === limit ? rows[rows.length - 1]!.message.createdAt.toISOString() : null
  return c.json({ messages, nextCursor })
})

// Send a message. Updates the conversation's lastMessageAt and notifies non-self members.
dmsRoute.post('/:id/messages', async (c) => {
  const session = c.get('session')!
  const { db, pubsub, rateLimit } = c.get('ctx')
  await rateLimit(c, 'dms.send')
  const me = session.user.id
  const conversationId = c.req.param('id')
  const body = sendSchema.parse(await c.req.json())

  const membership = await loadMembership(db, conversationId, me)
  if (!membership) return c.json({ error: 'not_a_member' }, 403)

  const kind: 'text' | 'post_share' | 'article_share' = body.sharedPostId
    ? 'post_share'
    : body.sharedArticleId
    ? 'article_share'
    : 'text'

  const message = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(schema.messages)
      .values({
        conversationId,
        senderId: me,
        kind,
        text: body.text ?? null,
        sharedPostId: body.sharedPostId ?? null,
        sharedArticleId: body.sharedArticleId ?? null,
      })
      .returning()
    if (!m) throw new Error('failed_to_send_message')
    await tx
      .update(schema.conversations)
      .set({ lastMessageAt: m.createdAt })
      .where(eq(schema.conversations.id, conversationId))

    // Auto-mark sender as read up to this message.
    await tx
      .update(schema.conversationMembers)
      .set({ lastReadMessageId: m.id })
      .where(
        and(
          eq(schema.conversationMembers.conversationId, conversationId),
          eq(schema.conversationMembers.userId, me),
        ),
      )

    // Notify everyone else still in the conversation.
    const others = await tx
      .select({ userId: schema.conversationMembers.userId })
      .from(schema.conversationMembers)
      .where(
        and(
          eq(schema.conversationMembers.conversationId, conversationId),
          isNull(schema.conversationMembers.leftAt),
          sql`${schema.conversationMembers.userId} <> ${me}`,
        ),
      )
    if (others.length > 0) {
      await notify(
        tx,
        others.map((o) => ({
          userId: o.userId,
          actorId: me,
          kind: 'dm' as const,
          entityType: 'conversation' as const,
          entityId: conversationId,
        })),
      )
    }
    return { message: m, otherUserIds: others.map((o) => o.userId) }
  })

  const payload = {
    id: message.message.id,
    conversationId: message.message.conversationId,
    senderId: message.message.senderId,
    kind: message.message.kind,
    text: message.message.text,
    sharedPostId: message.message.sharedPostId,
    sharedArticleId: message.message.sharedArticleId,
    editedAt: message.message.editedAt?.toISOString() ?? null,
    createdAt: message.message.createdAt.toISOString(),
  }

  // Fan-out: every member (including me, so my other tabs stay in sync) gets the event.
  const recipients = [...message.otherUserIds, me]
  await Promise.all(
    recipients.map((userId) =>
      pubsub.publish(dmChannel(userId), { type: 'message', conversationId, message: payload }),
    ),
  )

  return c.json({ message: payload })
})

// Mark all messages up to and including a given message as read for the current user.
// If no messageId is given, advance to the latest message in the conversation.
dmsRoute.post('/:id/read', async (c) => {
  const session = c.get('session')!
  const { db, pubsub } = c.get('ctx')
  const me = session.user.id
  const conversationId = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { messageId?: string }

  const membership = await loadMembership(db, conversationId, me)
  if (!membership) return c.json({ error: 'not_a_member' }, 403)

  let targetId = body.messageId ?? null
  if (!targetId) {
    const [latest] = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.deletedAt),
        ),
      )
      .orderBy(desc(schema.messages.createdAt))
      .limit(1)
    targetId = latest?.id ?? null
  }

  if (!targetId) return c.json({ ok: true })

  await db
    .update(schema.conversationMembers)
    .set({ lastReadMessageId: targetId })
    .where(
      and(
        eq(schema.conversationMembers.conversationId, conversationId),
        eq(schema.conversationMembers.userId, me),
      ),
    )

  // Publish to my own channel so other tabs (and the sidebar unread badge) refresh.
  await pubsub.publish(dmChannel(me), {
    type: 'read',
    conversationId,
    messageId: targetId,
  })

  return c.json({ ok: true })
})
