import { createFileRoute, Link } from "@tanstack/react-router"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { api, type AdminReport, type ReportStatus } from "../lib/api"

export const Route = createFileRoute("/admin/reports")({ component: AdminReports })

const STATUSES: Array<ReportStatus> = ["open", "triaged", "actioned", "dismissed"]

function AdminReports() {
  const [status, setStatus] = useState<ReportStatus>("open")
  const [reports, setReports] = useState<Array<AdminReport>>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (s: ReportStatus) => {
    setLoading(true)
    try {
      const res = await api.adminReports(s)
      setReports(res.reports)
      setCursor(res.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(status)
  }, [status, load])

  async function loadMore() {
    if (!cursor) return
    const res = await api.adminReports(status, cursor)
    setReports((prev) => [...prev, ...res.reports])
    setCursor(res.nextCursor)
  }

  async function resolve(r: AdminReport, next: "triaged" | "actioned" | "dismissed") {
    const note =
      next === "actioned"
        ? window.prompt("Resolution note (what action was taken):", "") ?? undefined
        : undefined
    setBusyId(r.id)
    try {
      await api.adminResolveReport(r.id, { status: next, resolutionNote: note })
      await load(status)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <main>
      <div className="flex gap-2 border-b border-border px-4 py-3 text-sm">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-2 py-1 ${
              s === status
                ? "bg-muted font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {loading && reports.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">loading…</p>
      )}
      {!loading && reports.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No {status} reports.</p>
      )}
      <ul>
        {reports.map((r) => (
          <li
            key={r.id}
            className="border-b border-border px-4 py-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className="font-semibold">{r.reason}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <SubjectLink type={r.subjectType} id={r.subjectId} />
              <span className="text-xs text-muted-foreground">·</span>
              <time className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="text-xs text-muted-foreground">
              reported by{" "}
              {r.reporter?.handle ? (
                <Link
                  to="/$handle"
                  params={{ handle: r.reporter.handle }}
                  className="hover:underline"
                >
                  @{r.reporter.handle}
                </Link>
              ) : (
                "(unknown)"
              )}
            </p>
            {r.details && <p className="mt-1 text-sm">{r.details}</p>}
            {status === "open" && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r, "triaged")}
                >
                  Triage
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r, "actioned")}
                >
                  Action
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === r.id}
                  onClick={() => resolve(r, "dismissed")}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <div className="flex justify-center py-3">
          <Button variant="ghost" size="sm" onClick={loadMore}>
            load more
          </Button>
        </div>
      )}
    </main>
  )
}

function SubjectLink({ type, id }: { type: string; id: string }) {
  const label = `${type} ${id.slice(0, 8)}`
  return <span className="text-xs text-muted-foreground">{label}</span>
}
