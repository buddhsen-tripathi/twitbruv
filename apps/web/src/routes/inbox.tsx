import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import { authClient } from "../lib/auth"

export const Route = createFileRoute("/inbox")({ component: InboxLayout })

function InboxLayout() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    if (!isPending && !session) router.navigate({ to: "/login" })
  }, [isPending, session, router])

  if (!session) return null
  return <Outlet />
}
