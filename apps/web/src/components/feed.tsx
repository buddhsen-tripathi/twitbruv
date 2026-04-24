import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { PostCard } from "./post-card"
import type { FeedPage, Post } from "../lib/api"

export function Feed({
  load,
  emptyMessage = "Nothing here yet.",
  prependItem,
}: {
  load: (cursor?: string) => Promise<FeedPage>
  emptyMessage?: string
  prependItem?: Post | null
}) {
  const [posts, setPosts] = useState<Array<Post>>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    load()
      .then((page) => {
        if (cancel) return
        setPosts(page.posts)
        setCursor(page.nextCursor)
      })
      .catch((e) => {
        if (!cancel) setError(e instanceof Error ? e.message : "failed to load")
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [load])

  useEffect(() => {
    if (!prependItem) return
    setPosts((prev) =>
      prev.some((p) => p.id === prependItem.id) ? prev : [prependItem, ...prev]
    )
  }, [prependItem])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await load(cursor)
      setPosts((prev) => [...prev, ...page.posts])
      setCursor(page.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }

  function replace(next: Post) {
    setPosts((prev) => prev.map((p) => (p.id === next.id ? next : p)))
  }
  function remove(id: string) {
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  if (loading)
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground">loading…</div>
    )
  if (error)
    return <div className="px-4 py-6 text-sm text-destructive">{error}</div>
  if (posts.length === 0)
    return (
      <div className="p-4 text-sm text-muted-foreground">{emptyMessage}</div>
    )

  return (
    <div>
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          onChange={replace}
          onRemove={remove}
        />
      ))}
      {cursor && (
        <div className="flex justify-center py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "loading…" : "load more"}
          </Button>
        </div>
      )}
    </div>
  )
}
