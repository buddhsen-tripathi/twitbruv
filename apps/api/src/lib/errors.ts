import type { Context } from 'hono'
import { ZodError } from 'zod'
import { handleRateLimitError } from '@workspace/rate-limit'
import type { HonoEnv } from '../middleware/session.ts'

// Render an error without echoing internal `err.message` to the client. The full error and
// stack are logged server-side tagged with the request-id so support can correlate.
export function renderError(err: unknown, c: Context<HonoEnv>) {
  const rl = handleRateLimitError(err, c)
  if (rl) return rl

  const requestId = c.get('requestId')

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path, code: i.code }))
    return c.json({ error: 'bad_request', issues, requestId }, 400)
  }

  c.get('ctx').log.error(
    {
      err: err instanceof Error ? err.stack ?? err.message : err,
      path: c.req.path,
      requestId,
    },
    'unhandled_error',
  )
  return c.json({ error: 'internal_error', requestId }, 500)
}
