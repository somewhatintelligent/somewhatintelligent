/**
 * THE TWO-PHASE DELETE, as one control.
 *
 * Opening it PLANS: a call that mints a fresh confirmation token and computes,
 * against the live database, what would go and what would be retained. Nothing
 * is deleted. The operator then reads the impact and confirms with the token.
 *
 * WHY IT IS NOT A CONFIRM DIALOG. A confirm dialog asks "are you sure" about a
 * question the person cannot answer, because the blast radius of deleting a
 * product depends on how many releases and orders reference it. This shows the
 * counts. And because the impact was computed at plan time, a record that
 * changes in between fails the confirm with `deletion_plan_drift` rather than
 * deleting more than what was agreed to — which is the case a confirm dialog
 * cannot detect at all.
 *
 * `activeReleaseAffected` gets its own warning because it is the one outcome
 * that changes what shoppers see the instant it commits.
 */
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import { Button } from "platform.ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "platform.ui/components/dialog";
import { Alert, AlertDescription, AlertTitle } from "platform.ui/components/alert";
import { Spinner } from "platform.ui/components/spinner";

import type { DeletionPlan, DomainResult } from "../../domain/Contracts.ts";
import { commandId, refusalText } from "../lib/format.ts";
import { Outcome } from "./outcome.tsx";

type PlanResult = DomainResult<DeletionPlan, string>;
type ConfirmResult = DomainResult<unknown, string>;

export function DeletionDialog({
  label,
  description,
  plan,
  confirm,
  onDeleted,
  trigger,
}: {
  /** What is being deleted, in the operator's words. */
  label: string;
  description?: string;
  /** Mints the token and the impact. Called on open, and again on retry. */
  plan: () => Promise<PlanResult>;
  confirm: (input: { confirmationToken: string; commandId: string }) => Promise<ConfirmResult>;
  onDeleted: () => void | Promise<void>;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [planned, setPlanned] = useState<DeletionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const startPlanning = async () => {
    setBusy(true);
    setError(null);
    setPlanned(null);
    try {
      const result = await plan();
      if (result.ok) setPlanned(result.value);
      else setError(new Error(refusalText(result.error, result.message)));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void startPlanning();
    else {
      setPlanned(null);
      setError(null);
    }
  };

  const doConfirm = async () => {
    if (!planned) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirm({
        confirmationToken: planned.confirmationToken,
        /**
         * A COMMAND ID PER ATTEMPT of the confirm, while the confirmation token
         * stays fixed. The token is single-use and the domain guards the
         * delete by idempotency key, so this is what makes a retry after a
         * dropped connection a replay rather than a second delete.
         */
        commandId: commandId(),
      });
      if (result.ok) {
        setOpen(false);
        await onDeleted();
      } else {
        setError(new Error(refusalText(result.error, result.message)));
        // Drift and expiry are both recoverable by planning again, against
        // what the record looks like NOW.
        if (result.error === "deletion_plan_drift" || result.error === "deletion_plan_expired") {
          setPlanned(null);
        }
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const impact = planned?.impact;

  return (
    <>
      {trigger ? (
        <span onClick={() => onOpenChange(true)}>{trigger}</span>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => onOpenChange(true)}>
          <Trash2 />
          Delete
        </Button>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete {label}</DialogTitle>
            <DialogDescription>
              {description ?? "This is permanent. Read what goes before confirming."}
            </DialogDescription>
          </DialogHeader>

          {busy && !planned ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> Working out what this would remove…
            </div>
          ) : null}

          <Outcome error={error} />

          {impact ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Target</span>{" "}
                <span className="font-medium">{impact.label}</span>{" "}
                <span className="text-muted-foreground">({impact.targetType})</span>
              </p>

              {impact.activeReleaseAffected ? (
                <Alert variant="warning">
                  <AlertTriangle />
                  <AlertTitle>This touches the active release</AlertTitle>
                  <AlertDescription>
                    What shoppers currently see changes the moment this commits.
                  </AlertDescription>
                </Alert>
              ) : null}

              <CountList title="Deleted" counts={impact.deleteCounts} tone="destructive" />
              <CountList title="Retained" counts={impact.retainedCounts} tone="muted" />

              {impact.warnings.length > 0 ? (
                <Alert variant="warning">
                  <AlertTitle>Warnings</AlertTitle>
                  <AlertDescription>
                    <ul className="list-inside list-disc">
                      {impact.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              <p className="text-xs text-muted-foreground">
                Confirmation expires{" "}
                {new Date(planned.expiresAt).toLocaleTimeString("en-CA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                . After that, plan it again.
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {planned ? (
              <Button variant="destructive" onClick={() => void doConfirm()} disabled={busy}>
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void startPlanning()} disabled={busy}>
                Re-check
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * `deleteCounts` and `retainedCounts` are open records — the domain names the
 * rows it would touch — so this renders whatever keys arrive rather than a
 * fixed list that would silently omit a new one.
 */
function CountList({
  title,
  counts,
  tone,
}: {
  title: string;
  counts: Readonly<Record<string, number>>;
  tone: "destructive" | "muted";
}) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return (
    <div>
      <h3
        className={
          tone === "destructive"
            ? "text-sm font-semibold text-destructive"
            : "text-sm font-semibold text-muted-foreground"
        }
      >
        {title}
      </h3>
      <ul className="mt-1 grid grid-cols-2 gap-x-6 text-sm">
        {entries.map(([name, n]) => (
          <li key={name} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{name.replaceAll("_", " ")}</span>
            <span className="tnum font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
