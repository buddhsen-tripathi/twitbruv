import { Hono } from 'hono'
import { and, desc, eq, isNull, lt } from '@workspace/db'
import { schema } from '@workspace/db'
import type { HonoEnv } from '../middleware/session.ts'
import { toPostDto } from '../lib/post-dto.ts'
import { loadViewerFlags } from '../lib/viewer-flags.ts'
import { loadPostMedia } from '../lib/post-media.ts'
import { loadArticleCards } from '../lib/article-cards.ts'
import { loadRepostTargets } from '../lib/repost-targets.ts'
import { loadQuoteTargets } from '../lib/quote-targets.ts'

export const hashtagsRoute = new Hono<HonoEnv>()

hashtagsRoute.get('/:tag/posts', async (c) => {
  const { db, mediaEnv } = c.get('ctx')
  const viewerId = c.get('session')?.user.id
  const tag = c.req.param('tag').toLowerCase().replace(/^#/, '')
  const limit = Math.min(Number(c.req.query('limit') ?? 40), 100)
  const cursor = c.req.query('cursor')

  const [hashtag] = await db
    .select()
    .from(schema.hashtags)
    .where(eq(schema.hashtags.tag, tag))
    .limit(1)
  if (!hashtag) return c.json({ posts: [], nextCursor: null, tag })

  const rows = await db
    .select({ post: schema.posts, author: schema.users })
    .from(schema.postHashtags)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.postHashtags.postId))
    .innerJoin(schema.users, eq(schema.users.id, schema.posts.authorId))
    .where(
      and(
        eq(schema.postHashtags.hashtagId, hashtag.id),
        isNull(schema.posts.deletedAt),
        eq(schema.posts.visibility, 'public'),
        cursor ? lt(schema.posts.createdAt, new Date(cursor)) : undefined,
      ),
    )
    .orderBy(desc(schema.posts.createdAt))
    .limit(limit)

  const ids = rows.map((r) => r.post.id)
  const [flags, mediaMap, articleMap, repostMap, quoteMap] = await Promise.all([
    loadViewerFlags(db, viewerId, ids),
    loadPostMedia(db, ids),
    loadArticleCards(db, ids),
    loadRepostTargets({
      db,
      viewerId,
      env: mediaEnv,
      repostRows: rows.map((r) => ({ id: r.post.id, repostOfId: r.post.repostOfId })),
    }),
    loadQuoteTargets({
      db,
      viewerId,
      env: mediaEnv,
      quoteRows: rows.map((r) => ({ id: r.post.id, quoteOfId: r.post.quoteOfId })),
    }),
  ])
  const posts = rows.map((r) =>
    toPostDto(
      r.post,
      r.author,
      flags.get(r.post.id),
      mediaMap.get(r.post.id),
      mediaEnv,
      articleMap.get(r.post.id),
      repostMap.get(r.post.id),
      quoteMap.get(r.post.id),
    ),
  )
  const nextCursor = posts.length === limit ? posts[posts.length - 1]!.createdAt : null
  return c.json({ tag, posts, nextCursor })
})
