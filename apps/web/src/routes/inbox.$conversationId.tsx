import { Link, createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconPaperclip, IconX } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { api } from "../lib/api"
import { authClient } from "../lib/auth"
import { Avatar } from "../components/avatar"
import { ImageLightbox } from "../components/image-lightbox"
import { subscribeToDmStream } from "../lib/dm-stream"
import {
  MAX_UPLOAD_BYTES,
  compressImage,
  pickVariantUrl,
  uploadImage,
} from "../lib/media"
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react"
import type { DmMessage, PostMedia } from "../lib/api"

export const Route = createFileRoute("/inbox/$conversationId")({
  component: Thread,
})

const MAX_INPUT_BYTES = 15 * 1024 * 1024 // mirrors API/api/media intent ceiling pre-compress

interface Pending {
  id: string
  file: File
  previewUrl: string
}

function Thread() {
  const { conversationId } = Route.useParams()
  const { data: session } = authClient.useSession()
  const me = session?.user.id ?? null
  const [messages, setMessages] = useState<Array<DmMessage>>([])
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState<Pending | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSeenIdRef = useRef<string | null>(null)
  const initialScrolledRef = useRef(false)

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
        if (!opts.silent)
          setError(e instanceof Error ? e.message : "failed to load")
      }
    },
    [conversationId]
  )

  useEffect(() => {
    setMessages([])
    setError(null)
    initialScrolledRef.current = false
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

  // First load (or conversation switch): force-scroll to bottom and re-scroll after a beat so
  // async image layout doesn't leave us stranded above the latest message. After that, only
  // auto-scroll on new arrivals if the user is already near the bottom.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || messages.length === 0) return
    const stickToBottom = () => {
      el.scrollTop = el.scrollHeight
    }
    if (!initialScrolledRef.current) {
      initialScrolledRef.current = true
      stickToBottom()
      // Catch image / font layout shifts that happen after the initial paint.
      const t1 = setTimeout(stickToBottom, 50)
      const t2 = setTimeout(stickToBottom, 250)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) stickToBottom()
  }, [messages])

  // Mark-read: bump the high-water-mark whenever the latest visible message changes.
  useEffect(() => {
    if (messages.length === 0) return
    const latestId = messages[messages.length - 1].id
    if (latestId === lastSeenIdRef.current) return
    lastSeenIdRef.current = latestId
    api.dmMarkRead(conversationId, latestId).catch(() => {})
  }, [messages, conversationId])

  // Auto-grow the composer textarea as the user types — capped so a wall of text doesn't
  // swallow the message list.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  // Revoke any object URL we created when its preview goes away.
  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl)
    },
    [pending]
  )

  const peer = useMemo(() => {
    if (!me) return null
    const fromOther = messages.find(
      (m) => m.sender && m.senderId !== me
    )?.sender
    return fromOther ?? null
  }, [messages, me])

  // Group consecutive messages from the same sender, splitting whenever the day changes so we
  // can drop a sticky day-separator between them.
  const groups = useMemo(() => buildGroups(messages), [messages])

  function attachFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("only images can be attached")
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError(
        `image too large (max ${(MAX_INPUT_BYTES / 1024 / 1024).toFixed(0)}MB)`
      )
      return
    }
    if (pending) URL.revokeObjectURL(pending.previewUrl)
    setPending({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    })
    setError(null)
  }

  function clearPending() {
    if (pending) URL.revokeObjectURL(pending.previewUrl)
    setPending(null)
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) attachFile(file)
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = ""
  }

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if ((!text && !pending) || sending) return
    setSending(true)
    setError(null)
    try {
      let mediaId: string | undefined
      if (pending) {
        const compressed = await compressImage(pending.file)
        if (compressed.size > MAX_UPLOAD_BYTES) {
          throw new Error(
            `image too large after compression (${(compressed.size / 1024 / 1024).toFixed(1)}MB > ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`
          )
        }
        const uploaded = await uploadImage(compressed)
        mediaId = uploaded.id
      }
      const { message } = await api.dmSend(conversationId, {
        text: text || undefined,
        mediaId,
      })
      setDraft("")
      clearPending()
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message]
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to send")
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-sm">
        <Link
          to="/inbox"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Inbox
        </Link>
        <div className="ml-2 flex min-w-0 items-center gap-2">
          {peer && (
            <Avatar
              initial={(peer.displayName || peer.handle || "?")
                .slice(0, 1)
                .toUpperCase()}
              src={peer.avatarUrl}
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {peer?.displayName || `@${peer?.handle}`}
            </div>
            {peer?.handle && (
              <Link
                to="/$handle"
                params={{ handle: peer.handle }}
                className="truncate text-xs text-muted-foreground hover:underline"
              >
                @{peer.handle}
              </Link>
            )}
          </div>
        </div>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        {error && (
          <p className="mx-auto mb-3 max-w-prose rounded-md border border-destructive/40 bg-destructive/5 p-2 text-center text-xs text-destructive">
            {error}
          </p>
        )}
        {messages.length === 0 && !error && (
          <p className="mt-12 text-center text-sm text-muted-foreground">
            Say hi 👋
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <GroupBlock key={group.key} group={group} me={me} />
          ))}
        </ul>
      </div>

      {pending && (
        <div className="border-t border-border px-3 pt-2">
          <div className="relative inline-block">
            <img
              src={pending.previewUrl}
              alt="attachment preview"
              className="h-20 w-20 rounded-md border border-border object-cover"
            />
            <button
              type="button"
              onClick={clearPending}
              aria-label="remove attachment"
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-muted"
            >
              <IconX size={12} stroke={2} />
            </button>
          </div>
        </div>
      )}

      <form
        onSubmit={send}
        className="flex items-end gap-2 border-t border-border px-3 py-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />
        <Button
          type="button"
          variant="ghost"
          aria-label="attach image"
          disabled={sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconPaperclip size={18} stroke={1.75} />
        </Button>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={pending ? "Add a caption…" : "Message"}
          rows={1}
          disabled={sending}
          onKeyDown={onKeyDown}
          className="flex-1 resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-60"
        />
        <Button
          type="submit"
          disabled={sending || (draft.trim().length === 0 && !pending)}
        >
          {sending ? "…" : "Send"}
        </Button>
      </form>
    </main>
  )
}

