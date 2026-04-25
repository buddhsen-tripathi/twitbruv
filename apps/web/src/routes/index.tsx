import { Link, createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { authClient } from "../lib/auth"
import { api } from "../lib/api"
import { APP_NAME } from "../lib/env"
import { useMe } from "../lib/me"
import { useDelayedPresence } from "../lib/use-delayed-presence"
import { Compose } from "../components/compose"
import { Feed } from "../components/feed"
import { PageLoading } from "../components/page-surface"
import { PageFrame } from "../components/page-frame"
import {
  UnderlineTabButton,
  UnderlineTabRow,
} from "../components/underline-tab-row"
import { ThreadViewContent } from "../components/thread-view"
import { homeThreadFromFeedSearch } from "../lib/home-from-feed"
import {
  HOME_PANEL_MIN_INSET_WIDTH,
  HOME_PANEL_PRESENCE_MS,
  useInsetMinWidth,
} from "../lib/use-media-query"
import type { Post } from "../lib/api"

type HomeSearch = { postId?: string; postHandle?: string }

export const Route = createFileRoute("/")({
  component: Landing,
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    postId: typeof search.postId === "string" ? search.postId : undefined,
    postHandle:
      typeof search.postHandle === "string" ? search.postHandle : undefined,
  }),
})

type FeedTab = "following" | "network" | "all"

