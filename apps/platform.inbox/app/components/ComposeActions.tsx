// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";

/**
 * Discard / Save as Draft / Send — the same three buttons in the compose
 * DIALOG and the compose PANEL, which differ only in what discarding closes.
 *
 * The disabled rules are the point of sharing this: each action is disabled
 * while the OTHER is in flight, so a draft cannot be saved mid-send and a
 * send cannot start mid-save.
 */
export function ComposeActions({
  onDiscard,
  onSaveDraft,
  isSending,
  isSavingDraft,
}: {
  onDiscard: () => void;
  onSaveDraft: () => void;
  isSending: boolean;
  isSavingDraft: boolean;
}) {
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={isSending}>
        Discard
      </Button>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={isSavingDraft}
          disabled={isSending}
          icon={<FloppyDiskIcon size={14} />}
          onClick={onSaveDraft}
        >
          {isSavingDraft ? "Saving..." : "Save as Draft"}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={isSending}
          disabled={isSavingDraft || isSending}
          icon={<PaperPlaneTiltIcon size={14} />}
        >
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
    </>
  );
}