interface MessageGroup {
  key: string
  isMine: boolean
  sender: DmMessage["sender"]
  messages: Array<DmMessage>
  daySeparator: string | null
}

function buildGroups(messages: Array<DmMessage>): Array<MessageGroup> {
  const out: Array<MessageGroup> = []
  let lastDay: string | null = null
  for (const m of messages) {
    const day = new Date(m.createdAt).toDateString()
    const last = out.at(-1)
    if (last && last.messages[0].senderId === m.senderId && day === lastDay) {
      last.messages.push(m)
      continue
    }
    out.push({
      key: m.id,
      isMine: false, // overwritten by GroupBlock — easier than threading `me` here
      sender: m.sender,
      messages: [m],
      daySeparator: day === lastDay ? null : formatDay(new Date(m.createdAt)),
    })
    lastDay = day
  }
  return out
}

function GroupBlock({ group, me }: { group: MessageGroup; me: string | null }) {
  const isMine = group.messages[0].senderId === me
  return (
    <>
      {group.daySeparator && (
        <li className="my-3 text-center text-[11px] tracking-wider text-muted-foreground uppercase">
          {group.daySeparator}
        </li>
      )}
      <li
        className={`flex items-end gap-2 ${isMine ? "justify-end" : "justify-start"}`}
      >
        {!isMine && (
          <div className="w-8 shrink-0">
            {group.sender && (
              <Avatar
                initial={(
                  group.sender.displayName ||
                  group.sender.handle ||
                  "?"
                )
                  .slice(0, 1)
                  .toUpperCase()}
                src={group.sender.avatarUrl}
              />
            )}
          </div>
        )}
        <div
          className={`flex max-w-[75%] flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}
        >
          {group.messages.map((m, i) => {
            const isFirst = i === 0
            const isLast = i === group.messages.length - 1
            return (
              <Bubble
                key={m.id}
                message={m}
                isMine={isMine}
                isFirst={isFirst}
                isLast={isLast}
              />
            )
          })}
        </div>
      </li>
    </>
  )
}

function Bubble({
  message,
  isMine,
  isFirst,
  isLast,
}: {
  message: DmMessage
  isMine: boolean
  isFirst: boolean
  isLast: boolean
}) {
  // Tighten corners on the side where bubbles stack so a chain reads as one block.
  const corners = isMine
    ? `${isFirst ? "rounded-tr-2xl" : "rounded-tr-md"} ${isLast ? "rounded-br-2xl" : "rounded-br-md"} rounded-l-2xl`
    : `${isFirst ? "rounded-tl-2xl" : "rounded-tl-md"} ${isLast ? "rounded-bl-2xl" : "rounded-bl-md"} rounded-r-2xl`
  const bg = isMine
    ? "bg-primary text-primary-foreground"
    : "bg-muted text-foreground"
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
  return (
    <div
      className={`group max-w-full ${corners} ${bg} px-3 py-2 text-sm leading-relaxed`}
      title={new Date(message.createdAt).toLocaleString()}
    >
      {message.media && <MessageImage media={message.media} />}
      {message.text && (
        <p className="break-words whitespace-pre-wrap">{message.text}</p>
      )}
      {!message.media && !message.text && (
        <em className="opacity-70">[unsupported]</em>
      )}
      {isLast && (
        <div
          className={`mt-1 text-[10px] tabular-nums opacity-60 ${
            isMine ? "text-right" : ""
          }`}
        >
          {time}
        </div>
      )}
    </div>
  )
}

function MessageImage({ media }: { media: PostMedia }) {
  const url = pickVariantUrl(media, "medium")
  const full = pickVariantUrl(media, "large") ?? url
  if (!url) {
    return (
      <div className="my-1 flex h-32 w-48 items-center justify-center rounded-md bg-background/30 text-xs">
        {media.processingState === "failed" ? "media failed" : "processing…"}
      </div>
    )
  }
  return (
    <ImageLightbox
      images={full ? [{ src: full, alt: media.altText ?? "" }] : []}
      disabled={!full}
      className="block"
    >
      <img
        src={url}
        alt={media.altText ?? ""}
        loading="lazy"
        className="my-1 max-h-80 max-w-full rounded-md object-cover"
        style={
          media.width && media.height
            ? { aspectRatio: `${media.width} / ${media.height}` }
            : undefined
        }
      />
    </ImageLightbox>
  )
}

function formatDay(d: Date): string {
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
