import { Link } from "@tanstack/react-router"
import { cn } from "@workspace/ui/lib/utils"
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react"

export function UnderlineTabRow({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn("flex w-full min-w-0 border-b border-border", className)}
      role="tablist"
    >
      {children}
    </div>
  )
}

export function UnderlineTabButton({
  active,
  className,
  children,
  ...rest
}: {
  active: boolean
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "min-h-11 flex-1 border-b-2 border-transparent bg-transparent py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

type UnderlineTabLinkProps = { active: boolean; children: ReactNode } & Omit<
  ComponentProps<typeof Link>,
  "className" | "children"
> & { className?: string }

export function UnderlineTabLink({
  active,
  className,
  children,
  ...rest
}: UnderlineTabLinkProps) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      className={cn(
        "flex min-h-11 flex-1 items-center justify-center border-b-2 border-transparent py-2.5 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...rest}
    >
      {children}
    </Link>
  )
}
