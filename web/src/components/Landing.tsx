import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Mission/explainer page (brief §6.2 "Landing page (mission/platform
 * explainer)"). Deliberately minimal -- one headline, one paragraph, one
 * way into the map -- matching the brief's own "doesn't need to be
 * elaborate" framing rather than building a full marketing page for a
 * platform whose actual value is the map itself.
 */
export function Landing() {
  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-6 overflow-hidden bg-background px-6 text-center">
      {/* Subtle warmth behind the hero -- the one "marketing-ish" surface in
          the app (brief: public/mission pages "can carry a bit more visual
          warmth than the admin dashboard's data-density needs"). A soft
          radial wash of the signature clay accent, low-opacity enough to
          stay a texture rather than a shape, `aria-hidden`+`pointer-events-
          none` since it's decorative only. `color-mix` against the themed
          `--primary` variable means this stays correct in both themes
          without a separate dark-mode override -- light mode's clay and
          dark mode's lightened clay both read as an equally faint glow at
          this opacity. Checked in both themes for text contrast: at 10% mix
          it's well under the threshold where it could affect the
          foreground/muted-foreground text sitting on top of it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 38%, color-mix(in oklch, var(--primary) 10%, transparent), transparent 70%)",
        }}
      />
      {/* Same top-right spot as every other page's toggle (brief: "same
          visual spot ... for consistency") -- a public visitor's very first
          impression of the app should already respect their OS/stored
          preference, not just the admin surface. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      {/* One entrance fade+rise for the whole hero group (not per-element --
          staggering three lines would be more motion than this "deliberately
          minimal" page calls for). */}
      <div className="flex flex-col items-center gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <h1 className="max-w-2xl text-4xl font-bold text-foreground sm:text-5xl">
          Mapping Indigenous &amp; community land rights, worldwide
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          This platform replicates and extends LandMark, the global data hub for Indigenous and community land
          rights: community boundaries, national indicators, and tenure-security data for hundreds of countries --
          with full source, license, and sensitivity information attached to every layer.
        </p>
        {/* `Link` (react-router) rather than a real <button> -- client-side
            routing has to stay intact, so this borrows buttonVariants' CLASSES
            only, not the Button component itself (Button renders a <button>,
            which would mean a full page reload via a wrapped <a> instead of
            react-router's history push). */}
        <Link to="/map" className={buttonVariants({ variant: "default", size: "lg" })}>
          Explore the map
        </Link>
      </div>
    </div>
  );
}
