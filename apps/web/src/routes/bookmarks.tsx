import { createFileRoute, useRouter } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { api } from "../lib/api"
import { authClient } from "../lib/auth"
import { Feed } from "../components/feed"
import { PageHeader } from "../components/page-surface"
import { PageFrame } from "../components/page-frame"

export const Route = createFileRoute("/bookmarks")({ component: Bookmarks })

function Bookmarks() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()
  useEffect(() => {
    if (!isPending && !session) router.navigate({ to: "/login" })
  }, [isPending, session, router])

  const load = useCallback((cursor?: string) => api.bookmarks(cursor), [])

  return (
    <PageFrame>
      <main className="">
        <PageHeader
          title="Bookmarks"
          description="Only you can see this list."
        />
        <Feed
          queryKey={["bookmarks"]}
          load={load}
          emptyMessage="no bookmarks yet. tap the bookmark icon on a post to save it."
        />
      </main>
    </PageFrame>
  )
}
