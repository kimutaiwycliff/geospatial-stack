import { Link } from "react-router-dom";
import { MapPinOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Catch-all `*` route (brief follow-up: "make the error, loading and
 * not-found page well animated and designed to the theme so it's fun yet
 * still production grade"). Before this, an unmatched path (typo'd `/m/`
 * slug, a bookmarked route that got renamed, etc.) rendered nothing at all
 * -- react-router's <Routes> with no matching <Route> just renders null.
 */
export function NotFoundPage() {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 42%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 70%)",
        }}
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        {/* Gentle up-down bob (not a spin/pulse -- a "misplaced pin", not a
            "working" or "alert" state) via the custom `animate-float`
            keyframe in styles/index.css. */}
        <MapPinOff className="size-14 animate-float text-primary" strokeWidth={1.25} aria-hidden />
        <h1 className="text-6xl font-bold text-foreground">404</h1>
        <p className="max-w-sm text-lg text-muted-foreground">
          This coordinate doesn&apos;t exist on the map. The page you&apos;re looking for was moved, renamed, or
          never here.
        </p>
        <div className="mt-2 flex gap-3">
          <Link to="/" className={buttonVariants({ variant: "default" })}>
            Back home
          </Link>
          <Link to="/map" className={buttonVariants({ variant: "outline" })}>
            Explore the map
          </Link>
        </div>
      </div>
    </div>
  );
}
