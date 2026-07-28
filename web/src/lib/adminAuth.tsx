import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { login as loginRequest } from "./adminApi";

/** sessionStorage, not localStorage -- an admin JWT is a real bearer
 * credential (brief §10), and localStorage would let it silently outlive
 * the tab/browser session (survive full browser restarts, get synced by
 * some browsers' "reopen last session" features). sessionStorage clears
 * the moment the tab closes, which is the right blast radius for a
 * short-lived admin token that's cheap to re-issue via /auth/login. */
const STORAGE_KEY = "admin_token";

interface AdminAuthState {
  token: string | null;
  role: string | null;
  /** Resolves on success, throws (UnauthorizedError on bad creds) on
   * failure -- callers show the thrown error, they don't need a boolean. */
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(STORAGE_KEY));
  const [role, setRole] = useState<string | null>(() => (sessionStorage.getItem(STORAGE_KEY) ? "admin" : null));

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    sessionStorage.setItem(STORAGE_KEY, result.access_token);
    setToken(result.access_token);
    setRole(result.role);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setRole(null);
  }, []);

  const value = useMemo(() => ({ token, role, login, logout }), [token, role, login, logout]);

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth() called outside <AdminAuthProvider>");
  }
  return ctx;
}

/**
 * Route guard for everything under `/admin` except `/admin/login` itself.
 * Only checks "is there a token" client-side -- it can't verify the token
 * is still valid without a round-trip, so the real enforcement is still
 * adminApi.ts's UnauthorizedError-on-401 path (see AdminDashboard's catch
 * blocks) redirecting once an expired/revoked token actually gets used.
 * This guard just avoids rendering the dashboard shell at all when there's
 * obviously no session yet.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { token } = useAdminAuth();
  if (!token) {
    return <Navigate to="/admin/login" replace />;
  }
  return <>{children}</>;
}
