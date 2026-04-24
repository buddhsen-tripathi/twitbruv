import { schema } from '@workspace/db'

export type NotificationKind =
  | 'like'
  | 'repost'
  | 'reply'
  | 'mention'
  | 'follow'
  | 'dm'
  | 'article_reply'
  | 'quote'

export interface NotifyInput {
  userId: string
  actorId: string
  kind: NotificationKind
  entityType?: 'post' | 'article' | 'conversation'
  entityId?: string
}

/**
 * Insert one or more notification rows in a single statement. Callers should invoke this
 * within the same transaction as the causing write so notifications can't get orphaned.
 * Self-notifications (actor == recipient) are dropped before insert.
 */
export async function notify(tx: any, inputs: Array<NotifyInput>) {
  const rows = inputs
    .filter((n) => n.actorId !== n.userId)
    .map((n) => ({
      userId: n.userId,
      actorId: n.actorId,
      kind: n.kind,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    }))
  if (rows.length === 0) return
  await tx.insert(schema.notifications).values(rows)
}
