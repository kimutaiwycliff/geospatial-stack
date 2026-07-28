import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

interface ThemeContextValue {
  /** The user's stored preference -- "system" means "follow the OS", not a
   * resolved light/dark value. */
  theme: Theme;
  /** What's actually applied right now (system resolved to light/dark) --
   * this is what a toggle button should branch its icon/label on, `theme`
   * alone can't tell you which one "system" currently means. */
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  // shadcn's generated styles/index.css wires `.dark` via `@custom-variant
  // dark (&:is(.dark *))` -- every component's dark: utility class is keyed
  // off this one class on the root element, so toggling it here is the
  // entire mechanism; no per-component dark-mode logic needed anywhere else.
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

/**
 * Wraps the whole app (both the public site and the admin surface --
 * App.tsx mounts this above the router, same level as AdminAuthProvider)
 * so any component can read/set the theme without caring whether it's
 * "inside" one section or another. Defaults to "system" on first visit
 * (brief/ecc guidance: respect the OS preference rather than forcing
 * light), then remembers whatever the user explicitly picks afterward.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? getSystemTheme() : theme,
  );

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    applyTheme(resolved);

    // Only listen for OS-level changes while the user hasn't overridden
    // "system" -- once they've explicitly picked light/dark, this app must
    // not silently flip on them just because their OS theme changed.
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = getSystemTheme();
      setResolvedTheme(next);
      applyTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() called outside <ThemeProvider>");
  }
  return ctx;
}
