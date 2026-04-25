import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { APP_NAME } from "../lib/env"
import type { ReactNode } from "react"

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-sm">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            {APP_NAME.slice(0, 1).toLowerCase()}
          </div>
          <span className="text-base font-semibold">{APP_NAME}</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Button size="sm" variant="ghost" render={<Link to="/login" />}>
            Sign in
          </Button>
          <Button size="sm" render={<Link to="/signup" />}>
            Sign up
          </Button>
        </nav>
      </header>
      <div className="flex flex-1 justify-center">
        <main className="w-full flex-1 border-border md:max-w-[640px] md:border-x">
          {children}
        </main>
      </div>
    </div>
  )
}
