import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createUpload, UnauthorizedError, type UploadCreateResult } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

/** Mirrors uploads.py's `_ALLOWED_EXTENSIONS` -- kept here purely so the
 * file input's `accept` attribute steers curators away from a doomed
 * shapefile-zip/CSV upload before they even hit Submit. The backend is
 * still the real gate (this is just a UX nicety, not validation). */
const ACCEPTED_EXTENSIONS = [".geojson", ".json", ".gpkg", ".parquet"];

/**
 * "Upload a new dataset" form (brief §16 step 1). Deliberately its own
 * modal rather than a tab on an existing dataset -- there IS no dataset to
 * select yet at this point, `POST /admin/uploads` is what creates one.
 * Closes itself and hands the created `{slug, tier_status}` back to
 * AdminDashboard, which is the one that knows how to select it and refresh
 * the list so DatasetDetail's new Publishing tab can start polling.
 *
 * `Dialog` (Radix, via shadcn) replaces the hand-rolled fixed-overlay div
 * this used to be -- `open` is always true here since AdminDashboard only
 * mounts this component at all while `uploadModalOpen` is true; `onClose`
 * is passed straight through to `onOpenChange` so clicking the overlay,
 * pressing Escape, or the built-in close button all route through the same
 * cleanup AdminDashboard's own Cancel button used to trigger manually.
 */
export function UploadDatasetModal({
  token,
  onCreated,
  onClose,
}: {
  token: string;
  onCreated: (result: UploadCreateResult) => void;
  onClose: () => void;
}) {
  const { logout } = useAdminAuth();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createUpload(token, file, name, description.trim() || undefined);
      onCreated(result);
    } catch (err) {
      // A 401 here means the token expired before the upload even started
      // -- logout() + RequireAdmin's redirect, same as every other admin
      // form's identical branch.
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      // createUpload's catch already unwraps the backend's `detail` string
      // (e.g. "unsupported file type '.zip' -- ...", or a 409 slug
      // collision) -- shown verbatim since it's already curator-readable.
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Upload dataset</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-file">File</Label>
            <Input
              id="upload-file"
              type="file"
              required
              accept={ACCEPTED_EXTENSIONS.join(",")}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="h-auto py-1.5"
            />
            <span className="text-xs text-muted-foreground">Accepted: {ACCEPTED_EXTENSIONS.join(", ")} only.</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-name">Name</Label>
            <Input
              id="upload-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Used to derive the dataset's slug"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-description">Description (optional)</Label>
            <Textarea id="upload-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
