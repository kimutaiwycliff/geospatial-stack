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
    <div className="relative flex h-screen w-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      {/* Same top-right spot as every other page's toggle (brief: "same
          visual spot ... for consistency") -- a public visitor's very first
          impression of the app should already respect their OS/stored
          preference, not just the admin surface. */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
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
  );
}
