import { Link } from "@tanstack/react-router"
import {
  IconBell,
  IconBookmark,
  IconHome,
  IconLogin,
  IconMail,
  IconPencil,
  IconSearch,
  IconUserPlus,
} from "@tabler/icons-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { authClient } from "../lib/auth"
import { api } from "../lib/api"
import { subscribeToDmStream } from "../lib/dm-stream"
import { useMe } from "../lib/me"
import { AppHeader } from "./app-header"
import { UserNav } from "./user-nav"
import { ComposeFab } from "./compose-fab"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"

export function AppShell({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession()
  const { me } = useMe()
  const unread = useUnreadNotifications(Boolean(session))
  const dmUnread = useUnreadDms(Boolean(session))

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="p-2">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                t
              </div>
              <span className="text-base font-semibold group-data-[collapsible=icon]:hidden">
                twotter
              </span>
            </Link>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="default"
                      tooltip="home"
                      render={
                        <Link to="/">
                          <IconHome />
                          <span>Home</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="default"
                      tooltip="search"
                      render={
                        <Link to="/search">
                          <IconSearch />
                          <span>Search</span>
                        </Link>
                      }
                    />
                  </SidebarMenuItem>
                  {session && (
                    <>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="default"
                          tooltip="notifications"
                          render={
                            <Link to="/notifications">
                              <IconBell />
                              <span>Notifications</span>
                              {unread > 0 && (
                                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden">
                                  {unread > 99 ? "99+" : unread}
                                </span>
                              )}
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="default"
                          tooltip="messages"
                          render={
                            <Link to="/inbox">
                              <IconMail />
                              <span>Messages</span>
                              {dmUnread > 0 && (
                                <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden">
                                  {dmUnread > 99 ? "99+" : dmUnread}
                                </span>
                              )}
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="default"
                          tooltip="bookmarks"
                          render={
                            <Link to="/bookmarks">
                              <IconBookmark />
                              <span>Bookmarks</span>
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="default"
                          tooltip="write article"
                          render={
                            <Link to="/articles/new">
                              <IconPencil />
                              <span>Write Article</span>
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                      {/* {me?.handle && (
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            size="default"
                            tooltip="profile"
                            render={
                              <Link
                                to="/$handle"
                                params={{ handle: me.handle }}
                              >
                                <IconUser />
                                <span>Profile</span>
                              </Link>
                            }
                          />
                        </SidebarMenuItem>
                      )} */}
                      {/* <SidebarMenuItem>
                        <SidebarMenuButton
                          size="default"
                          tooltip="settings"
                          render={
                            <Link to="/settings">
                              <IconSettings />
                              <span>Settings</span>
                            </Link>
                          }
                        />
                      </SidebarMenuItem> */}
                    </>
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            {!isPending && session && me && (
              <SidebarMenu>
                <SidebarMenuItem>
                  <UserNav user={me} />
                </SidebarMenuItem>
              </SidebarMenu>
            )}
            {!isPending && !session && (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="default"
                    tooltip="sign in"
                    render={<Link to="/login" />}
                  >
                    <IconLogin />
                    <span>Sign in</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="default"
                    tooltip="sign up"
                    render={<Link to="/signup" />}
                  >
                    <IconUserPlus />
                    <span>Sign up</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            )}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <AppHeader />
          <div className="flex flex-1 justify-center">
            <main className="w-full flex-1 border-border md:max-w-[640px] md:border-x">
              {children}
            </main>
            {/* <RightRail /> */}
          </div>
          {session && <ComposeFab />}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

function useUnreadNotifications(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    let cancel = false
    async function tick() {
      try {
        const { count } = await api.notificationsUnreadCount()
        if (!cancel) setCount(count)
      } catch {
        /* network blip; try again next tick */
      }
    }
    tick()
    const iv = setInterval(tick, 60_000)
    return () => {
      cancel = true
      clearInterval(iv)
    }
  }, [enabled])
  return count
}

function useUnreadDms(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setCount(0)
      return
    }
    let cancel = false
    async function refresh() {
      try {
        const { count } = await api.dmUnreadCount()
        if (!cancel) setCount(count)
      } catch {
        /* network blip; will reconcile on the next stream event or slow poll */
      }
    }
    refresh()
    // Slow background reconcile in case the SSE stream silently stalls.
    const iv = setInterval(refresh, 120_000)
    // Nudge the count whenever the stream surfaces a message or read event — that covers both
    // "new message arrived" (increment) and "I read somewhere else" (decrement) without needing
    // to compute deltas locally.
    const unsubscribe = subscribeToDmStream(() => {
      refresh()
    })
    return () => {
      cancel = true
      clearInterval(iv)
      unsubscribe()
    }
  }, [enabled])
  return count
}
