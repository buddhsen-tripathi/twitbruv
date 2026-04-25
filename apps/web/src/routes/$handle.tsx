import { Link, Outlet, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { NotFoundPanel } from "../components/page-surface"
import { PageFrame } from "../components/page-frame"

export const Route = createFileRoute("/$handle")({
  component: HandleLayout,
  notFoundComponent: HandleNotFound,
})

function HandleLayout() {
  return (
    <PageFrame>
      <Outlet />
    </PageFrame>
  )
}

function HandleNotFound() {
  return (
    <PageFrame>
      <NotFoundPanel
        title="Page not found"
        message="That profile or path does not exist."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button nativeButton={false} render={<Link to="/" />}>
            Home
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/search" />}
          >
            Search
          </Button>
        </div>
      </NotFoundPanel>
    </PageFrame>
  )
}
