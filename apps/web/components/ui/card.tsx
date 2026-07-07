import * as React from "react"

import { cn } from "@/lib/cn"

// Card sections are spaced by the outer Card's `gap-5` and the outer
// `py-6` / horizontal `px-6` on each section. This means no section needs
// its own vertical padding, so consumers should NOT add `pb-3`, `p-6`,
// etc. – those layered on top of the defaults and produced the uneven
// padding callers had to patch around. If you want a compact card,
// override the outer Card with `className="py-0 gap-0"` and put your own
// padding on the inner section (see components/processes/module-card.tsx).

type CardVariant = "default" | "glass" | "liquid" | "frosted" | "elevated"

// Surface treatments. `default` reproduces the original opaque card exactly –
// module panels that render <Card> with no variant are byte-identical. The
// glass surfaces are ported from GlinUI and reference the --glass-* / --shadow-glass-*
// tokens defined in globals.css. Blur is GPU-cheap here, but callers behind
// dense tables/canvases should stay on `default`/`elevated` (see the reskin guardrail).
const cardSurfaces: Record<CardVariant, string> = {
  default: "border bg-card shadow-md",
  elevated: "border bg-surface-elevated shadow-lg",
  glass:
    "border border-white/20 [border-top-color:var(--glass-refraction-top)] bg-[radial-gradient(ellipse_at_50%_0%,rgb(255_255_255_/_0.16),transparent_50%),linear-gradient(to_bottom,rgb(255_255_255_/_0.1),rgb(255_255_255_/_0.04))] backdrop-blur-xl backdrop-saturate-[180%] shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)] dark:border-white/[0.1] dark:[border-top-color:rgb(255_255_255_/_0.15)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgb(255_255_255_/_0.05),transparent_50%),linear-gradient(to_bottom,rgb(255_255_255_/_0.03),rgb(255_255_255_/_0.01))] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_8px_24px_rgb(0_0_0_/_0.35)]",
  frosted:
    "border border-white/30 [border-top-color:var(--glass-refraction-top)] bg-[radial-gradient(ellipse_at_50%_0%,rgb(255_255_255_/_0.32),transparent_50%),linear-gradient(to_bottom,rgb(255_255_255_/_0.22),rgb(255_255_255_/_0.1))] backdrop-blur-[40px] backdrop-saturate-[200%] shadow-[0_0_0_1px_rgb(255_255_255_/_0.15)_inset,0_0_20px_rgb(255_255_255_/_0.12)_inset,var(--shadow-glass-md)] dark:border-white/[0.15] dark:[border-top-color:rgb(255_255_255_/_0.2)] dark:bg-[radial-gradient(ellipse_at_50%_0%,rgb(255_255_255_/_0.1),transparent_50%),linear-gradient(to_bottom,rgb(255_255_255_/_0.06),rgb(255_255_255_/_0.02))] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)_inset,0_0_20px_rgb(255_255_255_/_0.04)_inset,0_8px_32px_rgb(0_0_0_/_0.4)]",
  liquid:
    "border border-white/25 [border-top-color:var(--glass-refraction-top)] bg-[radial-gradient(circle_at_16%_14%,rgb(255_255_255_/_0.72),transparent_46%),linear-gradient(165deg,rgb(255_255_255_/_0.58),rgb(238_238_238_/_0.32))] backdrop-blur-xl backdrop-saturate-[180%] shadow-[0_0_0_1px_rgb(255_255_255_/_0.2)_inset,var(--shadow-glass-md)] dark:border-white/[0.14] dark:[border-top-color:rgb(255_255_255_/_0.32)] dark:bg-[linear-gradient(165deg,rgb(255_255_255_/_0.12),rgb(255_255_255_/_0.05))] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.06)_inset,0_12px_36px_rgb(0_0_0_/_0.4)]",
}

function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: CardVariant }) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(
        "flex flex-col gap-5 rounded-[18px] py-6 text-card-foreground",
        cardSurfaces[variant],
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-base font-bold leading-tight tracking-tight", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm font-light text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("px-6", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center justify-end gap-3 px-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
