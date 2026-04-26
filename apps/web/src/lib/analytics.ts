import { API_URL } from "./env"
import { readCsrfToken } from "./api"

interface ImpressionEvent {
  kind: "impression"
  subjectType: "post" | "article" | "profile"
  subjectId: string
}

// Dedupe within a single tab-session so scrolling a post back into view doesn't re-count.
const seen = new Set<string>()
const key = (e: ImpressionEvent) => `${e.subjectType}:${e.subjectId}`

const buffer: Array<ImpressionEvent> = []
let flushTimer: number | null = null

function schedule() {
  if (typeof window === "undefined") return
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(flush, 5000)
}

async function flush() {
  if (typeof window === "undefined") return
  flushTimer = null
  if (buffer.length === 0) return
  const events = buffer.splice(0, buffer.length)
  const csrf = readCsrfToken()
  try {
    await fetch(`${API_URL}/api/analytics/ingest`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: JSON.stringify({ events }),
      keepalive: true,
    })
  } catch {
    // best-effort; drop on failure
  }
}

export function recordImpression(event: ImpressionEvent) {
  if (typeof window === "undefined") return
  const k = key(event)
  if (seen.has(k)) return
  seen.add(k)
  buffer.push(event)
  schedule()
}

// Flush on pagehide / beforeunload via the same keepalive fetch path. We can't use
// navigator.sendBeacon — it doesn't support custom headers and CSRF requires X-CSRF-Token.
// keepalive fetch survives page unload up to ~64KB (same budget as sendBeacon).
if (typeof window !== "undefined") {
  const onUnload = () => {
    void flush()
  }
  window.addEventListener("pagehide", onUnload)
  window.addEventListener("beforeunload", onUnload)
}
