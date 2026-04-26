import { createHmac, timingSafeEqual } from 'node:crypto'

export const CSRF_COOKIE_NAME = 'twotter_csrf'
export const CSRF_HEADER_NAME = 'X-CSRF-Token'

// HMAC of the session id, so the token is stable for the session's lifetime and rotates
// automatically when the user re-logs in. No server-side storage; verifying just recomputes.
export function csrfTokenForSession(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url')
}

// Constant-time compare. Bails on length mismatch first because timingSafeEqual throws on
// unequal-length buffers and we don't want that path to leak via exception timing either.
export function csrfMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}
