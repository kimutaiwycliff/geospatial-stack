import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { deleteDataset, UnauthorizedError, type AdminDataset, type DraftStyle } from "../../lib/adminApi";
import { useAdminAuth } from "../../lib/adminAuth";
import { AuditLogPanel } from "./AuditLogPanel";
import { GovernanceForm } from "./GovernanceForm";
import { StylingPanel } from "./StylingPanel";
import { UploadStatusPanel } from "./UploadStatusPanel";

type Tab = "governance" | "styling" | "publishing";

/**
 * Governance + styling for one selected dataset, in a single view (brief
 * point 4: "click into a dataset to edit its governance fields AND its
 * draft style in one view -- a two-tab or two-panel layout is fine"). Tabs
 * chosen over side-by-side panels purely because the styling controls
 * (color swatch + slider) and the governance fields (five text inputs) are
 * different enough widths that stacking them side by side either wastes
 * space or squeezes the text inputs -- tabs let each keep its natural
 * width. Audit history stays visible under both tabs rather than being a
 * third tab, since "what happened to this dataset" is relevant regardless
 * of which editor you're currently in -- so it's rendered OUTSIDE
 * `<Tabs>`/`<TabsContent>` entirely, not as a fourth `TabsContent` that
 * would just be duplicated three times.
 */
export function DatasetDetail({
  token,
  dataset,
  draft,
  onGovernanceSaved,
  onDraftSaved,
  onDatasetPatch,
  onDeleted,
}: {
  token: string;
  dataset: AdminDataset;
  draft: DraftStyle | null;
  onGovernanceSaved: (patch: Partial<AdminDataset>) => void;
  onDraftSaved: (draft: DraftStyle) => void;
  /** Same "patch the list's copy of this row" callback as onGovernanceSaved,
   * just under its own name here -- UploadStatusPanel patches tier_status/
   * serve_mode/validation_report, not governance fields, so reusing
   * `onGovernanceSaved`'s name at this call site would read backwards even
   * though both ultimately call the same merge function in AdminDashboard. */
  onDatasetPatch: (patch: Partial<AdminDataset>) => void;
  /** Called once the backend confirms the delete -- AdminDashboard removes
   * this row from its list and clears the selection, since this whole
   * component is about to stop having a dataset to render at all. */
  onDeleted: () => void;
}) {
  const { logout } = useAdminAuth();
  const [tab, setTab] = useState<Tab>("governance");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteDataset(token, dataset.slug);
      toast.success(`Deleted "${dataset.name}".`);
      setConfirmOpen(false);
      onDeleted();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        logout();
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not delete this dataset.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    // AdminDashboard now mounts a fresh instance of this component per
    // selected dataset (`key={selected.slug}`) specifically so this fade-in
    // replays on every selection, not just the very first -- the brief's
    // "AdminDashboard's dataset detail panel appearing when a dataset is
    // selected" animation.
    <div className="flex flex-col gap-4 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{dataset.name}</h2>
          <p className="text-xs text-muted-foreground">
            {dataset.slug} &middot; tier: {dataset.tier_status}
          </p>
        </div>
        {/* No tier_status gating here on purpose -- an admin needs to
            delete a dataset that's still validating, failed validation, or
            is already published, all the same way (unlike Approve above,
            which IS gated on validation having passed). */}
        <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
          Delete dataset
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !deleting && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete "{dataset.name}"?</DialogTitle>
            <DialogDescription>
              This permanently removes the dataset's registry entry, its raw/curated data, any published table
              and tiles, and the originally uploaded file. There is no undo short of a backup restore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="styling">Styling</TabsTrigger>
          <TabsTrigger value="publishing">Publishing</TabsTrigger>
        </TabsList>

        <TabsContent value="governance">
          <GovernanceForm token={token} dataset={dataset} onSaved={onGovernanceSaved} />
        </TabsContent>
        <TabsContent value="styling">
          <StylingPanel key={dataset.slug} token={token} slug={dataset.slug} draft={draft} onDraftSaved={onDraftSaved} />
        </TabsContent>
        <TabsContent value="publishing">
          <UploadStatusPanel key={dataset.slug} token={token} dataset={dataset} onStatusChange={onDatasetPatch} />
        </TabsContent>
      </Tabs>

      <AuditLogPanel key={`audit:${dataset.slug}`} token={token} slug={dataset.slug} />
    </div>
  );
}
