import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { api, type DmMessage } from "../lib/api"
import { authClient } from "../lib/auth"
import { Avatar } from "../components/avatar"
import { subscribeToDmStream } from "../lib/dm-stream"

export const Route = createFileRoute("/inbox/$conversationId")({ component: Thread })

function Thread() {
  const { conversationId } = Route.useParams()
  const { data: session } = authClient.useSession()
  const me = session?.user.id ?? null
  const [messages, setMessages] = useState<Array<DmMessage>>([])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastSeenIdRef = useRef<string | null>(null)

  // Initial hydrate from REST; subsequent updates come through the SSE stream. We still keep a
  // slow 30s poll as a belt-and-suspenders guard if the socket silently stalls.
  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      try {
        const { messages: fresh } = await api.dmMessages(conversationId)
        const ordered = [...fresh].reverse()
        setMessages((prev) => {
          if (prev.length === 0) return ordered
          const seen = new Set(prev.map((m) => m.id))
          const additions = ordered.filter((m) => !seen.has(m.id))
          if (additions.length === 0) return prev
          return [...prev, ...additions]
        })
      } catch (e) {
        if (!opts.silent) setError(e instanceof Error ? e.message : "failed to load")
      }
    },
    [conversationId],
  )

  useEffect(() => {
    setMessages([])
    setError(null)
    load()
    const iv = setInterval(() => load({ silent: true }), 30_000)
    return () => clearInterval(iv)
  }, [load])

  useEffect(() => {
    return subscribeToDmStream((event) => {
      if (event.type !== "message") return
      if (event.conversationId !== conversationId) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === event.message.id)) return prev
        return [...prev, event.message]
      })
    })
  }, [conversationId])

  // Auto-scroll to the latest message whenever one arrives.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Mark-read: bump the high-water-mark whenever the latest visible message changes.
  useEffect(() => {
    if (messages.length === 0) return
    const latestId = messages[messages.length - 1]!.id
    if (latestId === lastSeenIdRef.current) return
    lastSeenIdRef.current = latestId
    api.dmMarkRead(conversationId, latestId).catch(() => {})
  }, [messages, conversationId])

  const peer = useMemo(() => {
    if (!me) return null
    const fromOther = messages.find((m) => m.sender && m.senderId !== me)?.sender
    return fromOther ?? null
  }, [messages, me])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const { message } = await api.dmSend(conversationId, { text })
      setDraft("")
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to send")
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link to="/inbox" className="text-xs text-muted-foreground hover:underline">
          ← Inbox
        </Link>
        <div className="ml-2 flex min-w-0 items-center gap-2">
          {peer && (
            <Avatar
              initial={(peer.displayName || peer.handle || "?").slice(0, 1).toUpperCase()}
              src={peer.avatarUrl}
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {peer?.displayName || (peer?.handle ? `@${peer.handle}` : "Conversation")}
            </div>
            {peer?.handle && (
              <Link
                to="/$handle"
                params={{ handle: peer.handle }}
                className="text-xs text-muted-foreground hover:underline"
              >
                @{peer.handle}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-3">
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {messages.length === 0 && !error && (
          <p className="p-4 text-sm text-muted-foreground">Say hello.</p>
        )}
        <ul className="space-y-2">
          {messages.map((m, i) => {
            const isMine = m.senderId === me
            const prev = messages[i - 1]
            const showAvatar = !isMine && (!prev || prev.senderId !== m.senderId)
            return (
              <li
                key={m.id}
                className={`flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}
              >
                {!isMine && (
                  <div className="w-8 shrink-0">
                    {showAvatar && m.sender && (
                      <Avatar
                        initial={(m.sender.displayName || m.sender.handle || "?")
                          .slice(0, 1)
                          .toUpperCase()}
                        src={m.sender.avatarUrl}
                      />
                    )}
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isMine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                  title={new Date(m.createdAt).toLocaleString()}
                >
                  {m.text ?? <em className="opacity-70">[unsupported]</em>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <form
        onSubmit={send}
        className="flex items-end gap-2 border-t border-border px-3 py-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send(e as unknown as React.FormEvent)
            }
          }}
          className="flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button type="submit" size="sm" disabled={sending || draft.trim().length === 0}>
          {sending ? "…" : "Send"}
        </Button>
      </form>
    </main>
  )
}
