import { index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { media } from './media.ts'
import { posts } from './posts.ts'
import { articles } from './articles.ts'
import {
  conversationKindEnum,
  convRoleEnum,
  conversationRequestStateEnum,
  messageKindEnum,
} from './enums.ts'

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: conversationKindEnum('kind').notNull(),
    title: text('title'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_last_message_idx').on(t.lastMessageAt)],
)

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: convRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
    mutedUntil: timestamp('muted_until', { withTimezone: true }),
    lastReadMessageId: uuid('last_read_message_id'),
    requestState: conversationRequestStateEnum('request_state').notNull().default('none'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('conversation_members_user_idx').on(t.userId, t.leftAt),
  ],
)

// Messages: declare non-partitioned at the Drizzle level; convert to RANGE-partitioned
// by createdAt in a manual SQL migration at scale. The logical shape below holds either way.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: messageKindEnum('kind').notNull().default('text'),
    text: text('text'),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    sharedPostId: uuid('shared_post_id').references(() => posts.id, { onDelete: 'set null' }),
    sharedArticleId: uuid('shared_article_id').references(() => articles.id, { onDelete: 'set null' }),
    replyToMessageId: uuid('reply_to_message_id'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)],
)

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
)

// Shareable invite links for group conversations. The token is opaque; expiresAt and maxUses
// are both nullable so an invite can be perpetual / unlimited if the admin chooses.
export const conversationInvites = pgTable(
  'conversation_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversation_invites_token_uq').on(t.token),
    index('conversation_invites_conversation_idx').on(t.conversationId),
  ],
)
