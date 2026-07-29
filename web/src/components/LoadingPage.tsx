import { Compass } from "lucide-react";

/**
 * Full-viewport loading state (brief follow-up: "make the error, loading
 * and not-found page well animated and designed to the theme"). Used
 * anywhere a page has a genuine blocking gap between mount and having
 * enough data to render anything meaningful -- see MapBySlugPage.tsx's
 * `!config && !error` gate, which used to render a blank screen for that
 * window instead of anything at all.
 *
 * The compass motif (searching/orienting) reads as "finding your map"
 * rather than a generic spinner -- same deliberate-icon-choice convention
 * as every hand-built map control's own icon (see basemapSwitcherControl.ts).
 * Spin duration is slowed to 2.5s via an arbitrary Tailwind value
 * (`animate-spin`'s default is 1s, which reads mechanical/urgent) -- a
 * loading state that will often resolve in under a second shouldn't feel
 * frantic.
 */
export function LoadingPage({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, color-mix(in oklch, var(--primary) 8%, transparent), transparent 70%)",
        }}
      />
      <Compass
        className="size-10 animate-spin text-primary animation-duration-[2.5s]"
        strokeWidth={1.5}
        aria-hidden
      />
      <p className="animate-pulse text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
