import { useState } from "react";
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Upload dataset</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-600">
            &times;
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">File</span>
          <input
            type="file"
            required
            accept={ACCEPTED_EXTENSIONS.join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <span className="text-xs text-slate-400">Accepted: {ACCEPTED_EXTENSIONS.join(", ")} only.</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Used to derive the dataset's slug"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
