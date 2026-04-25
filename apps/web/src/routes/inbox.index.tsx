import { Link, createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { IconPencilPlus } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { api } from "../lib/api"
import { Avatar } from "../components/avatar"
import { subscribeToDmStream } from "../lib/dm-stream"
import type { DmConversation, DmMember } from "../lib/api"

export const Route = createFileRoute("/inbox/")({ component: InboxList })

function InboxList() {
  const [conversations, setConversations] = useState<Array<DmConversation> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const { conversations } = await api.dmConversations()
        if (!cancel) setConversations(conversations)
      } catch (e) {
        if (!cancel) setError(e instanceof Error ? e.message : "failed to load")
      }
    }
    load()
    // Refresh the whole list on any DM event. The list query is cheap, and this keeps the
    // unread counts + last-message previews in lock-step with the stream.
    const unsubscribe = subscribeToDmStream(() => load())
    // Slow reconcile as a fallback if the stream stalls silently.
    const iv = setInterval(load, 120_000)
    return () => {
      cancel = true
      clearInterval(iv)
      unsubscribe()
    }
  }, [])

  return (
    <main>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-sm">
        <h1 className="text-base font-semibold">Messages</h1>
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/inbox/new" />}
        >
          <IconPencilPlus size={14} stroke={1.75} />
          New
        </Button>
      </header>

      {error && <p className="p-4 text-sm text-destructive">{error}</p>}
      {!conversations && !error && (
        <p className="p-4 text-sm text-muted-foreground">loading…</p>
      )}
      {conversations && conversations.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">
          No conversations yet. Open someone's profile and tap Message to say hi.
        </p>
      )}
      {conversations && conversations.length > 0 && (
        <ul>
          {conversations.map((c) => (
            <ConversationRow key={c.id} conversation={c} />
          ))}
        </ul>
      )}
    </main>
  )
}

function ConversationRow({ conversation }: { conversation: DmConversation }) {
  const isGroup = conversation.kind === "group"
  const title = conversation.title || defaultTitle(conversation)
  const preview = conversation.lastMessage?.text ?? previewForKind(conversation.lastMessage?.kind)
  const ts = conversation.lastMessageAt
    ? new Date(conversation.lastMessageAt).toLocaleString()
    : ""

  return (
    <li>
      <Link
        to="/inbox/$conversationId"
        params={{ conversationId: conversation.id }}
        className="flex items-start gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-muted/20"
      >
        <ConversationAvatar conversation={conversation} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            <time className="shrink-0 text-xs text-muted-foreground">{ts}</time>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {isGroup && `${conversation.members.length + 1} members · `}
            {preview ?? "No messages yet."}
          </p>
        </div>
        {conversation.unreadCount > 0 && (
          <span className="ml-2 self-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {conversation.unreadCount}
          </span>
        )}
      </Link>
    </li>
  )
}

function ConversationAvatar({ conversation }: { conversation: DmConversation }) {
  if (conversation.kind === "group") {
    // Stack the first two member avatars in a 2x2-ish overlap so groups read at a glance.
    const a = conversation.members.at(0)
    const b = conversation.members.at(1)
    return (
      <div className="relative size-10 shrink-0">
        {a && (
          <Avatar
            initial={initialFor(a)}
            src={a.avatarUrl}
            className="absolute left-0 top-0 size-7 ring-2 ring-background"
          />
        )}
        {b && (
          <Avatar
            initial={initialFor(b)}
            src={b.avatarUrl}
            className="absolute bottom-0 right-0 size-7 ring-2 ring-background"
          />
        )}
      </div>
    )
  }
  const other = conversation.members.at(0)
  return (
    <Avatar
      initial={other ? initialFor(other) : "?"}
      src={other?.avatarUrl ?? null}
      className="size-10"
    />
  )
}

function defaultTitle(conversation: DmConversation): string {
  if (conversation.kind === "group") {
    const names = conversation.members
      .map((m) => m.displayName ?? (m.handle ? `@${m.handle}` : null))
      .filter((n): n is string => Boolean(n))
    if (names.length === 0) return "Group"
    if (names.length <= 3) return names.join(", ")
    return `${names.slice(0, 2).join(", ")} + ${names.length - 2}`
  }
  const other = conversation.members.at(0)
  return other?.displayName ?? (other?.handle ? `@${other.handle}` : "Conversation")
}

function initialFor(m: DmMember): string {
  return (m.displayName || m.handle || "?").slice(0, 1).toUpperCase()
}

type MessageKind = "text" | "media" | "post_share" | "article_share" | "system"

function previewForKind(kind: MessageKind | undefined) {
  if (kind === "media") return "[media]"
  if (kind === "post_share") return "[shared post]"
  if (kind === "article_share") return "[shared article]"
  if (kind === "system") return "[system]"
  return null
}
