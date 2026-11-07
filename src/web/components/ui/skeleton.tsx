import { cn } from "cn"

function Skeleton({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-md bg-muted", className)}
      style={style}
      {...props}
    />
  )
}

export { Skeleton }
