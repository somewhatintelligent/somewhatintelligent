// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The threading rules of the one send path.
 *
 * `POST /emails`, reply and forward reach `buildSentRow` with three different
 * `Threading` values and nothing else different. These pin down what each of
 * those three produces — the drift between the old copies lived here.
 */
import { describe, expect, test } from "vite-plus/test";
import { buildSentRow, type Threading } from "../send";

const DATE = "2026-01-15T10:30:00.000Z";
const IDENTITY = {
  messageId: "msg-1",
  outgoingMessageId: "msg-1@example.com",
  fromEmail: "me@example.com",
  toStr: "you@example.com",
};

const BODY = {
  to: "you@example.com",
  from: "me@example.com",
  subject: "Subject",
  html: "<p>hi</p>",
} as Parameters<typeof buildSentRow>[0];

const headers = (row: ReturnType<typeof buildSentRow>) =>
  JSON.parse(row.raw_headers) as { key: string; value: string }[];
const header = (row: ReturnType<typeof buildSentRow>, key: string) =>
  headers(row).find((h) => h.key === key)?.value;

// The three threadings the routes actually pass.
const PLAIN: Threading = { inReplyTo: null, references: [], threadId: null };
const REPLY: Threading = {
  inReplyTo: "orig@x.com",
  references: ["a@x.com", "orig@x.com"],
  threadId: "t-1",
};
const FORWARD: Threading = { inReplyTo: null, references: [], threadId: null };

describe("a message that threads against nothing", () => {
  test("opens its own thread, rooted at itself", () => {
    expect(buildSentRow(BODY, PLAIN, IDENTITY, DATE).thread_id).toBe("msg-1");
  });

  test("stores no in_reply_to and no references", () => {
    const row = buildSentRow(BODY, PLAIN, IDENTITY, DATE);
    expect(row.in_reply_to).toBeNull();
    expect(row.email_references).toBeNull();
  });

  test("carries neither threading header", () => {
    const row = buildSentRow(BODY, PLAIN, IDENTITY, DATE);
    expect(header(row, "in-reply-to")).toBeUndefined();
    expect(header(row, "references")).toBeUndefined();
  });
});

describe("a reply", () => {
  test("joins the thread it was told to join, not its own", () => {
    expect(buildSentRow(BODY, REPLY, IDENTITY, DATE).thread_id).toBe("t-1");
  });

  test("stores the whole References chain, oldest first", () => {
    const row = buildSentRow(BODY, REPLY, IDENTITY, DATE);
    expect(JSON.parse(row.email_references!)).toEqual(["a@x.com", "orig@x.com"]);
  });

  test("the STORED headers carry the threading the wire copy carries", () => {
    const row = buildSentRow(BODY, REPLY, IDENTITY, DATE);
    expect(header(row, "in-reply-to")).toBe("<orig@x.com>");
    expect(header(row, "references")).toBe("<a@x.com> <orig@x.com>");
  });
});

describe("a forward", () => {
  test("starts a new thread — it quotes an old message, it does not answer one", () => {
    const row = buildSentRow(BODY, FORWARD, IDENTITY, DATE);
    expect(row.thread_id).toBe("msg-1");
    expect(row.in_reply_to).toBeNull();
    expect(row.email_references).toBeNull();
  });
});

describe("the row every send produces", () => {
  test("one timestamp, so the row and its date header cannot disagree", () => {
    const row = buildSentRow(BODY, PLAIN, IDENTITY, DATE);
    expect(row.date).toBe(DATE);
    expect(header(row, "date")).toBe(DATE);
  });

  test("addresses are lowercased on the row", () => {
    const row = buildSentRow({ ...BODY, cc: "LOUD@example.com" }, PLAIN, IDENTITY, DATE);
    expect(row.cc).toBe("loud@example.com");
  });

  test("an absent cc or bcc is null, and contributes no header", () => {
    const row = buildSentRow(BODY, PLAIN, IDENTITY, DATE);
    expect(row.cc).toBeNull();
    expect(row.bcc).toBeNull();
    expect(header(row, "cc")).toBeUndefined();
  });

  test("a list of recipients is joined for both the row and the header", () => {
    const row = buildSentRow(
      { ...BODY, to: ["a@x.com", "b@x.com"] } as typeof BODY,
      PLAIN,
      IDENTITY,
      DATE,
    );
    expect(header(row, "to")).toBe("a@x.com, b@x.com");
  });

  test("a named sender is rendered as `Name <address>`", () => {
    const row = buildSentRow(
      { ...BODY, from: { name: "Me", email: "me@example.com" } } as typeof BODY,
      PLAIN,
      IDENTITY,
      DATE,
    );
    expect(header(row, "from")).toBe("Me <me@example.com>");
  });

  test("a text-only message stores its text as the body", () => {
    const row = buildSentRow(
      { ...BODY, html: undefined, text: "plain" } as typeof BODY,
      PLAIN,
      IDENTITY,
      DATE,
    );
    expect(row.body).toBe("plain");
  });

  test("the Message-ID is stored bare and sent bracketed", () => {
    const row = buildSentRow(BODY, PLAIN, IDENTITY, DATE);
    expect(row.message_id).toBe("msg-1@example.com");
    expect(header(row, "message-id")).toBe("<msg-1@example.com>");
  });
});
