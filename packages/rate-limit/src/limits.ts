import type { FixedWindowLimit } from './index.ts'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Bucket caps. Edit these directly to tune; review surfaces every change.
export const BUCKETS = {
  'posts.create': [
    { windowMs: MIN, max: 5 },
    { windowMs: HOUR, max: 30 },
    { windowMs: DAY, max: 300 },
  ],
  'posts.reply': [
    { windowMs: MIN, max: 20 },
    { windowMs: DAY, max: 1000 },
  ],
  'posts.like': [
    { windowMs: MIN, max: 60 },
    { windowMs: DAY, max: 1000 },
  ],
  'posts.bookmark': [{ windowMs: DAY, max: 1000 }],
  'posts.repost': [
    { windowMs: MIN, max: 30 },
    { windowMs: DAY, max: 500 },
  ],
  'users.follow': [{ windowMs: DAY, max: 400 }],
  'media.upload': [{ windowMs: HOUR, max: 30 }],
  // Analytics pings are batched client-side. A generous per-minute cap catches abuse without
  // hurting legitimate scrollers.
  'analytics.ingest': [{ windowMs: MIN, max: 60 }],
  'dms.send': [
    { windowMs: MIN, max: 30 },
    { windowMs: DAY, max: 1000 },
  ],
  'dms.start': [{ windowMs: HOUR, max: 30 }],
  // Typing pings are debounced client-side to ~one per 3s; this cap is generous.
  'dms.typing': [{ windowMs: MIN, max: 60 }],
  // Reports are extremely abuse-prone (mass-report harassment) — keep the cap tight.
  'reports.create': [
    { windowMs: HOUR, max: 10 },
    { windowMs: DAY, max: 30 },
  ],
  'dms.react': [{ windowMs: MIN, max: 60 }],
  // Account creation. Tight per-IP cap to make spam signups expensive without breaking
  // legitimate household/coworker shared-IP signups.
  'auth.signup': [
    { windowMs: HOUR, max: 5 },
    { windowMs: DAY, max: 20 },
  ],
  // Login attempts — guard against credential stuffing / brute force.
  'auth.signin': [
    { windowMs: MIN, max: 10 },
    { windowMs: HOUR, max: 60 },
  ],
  // Magic-link send. IP-keyed (no session yet) — closes email-bombing of a target inbox.
  'auth.magic-link': [{ windowMs: HOUR, max: 10 }],
  // Password reset request — same email-bomb vector as magic-link.
  'auth.password-reset': [{ windowMs: HOUR, max: 10 }],
  // 2FA verification — guards TOTP / backup-code brute force.
  'auth.2fa-verify': [
    { windowMs: MIN, max: 10 },
    { windowMs: HOUR, max: 60 },
  ],
  // Verification email resend — prevents using our SMTP relay to bomb a target inbox.
  'auth.email-verify-resend': [{ windowMs: HOUR, max: 5 }],
  // OAuth callback — IP-keyed cap against bot-driven account creation via OAuth providers.
  'auth.oauth-callback': [{ windowMs: MIN, max: 60 }],
  'users.block': [{ windowMs: DAY, max: 100 }],
  'users.mute': [{ windowMs: DAY, max: 100 }],
  'posts.edit': [
    { windowMs: MIN, max: 10 },
    { windowMs: DAY, max: 200 },
  ],
  'articles.write': [
    { windowMs: HOUR, max: 20 },
    { windowMs: DAY, max: 100 },
  ],
  // Read-side caps. These are loose by design — legitimate users on a hot feed can scroll
  // fast — but they cap the upside for a misbehaving client / scraper / runaway loop. Page-0
  // hits are cached, so the per-minute cap mostly bounds back-end work for cursor-paginated
  // requests and uncached endpoints (search, thread).
  'reads.feed': [{ windowMs: MIN, max: 120 }],
  'reads.profile': [{ windowMs: MIN, max: 240 }],
  // Search hits two table scans (users ilike + posts FTS); cap tighter than feed/profile.
  'reads.search': [{ windowMs: MIN, max: 30 }],
  // Thread expands ancestors + replies + viewer flags; modest cap.
  'reads.thread': [{ windowMs: MIN, max: 120 }],
  // Notification polling — frontend may poll unread-count every few seconds. Cache makes
  // this ~free, but keep a hard ceiling against runaway tabs / misbehaving SDKs.
  'reads.notifications': [{ windowMs: MIN, max: 240 }],
} satisfies Record<string, Array<FixedWindowLimit>>

export type BucketName = keyof typeof BUCKETS
