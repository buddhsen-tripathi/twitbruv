import { SidebarTrigger } from "@workspace/ui/components/sidebar"

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 flex justify-center border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        <SidebarTrigger className="size-6 shrink-0" />
      </div>
    </header>
  )
}
