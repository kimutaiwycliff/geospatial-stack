import { useMemo, useState } from "react";

/**
 * Single-select dropdown with a search box (brief follow-up: "the filters
 * ... should include searching that field") -- a plain shadcn `Select`'s
 * list isn't searchable, which matters once a filter's option list is
 * pulled from real data (MapEditor's field-values picker) and can run to
 * dozens/hundreds of distinct values, not a handful of hand-typed ones.
 * Deliberately hand-rolled rather than pulling in cmdk/Popover (no
 * Command/Popover primitives exist in this project yet) -- a text input
 * + filtered button list covers the actual need without a new dependency.
 */
export function SearchableFilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={label}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-2 text-left text-xs text-foreground"
      >
        <span className="truncate">{value || "All"}</span>
        <span className="ml-1 text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 flex w-full flex-col overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="border-b border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none"
          />
          <div className="flex max-h-48 flex-col overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className="rounded px-2 py-1 text-left text-xs text-foreground hover:bg-muted"
            >
              All
            </button>
            {filtered.length === 0 && <span className="px-2 py-1 text-xs text-muted-foreground">No matches.</span>}
            {filtered.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setQuery("");
                }}
                className={`truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${
                  option === value ? "bg-muted font-medium text-foreground" : "text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
