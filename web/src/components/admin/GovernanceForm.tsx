import { useEffect, useState } from "react";
import { updateGovernance, UnauthorizedError, type AdminDataset, type GovernancePatch } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";

const SENSITIVITY_OPTIONS: AdminDataset["sensitivity"][] = ["public", "restricted", "withheld"];

type FieldKey = "description" | "source" | "license" | "attribution" | "sensitivity";

/** Just the governance fields this form edits, kept as their own shape so
 * "what did the form load" and "what should we diff against" are the exact
 * same object -- see buildPatch below. */
type FieldValues = Pick<AdminDataset, FieldKey>;

function fieldsOf(dataset: AdminDataset): FieldValues {
  return {
    description: dataset.description,
    source: dataset.source,
    license: dataset.license,
    attribution: dataset.attribution,
    sensitivity: dataset.sensitivity,
  };
}

/**
 * Real partial-update diff (brief point 6: "ONLY the fields that changed",
 * not "send everything every time") -- the backend 400s on an unknown field
 * and treats an empty body as an error too, so this also has to return
 * `null` when nothing changed rather than an empty object.
 */
function buildPatch(loaded: FieldValues, current: FieldValues): GovernancePatch | null {
  const patch: GovernancePatch = {};
  for (const key of Object.keys(loaded) as FieldKey[]) {
    if (loaded[key] !== current[key]) {
      // TS can't narrow "same key on both sides of a union-valued object"
      // through a generic loop, but every FieldKey's value type does match
      // GovernancePatch's -- this cast is the union-narrowing tax, not a
      // real type escape.
      (patch as Record<FieldKey, string>)[key] = current[key];
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Governance metadata editor (brief §13). Loads the dataset's current
 * values into local form state, then on Save computes a diff against that
 * SAME loaded snapshot rather than against the dataset prop directly --
 * that snapshot only updates after a successful save (see the effect
 * below), so typing into one field and saving doesn't accidentally also
 * resend an unrelated field that happens to differ from a stale prop.
 */
export function GovernanceForm({ token, dataset, onSaved }: { token: string; dataset: AdminDataset; onSaved: (updated: Partial<AdminDataset>) => void }) {
  const { logout } = useAdminAuth();
  const [loaded, setLoaded] = useState<FieldValues>(() => fieldsOf(dataset));
  const [values, setValues] = useState<FieldValues>(() => fieldsOf(dataset));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // Re-seed the form whenever a DIFFERENT dataset is selected (slug change),
  // not on every re-render of the same dataset -- otherwise a prop update
  // from the parent's own fetch could stomp on an in-progress edit.
  useEffect(() => {
    setLoaded(fieldsOf(dataset));
    setValues(fieldsOf(dataset));
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on slug change, see comment above
  }, [dataset.slug]);

  function setField<K extends FieldKey>(key: K, value: FieldValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    const patch = buildPatch(loaded, values);
    if (!patch) {
      setMessage({ kind: "success", text: "Nothing to save -- no fields changed." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await updateGovernance(token, dataset.slug, patch);
      setLoaded(values);
      setMessage({ kind: "success", text: "Governance updated." });
      onSaved(patch);
    } catch (err) {
      // A 401 here means the token expired/was revoked mid-session --
      // logout() clears it, and RequireAdmin (re-evaluated on the next
      // render, same context) sends the user back to /admin/login. No
      // point also setting an error message the user will never see.
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      setMessage({ kind: "error", text: "Could not save changes." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Description</span>
        <textarea
          value={values.description}
          onChange={(e) => setField("description", e.target.value)}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Source</span>
        <input
          type="text"
          value={values.source}
          onChange={(e) => setField("source", e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">License</span>
        <input
          type="text"
          value={values.license}
          onChange={(e) => setField("license", e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Attribution</span>
        <input
          type="text"
          value={values.attribution}
          onChange={(e) => setField("attribution", e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Sensitivity</span>
        <select
          value={values.sensitivity}
          onChange={(e) => setField("sensitivity", e.target.value as AdminDataset["sensitivity"])}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm capitalize focus:border-blue-500 focus:outline-none"
        >
          {SENSITIVITY_OPTIONS.map((opt) => (
            <option key={opt} value={opt} className="capitalize">
              {opt}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && (
          <p className={`text-sm ${message.kind === "success" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
        )}
      </div>
    </div>
  );
}
