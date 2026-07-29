import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Fallback UI for App.tsx's top-level <Sentry.ErrorBoundary> (brief
 * follow-up: themed error/loading/not-found pages). Reused as-is for any
 * uncaught render error anywhere in the tree -- there's only one "the app
 * broke" experience to design, not one per page. "Reload" (a real
 * navigation, not client-side state) is deliberate: the error already
 * proved this render tree is broken, so recovering into the SAME broken
 * React state via a client-side retry isn't a real fix the way a fresh
 * page load is.
 */
export function ErrorPage() {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 42%, color-mix(in oklch, var(--destructive) 8%, transparent), transparent 70%)",
        }}
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <TriangleAlert className="size-14 text-destructive" strokeWidth={1.25} aria-hidden />
        <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
        <p className="max-w-sm text-muted-foreground">
          An unexpected error interrupted this page. It's been logged automatically -- reloading usually clears it.
        </p>
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={() => window.location.reload()} className={buttonVariants({ variant: "default" })}>
            Reload page
          </button>
          <Link to="/" className={buttonVariants({ variant: "outline" })}>
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
