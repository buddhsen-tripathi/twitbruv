import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useEffect, useMemo, useState } from "react"
import { api, type AnalyticsOverview } from "../lib/api"
import { authClient } from "../lib/auth"

export const Route = createFileRoute("/analytics")({ component: Analytics })

function Analytics() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()
  const [data, setData] = useState<AnalyticsOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(28)

  useEffect(() => {
    if (!isPending && !session) router.navigate({ to: "/login" })
  }, [isPending, session, router])

  useEffect(() => {
    if (!session) return
    setData(null)
    setError(null)
    api
      .analyticsOverview(days)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load"))
  }, [session, days])

  return (
    <main>
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">Analytics</h1>
          <p className="text-xs text-muted-foreground">
            Free forever · no AI inference · self-reported only.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
        >
          <option value={7}>Last 7 days</option>
          <option value={28}>Last 28 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>

      {error && <p className="p-4 text-sm text-destructive">{error}</p>}
      {!data && !error && <p className="p-4 text-sm text-muted-foreground">loading…</p>}

      {data && (
        <div className="space-y-6 px-4 py-4">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Impressions" value={data.totals.impressions} />
            <Stat label="Engagements" value={data.totals.engagements} />
            <Stat label="New followers" value={data.totals.newFollowers} />
            <Stat
              label="Engagement rate"
              value={`${(data.totals.engagementRate * 100).toFixed(1)}%`}
              hint={
                data.totals.impressions === 0
                  ? "No impressions yet"
                  : `${data.totals.engagements} / ${data.totals.impressions}`
              }
            />
          </section>

          <section className="rounded-md border border-border p-4">
            <h2 className="text-sm font-semibold">Follower growth</h2>
            <p className="text-xs text-muted-foreground">
              New follows per day over the selected window.
            </p>
            <FollowerSparkline points={data.followerGrowth} days={data.period.days} />
          </section>

          <section className="rounded-md border border-border">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Breakdown</h2>
            </header>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-5">
              <Row label="Likes" value={data.totals.likes} />
              <Row label="Reposts" value={data.totals.reposts} />
              <Row label="Replies" value={data.totals.replies} />
              <Row label="Quotes" value={data.totals.quotes} />
              <Row label="Bookmarks" value={data.totals.bookmarks} />
            </dl>
          </section>

          <section className="rounded-md border border-border">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Top posts</h2>
              <p className="text-xs text-muted-foreground">
                Ranked by total engagement within the window.
              </p>
            </header>
            {data.topPosts.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                No posts in this period yet.
              </p>
            ) : (
              <ul>
                {data.topPosts.map((p) => {
                  const total =
                    p.counts.likes +
                    p.counts.reposts +
                    p.counts.replies +
                    p.counts.bookmarks +
                    p.counts.quotes
                  const excerpt =
                    p.text.trim().length > 0
                      ? p.text.trim().slice(0, 120) + (p.text.length > 120 ? "…" : "")
                      : p.media && p.media.length > 0
                      ? `[${p.media.length} image${p.media.length > 1 ? "s" : ""}]`
                      : "—"
                  const path = p.author.handle
                    ? { to: "/$handle/p/$id" as const, params: { handle: p.author.handle, id: p.id } }
                    : null
                  return (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0"
                    >
                      <div className="min-w-0 flex-1">
                        {path ? (
                          <Link {...path} className="text-sm hover:underline">
                            {excerpt}
                          </Link>
                        ) : (
                          <span className="text-sm">{excerpt}</span>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          ♥ {p.counts.likes} · 🔁 {p.counts.reposts} · 💬 {p.counts.replies} · 🔖{" "}
                          {p.counts.bookmarks}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">{total}</div>
                        <div className="text-xs text-muted-foreground">total</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  )
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  )
}

function FollowerSparkline({
  points,
  days,
}: {
  points: Array<{ day: string; newFollowers: number }>
  days: number
}) {
  const series = useMemo(() => {
    // Densify: fill in zero days so the line doesn't just connect the populated ones.
    const byDay = new Map(points.map((p) => [p.day, p.newFollowers]))
    const out: Array<{ day: string; n: number }> = []
    const today = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      out.push({ day: key, n: byDay.get(key) ?? 0 })
    }
    return out
  }, [points, days])

  if (series.every((s) => s.n === 0)) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        No new followers in this period.
      </p>
    )
  }

  const width = 600
  const height = 80
  const max = Math.max(1, ...series.map((s) => s.n))
  const step = width / Math.max(1, series.length - 1)
  const pts = series
    .map((s, i) => `${i * step},${height - (s.n / max) * height}`)
    .join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-3 h-20 w-full" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="text-primary"
      />
    </svg>
  )
}
