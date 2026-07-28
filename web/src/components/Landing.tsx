import { Link } from "react-router-dom";

/**
 * Mission/explainer page (brief §6.2 "Landing page (mission/platform
 * explainer)"). Deliberately minimal -- one headline, one paragraph, one
 * way into the map -- matching the brief's own "doesn't need to be
 * elaborate" framing rather than building a full marketing page for a
 * platform whose actual value is the map itself.
 */
export function Landing() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-slate-50 px-6 text-center">
      <h1 className="max-w-2xl text-4xl font-bold text-slate-900 sm:text-5xl">
        Mapping Indigenous &amp; community land rights, worldwide
      </h1>
      <p className="max-w-xl text-lg text-slate-600">
        This platform replicates and extends LandMark, the global data hub for Indigenous and community land
        rights: community boundaries, national indicators, and tenure-security data for hundreds of countries --
        with full source, license, and sensitivity information attached to every layer.
      </p>
      <Link
        to="/map"
        className="rounded-md bg-blue-600 px-5 py-2.5 text-base font-medium text-white shadow transition-colors hover:bg-blue-700"
      >
        Explore the map
      </Link>
    </div>
  );
}
