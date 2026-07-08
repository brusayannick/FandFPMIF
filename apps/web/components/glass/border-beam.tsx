"use client"

import * as React from "react"
import { cn } from "@/lib/cn"

export interface BorderBeamProps extends React.HTMLAttributes<HTMLDivElement> {
  duration?: number
  delay?: number
  size?: number
  colorFrom?: string
  colorTo?: string
  borderRadius?: string
}

export const BorderBeam = React.forwardRef<HTMLDivElement, BorderBeamProps>(
  (
    {
      className,
      duration = 6,
      delay = 0,
      size = 100,
      colorFrom = "var(--primary)",
      colorTo = "transparent",
      borderRadius,
      style,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] motion-reduce:hidden",
        "[mask-clip:padding-box,border-box] [mask-composite:intersect]",
        "border border-transparent",
        "[mask-image:linear-gradient(transparent,transparent),linear-gradient(#fff,#fff)]",
        className
      )}
      style={
        {
          "--border-beam-duration": `${duration}s`,
          borderRadius: borderRadius,
          ...style,
        } as React.CSSProperties
      }
      {...props}
    >
      {/* A conic-gradient comet rotated via the registered `--border-beam-angle`
          (globals.css). The angle interpolates smoothly, so the beam glides the
          rounded corners instead of the old `offset-path: rect()` which cut
          straight across them (corner stutter + a misaligned bottom edge). The
          parent mask clips this full-box gradient to the border ring. */}
      <div
        className="absolute inset-0 rounded-[inherit] motion-safe:animate-[border-beam_var(--border-beam-duration,6s)_linear_infinite]"
        style={
          {
            animationDelay: `${delay}s`,
            background: `conic-gradient(from var(--border-beam-angle, 0deg), ${colorFrom} 0deg, ${colorTo} ${size}deg)`,
          } as React.CSSProperties
        }
      />
    </div>
  )
)

BorderBeam.displayName = "BorderBeam"