function Landing() {
  const navigate = Route.useNavigate()
  const { postId, postHandle } = Route.useSearch()
  const { data: session, isPending } = authClient.useSession()
  const { me } = useMe()
  const isDesktop = useInsetMinWidth(HOME_PANEL_MIN_INSET_WIDTH)
  const [newPost, setNewPost] = useState<Post | null>(null)
  const [tab, setTab] = useState<FeedTab>("following")
  const selectedThread = useMemo(
    () => (postId && postHandle ? { id: postId, handle: postHandle } : null),
    [postId, postHandle]
  )
  const panelThread = useDelayedPresence(selectedThread, HOME_PANEL_PRESENCE_MS)

  const loadFeed = useCallback((cursor?: string) => api.feed(cursor), [])
  const loadPublic = useCallback(
    (cursor?: string) => api.publicTimeline(cursor),
    [],
  )
  const loadNetwork = useCallback(
    (cursor?: string) => api.networkFeed(cursor),
    [],
  )

  const openThread = useCallback(
    (post: Post) => {
      const handle = post.author.handle
      if (!handle) return
      if (isDesktop) {
        navigate({
          to: "/",
          search: { postId: post.id, postHandle: handle },
          replace: Boolean(selectedThread),
          resetScroll: false,
        })
        return
      }
      navigate({
        to: "/$handle/p/$id",
        params: { handle, id: post.id },
        search: homeThreadFromFeedSearch(post.id, handle),
      })
    },
    [isDesktop, navigate, selectedThread],
  )
  const closeThread = useCallback(() => {
    navigate({ to: "/", search: {}, replace: true, resetScroll: false })
  }, [navigate])

  useEffect(() => {
    if (isDesktop || !selectedThread) return
    navigate({
      to: "/$handle/p/$id",
      params: { handle: selectedThread.handle, id: selectedThread.id },
      search: homeThreadFromFeedSearch(
        selectedThread.id,
        selectedThread.handle,
      ),
      replace: true,
    })
  }, [isDesktop, navigate, selectedThread])

  if (isPending) {
    return (
      <PageFrame>
        <PageLoading />
      </PageFrame>
    )
  }

  if (session) {
    const needsHandle = me && !me.handle
    return (
      <main className="@min-[1120px]/inset:flex @min-[1120px]/inset:h-[calc(100svh-3rem)] @min-[1120px]/inset:min-h-0 @min-[1120px]/inset:justify-center @min-[1120px]/inset:overflow-hidden">
        <div className="@min-[1120px]/inset:flex @min-[1120px]/inset:h-full @min-[1120px]/inset:min-h-0 @min-[1120px]/inset:w-[1120px] @min-[1120px]/inset:items-stretch">
          <div
            className={`mx-auto w-full min-w-0 border-border md:max-w-[640px] md:border-x @min-[1120px]/inset:mx-0 @min-[1120px]/inset:flex @min-[1120px]/inset:h-full @min-[1120px]/inset:min-h-0 @min-[1120px]/inset:w-[640px] @min-[1120px]/inset:max-w-none @min-[1120px]/inset:shrink-0 @min-[1120px]/inset:flex-col @min-[1120px]/inset:overflow-y-auto @min-[1120px]/inset:border-x @min-[1120px]/inset:border-border @min-[1120px]/inset:transition-transform @min-[1120px]/inset:duration-300 @min-[1120px]/inset:ease-out @min-[1120px]/inset:[will-change:transform] @min-[1120px]/inset:[contain:layout] ${
              panelThread
                ? "@min-[1120px]/inset:translate-x-0"
                : "@min-[1120px]/inset:translate-x-[240px]"
            }`}
          >
            {needsHandle ? (
              <Alert className="m-4">
                <AlertTitle>Finish setup</AlertTitle>
                <AlertDescription>
                  Choose a handle so others can find you. Handles are permanent
                  in v1.
                </AlertDescription>
                <div className="mt-3">
                  <Button size="sm" nativeButton={false} render={<Link to="/settings" />}>
                    Claim your handle
                  </Button>
                </div>
              </Alert>
            ) : (
              <Compose onCreated={(p) => setNewPost(p)} collapsible />
            )}
            <UnderlineTabRow>
              {(["following", "network", "all"] as Array<FeedTab>).map((t) => (
                <UnderlineTabButton
                  key={t}
                  active={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t === "following"
                    ? "Following"
                    : t === "network"
                      ? "Network"
                      : "All"}
                </UnderlineTabButton>
              ))}
            </UnderlineTabRow>
            <Feed
              queryKey={["feed", tab]}
              load={
                tab === "following"
                  ? loadFeed
                  : tab === "network"
                    ? loadNetwork
                    : loadPublic
              }
              emptyMessage={
                tab === "following"
                  ? "Follow people to see posts here. Switch to All to see the public timeline."
                  : tab === "network"
                    ? "No posts from your network's likes/reposts yet."
                    : "No posts yet. Be the first."
              }
              prependItem={newPost}
              onOpenThread={openThread}
              activePostId={panelThread?.id}
              renderActivityBanner={
                tab === "network"
                  ? (p) => {
                      const np = p as Post & {
                        networkActors?: Array<{
                          id: string
                          handle: string | null
                          displayName: string | null
                        }>
                        networkActorTotal?: number
                      }
                      if (!np.networkActors || np.networkActors.length === 0)
                        return null
                      const first = np.networkActors[0]
                      const more = (np.networkActorTotal ?? 1) - 1
                      const name =
                        first.displayName ||
                        (first.handle ? `@${first.handle}` : "Someone")
                      return (
                        <div className="ml-10 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>
                            {name}
                            {more > 0
                              ? ` and ${more} other${more === 1 ? "" : "s"}`
                              : ""}{" "}
                            liked or reposted
                          </span>
                        </div>
                      )
                    }
                  : undefined
              }
            />
          </div>

          <div
            className={`hidden @min-[1120px]/inset:h-full @min-[1120px]/inset:min-h-0 @min-[1120px]/inset:w-[480px] @min-[1120px]/inset:shrink-0 @min-[1120px]/inset:[contain:layout] ${
              panelThread
                ? "@min-[1120px]/inset:block"
                : "@min-[1120px]/inset:pointer-events-none"
            }`}
          >
            {panelThread && (
              <div
                className={`h-full overflow-hidden border-l border-border bg-background transition-transform duration-300 ease-out [will-change:transform] ${
                  selectedThread
                    ? "translate-x-0"
                    : "pointer-events-none translate-x-full"
                }`}
              >
                <ThreadViewContent
                  handle={panelThread.handle}
                  id={panelThread.id}
                  mode="panel"
                  onClose={closeThread}
                  returnToHome={{
                    postId: panelThread.id,
                    postHandle: panelThread.handle,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    )
  }

  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          A calm place to build in public
        </h1>
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} is a social layer for developers: short posts, articles,
          DMs, and repo context. No paywalls, no ads, no black-box feeds.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="lg" nativeButton={false} render={<Link to="/signup" />}>
            Create an account
          </Button>
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={<Link to="/login" />}
          >
            Sign in
          </Button>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Posts and articles</CardTitle>
              <CardDescription>
                Short updates and long-form writing in one place.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Developer context</CardTitle>
              <CardDescription>
                Connect GitHub, GitLab, and tools you already use.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Simple analytics</CardTitle>
              <CardDescription>
                A creator dashboard without upsells or model-driven ranking.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Your data</CardTitle>
              <CardDescription>
                Export and self-host with AGPL-3.0.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    </PageFrame>
  )
}
