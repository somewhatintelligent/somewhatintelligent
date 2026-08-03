// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vite-plus/test";
import {
  FOLDER_DISPLAY_NAMES,
  FOLDER_TOOL_DESCRIPTION,
  Folders,
  getFolderDisplayName,
  MOVE_FOLDER_TOOL_DESCRIPTION,
  SYSTEM_FOLDER_IDS,
} from "../folders";

describe("Folders", () => {
  it("defines the six canonical folder ids", () => {
    expect(Folders).toEqual({
      INBOX: "inbox",
      SENT: "sent",
      DRAFT: "draft",
      ARCHIVE: "archive",
      TRASH: "trash",
      SPAM: "spam",
    });
  });
});

describe("SYSTEM_FOLDER_IDS", () => {
  it("lists the sidebar folders in display order, excluding spam", () => {
    expect(SYSTEM_FOLDER_IDS).toEqual([
      Folders.INBOX,
      Folders.SENT,
      Folders.DRAFT,
      Folders.ARCHIVE,
      Folders.TRASH,
    ]);
    expect(SYSTEM_FOLDER_IDS).not.toContain(Folders.SPAM);
  });
});

describe("getFolderDisplayName", () => {
  it("returns the known display name for each canonical folder id", () => {
    expect(getFolderDisplayName("inbox")).toBe("Inbox");
    expect(getFolderDisplayName("sent")).toBe("Sent");
    expect(getFolderDisplayName("draft")).toBe("Drafts");
    expect(getFolderDisplayName("archive")).toBe("Archive");
    expect(getFolderDisplayName("trash")).toBe("Trash");
    expect(getFolderDisplayName("spam")).toBe("Spam");
  });

  it("is case-insensitive on lookup", () => {
    expect(getFolderDisplayName("INBOX")).toBe("Inbox");
    expect(getFolderDisplayName("Inbox")).toBe("Inbox");
  });

  it("falls back to a capitalized raw id for unknown/custom folders", () => {
    expect(getFolderDisplayName("projects")).toBe("Projects");
    expect(getFolderDisplayName("q4-launch")).toBe("Q4-launch");
  });

  it("stays consistent with FOLDER_DISPLAY_NAMES for every canonical id", () => {
    for (const id of Object.values(Folders)) {
      expect(getFolderDisplayName(id)).toBe(FOLDER_DISPLAY_NAMES[id]);
    }
  });
});

describe("tool description strings", () => {
  it("mention every non-spam folder", () => {
    for (const label of ["inbox", "sent", "draft", "archive", "trash"]) {
      expect(FOLDER_TOOL_DESCRIPTION).toContain(label);
      expect(MOVE_FOLDER_TOOL_DESCRIPTION).toContain(label);
    }
  });
});
