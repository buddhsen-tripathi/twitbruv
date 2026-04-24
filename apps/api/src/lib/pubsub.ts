import Redis from 'ioredis'

export type PubSub = ReturnType<typeof createPubSub>

type Listener = (payload: unknown) => void

/**
 * Lightweight Redis pub/sub wrapper. One shared publisher connection + one shared subscriber
 * connection per process, multiplexed across SSE clients by channel. ioredis forbids issuing
 * regular commands on a connection that has entered subscribe mode, which is why we keep two
 * sockets open.
 */
export function createPubSub(url: string) {
  const publisher = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  })
  const subscriber = new Redis(url, {
    lazyConnect: false,
    // In subscribe mode ioredis never returns replies to commands, so retrying them is
    // meaningless — but we still want it to reconnect automatically on disconnect.
    maxRetriesPerRequest: null,
  })

  publisher.on('error', (err) => console.error('pubsub.publisher:', err.message))
  subscriber.on('error', (err) => console.error('pubsub.subscriber:', err.message))

  const listeners = new Map<string, Set<Listener>>()

  subscriber.on('message', (channel, raw) => {
    const set = listeners.get(channel)
    if (!set || set.size === 0) return
    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    for (const cb of set) {
      try {
        cb(payload)
      } catch {
        /* one bad listener shouldn't kill the fan-out */
      }
    }
  })

  async function publish(channel: string, payload: unknown) {
    try {
      await publisher.publish(channel, JSON.stringify(payload))
    } catch {
      // publish failures are best-effort: clients will reconcile via polling fallback.
    }
  }

  async function subscribe(channel: string, cb: Listener) {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
      await subscriber.subscribe(channel)
    }
    set.add(cb)
    return async function unsubscribe() {
      const current = listeners.get(channel)
      if (!current) return
      current.delete(cb)
      if (current.size === 0) {
        listeners.delete(channel)
        try {
          await subscriber.unsubscribe(channel)
        } catch {
          /* reconnect loop will converge */
        }
      }
    }
  }

  return { publish, subscribe }
}

export const dmChannel = (userId: string) => `dm:user:${userId}`
