import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircleIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnauthorizedError } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { ThemeToggle } from "../ThemeToggle";

/**
 * Admin sign-in (brief §10). Deliberately just email + password + one
 * submit button -- there's no self-service admin signup anywhere in this
 * phase (accounts are provisioned via the `create_admin` CLI), so this
 * form's only job is exchanging credentials for a token, not managing
 * accounts.
 */
export function AdminLogin() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      // UnauthorizedError and a generic network/HTTP failure both just need
      // a human-readable message here -- there's no different UI treatment
      // for "wrong password" vs. "API unreachable" on a login form.
      setError(err instanceof UnauthorizedError ? "Incorrect email or password." : "Could not sign in. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-background px-6">
      {/* Even a login page should respect the visitor's OS/stored theme
          preference before they've done anything else (brief: "every page
          needs the theme toggle"). */}
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm duration-300"
      >
        <h1 className="text-lg font-semibold text-foreground">Admin sign in</h1>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-email">Email</Label>
          <Input
            id="admin-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-password">Password</Label>
          <Input
            id="admin-password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && (
          <Alert variant="destructive" className="animate-in fade-in duration-200">
            <AlertCircleIcon className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
