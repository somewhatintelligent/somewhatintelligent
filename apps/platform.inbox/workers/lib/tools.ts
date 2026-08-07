// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What the agent's and the MCP server's tools actually do.
 *
 * Each takes an `Env` and tool-specific params and returns a plain object;
 * the two callers wrap those in their own response formats.
 */

import type { EmailFull } from "./schemas";
import {
  getMailboxStub,
  getFullEmail,
  getFullThread,
  listMailboxes,
  generateMessageId,
  buildReferencesChain,
  buildThreadingHeaders,
} from "./email-helpers";
import { buildQuotedReplyBlock, textToHtml } from "../../shared/html";
import { verifyDraft } from "./ai";
import { sendEmail } from "../email-sender";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import type { MailboxDO } from "../durableObject";
import type { Threading } from "./send";

// ── Type casts for DO methods not on the base stub type ────────────
type MailboxSearchStub = {
  searchEmails: (options: { query: string; folder?: string }) => Promise<unknown>;
};

// ── list_mailboxes ─────────────────────────────────────────────────

export async function toolListMailboxes(env: Env) {
  return listMailboxes(env.BUCKET);
}

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
  env: Env,
  mailboxId: string,
  params: { folder: string; limit: number; page: number },
) {
  const stub = getMailboxStub(env, mailboxId);
  return stub.getEmails({
    folder: params.folder,
    limit: params.limit,
    page: params.page,
    sortColumn: "date",
    sortDirection: "DESC",
  });
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(env: Env, mailboxId: string, emailId: string) {
  const stub = getMailboxStub(env, mailboxId);
  const email = await getFullEmail(stub, emailId);
  if (!email) return { error: "Email not found" };
  return email;
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(env: Env, mailboxId: string, threadId: string) {
  const stub = getMailboxStub(env, mailboxId);
  return getFullThread(stub, threadId);
}

// ── search_emails ──────────────────────────────────────────────────

export async function toolSearchEmails(
  env: Env,
  mailboxId: string,
  params: { query: string; folder?: string },
) {
  const stub = getMailboxStub(env, mailboxId);
  return (stub as unknown as MailboxSearchStub).searchEmails({
    query: params.query,
    folder: params.folder,
  });
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Shared draft-reply logic.
 *
 * @param bodyInput - The reply body text. Can be plain text or HTML.
 * @param options.isPlainText - If true, body is treated as plain text and
 *   converted to HTML. If false, body is treated as HTML.
 * @param options.runVerifyDraft - If true, runs AI verifyDraft on the body.
 *   The agent and MCP both do this, but the agent does it on plain text
 *   while MCP does it on HTML.
 */
export async function toolDraftReply(
  env: Env,
  mailboxId: string,
  params: {
    originalEmailId: string;
    to: string;
    subject: string;
    body: string;
    isPlainText?: boolean;
    runVerifyDraft?: boolean;
  },
): Promise<
  | { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
  | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  // Verify/sanitize if requested
  let processedBody = params.body.trim();
  if (params.runVerifyDraft) {
    const sanitized = await verifyDraft(env.AI, processedBody);
    if (!sanitized) {
      return { error: "Draft verification failed — body could not be verified. Please try again." };
    }
    processedBody = sanitized;
  }

  // Convert plain text to HTML if needed
  if (params.isPlainText) {
    processedBody = textToHtml(processedBody);
  }

  const draftId = crypto.randomUUID();

  // Get the original email for thread_id and quoted text
  const original = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
  const threadId = original?.thread_id || params.originalEmailId;

  // Append quoted original message
  const quotedBlock = original
    ? buildQuotedReplyBlock({
        date: original.date,
        sender: original.sender || params.to,
        body: original.body ?? undefined,
      })
    : "";
  const bodyHtml = processedBody + quotedBlock;

  await stub.createEmail(
    Folders.DRAFT,
    {
      id: draftId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: params.to.toLowerCase(),
      date: new Date().toISOString(),
      body: bodyHtml,
      in_reply_to: params.originalEmailId,
      email_references: null,
      thread_id: threadId,
    },
    [],
  );

  return {
    status: "draft_saved",
    draftId,
    message: "Draft saved to Drafts folder. Review it and confirm to send.",
    draft: {
      originalEmailId: params.originalEmailId,
      to: params.to,
      subject: params.subject,
      body: params.isPlainText ? params.body.trim() : bodyHtml,
    },
  };
}

// ── draft_email (new email, not a reply) ───────────────────────────

export async function toolDraftEmail(
  env: Env,
  mailboxId: string,
  params: {
    to: string;
    subject: string;
    body: string;
    isPlainText?: boolean;
    runVerifyDraft?: boolean;
    /** Optional in_reply_to for create_draft style */
    in_reply_to?: string;
    /** Optional thread_id for create_draft style */
    thread_id?: string;
  },
): Promise<
  | {
      status: string;
      draftId: string;
      threadId?: string;
      message: string;
      draft?: Record<string, string>;
    }
  | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  let processedBody = params.body.trim();
  if (params.runVerifyDraft) {
    const sanitized = await verifyDraft(env.AI, processedBody);
    if (!sanitized) {
      return { error: "Draft verification failed — body could not be verified. Please try again." };
    }
    processedBody = sanitized;
  }

  if (params.isPlainText) {
    processedBody = textToHtml(processedBody);
  }

  const draftId = crypto.randomUUID();

  // Resolve thread ID
  let resolvedThreadId = params.thread_id;
  if (!resolvedThreadId && params.in_reply_to) {
    const original = (await stub.getEmail(params.in_reply_to)) as EmailFull | null;
    resolvedThreadId = original?.thread_id || params.in_reply_to;
  }
  if (!resolvedThreadId) {
    resolvedThreadId = draftId;
  }

  await stub.createEmail(
    Folders.DRAFT,
    {
      id: draftId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: (params.to || "").toLowerCase(),
      date: new Date().toISOString(),
      body: processedBody,
      in_reply_to: params.in_reply_to || null,
      email_references: null,
      thread_id: resolvedThreadId,
    },
    [],
  );

  return {
    status: "draft_saved",
    draftId,
    threadId: resolvedThreadId,
    message: "Draft saved to Drafts folder. Review it and confirm to send.",
    draft: {
      to: params.to,
      subject: params.subject,
      body: params.isPlainText ? params.body.trim() : processedBody,
    },
  };
}

// ── update_draft ───────────────────────────────────────────────────

export async function toolUpdateDraft(
  env: Env,
  mailboxId: string,
  params: {
    draftId: string;
    to?: string;
    subject?: string;
    bodyHtml?: string;
  },
): Promise<
  { status: string; newDraftId: string; oldDraftId: string; message: string } | { error: string }
> {
  const stub = getMailboxStub(env, mailboxId);

  const oldDraft = (await stub.getEmail(params.draftId)) as EmailFull | null;
  if (!oldDraft) {
    return { error: "Draft not found" };
  }

  // Verify the body BEFORE deleting the old draft to prevent data loss
  const newDraftId = crypto.randomUUID();
  const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
  const verifiedBody = await verifyDraft(env.AI, rawBody);

  if (!verifiedBody) {
    return {
      error: "Draft verification failed — keeping existing draft unchanged. Please try again.",
    };
  }

  await stub.deleteEmail(params.draftId);
  await stub.createEmail(
    Folders.DRAFT,
    {
      id: newDraftId,
      subject: params.subject ?? oldDraft.subject,
      sender: mailboxId.toLowerCase(),
      recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
      date: new Date().toISOString(),
      body: verifiedBody,
      in_reply_to: oldDraft.in_reply_to || null,
      email_references: oldDraft.email_references || null,
      thread_id: oldDraft.thread_id || newDraftId,
    },
    [],
  );

  return {
    status: "draft_updated",
    newDraftId,
    oldDraftId: params.draftId,
    message: "Draft updated in Drafts folder.",
  };
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
  env: Env,
  mailboxId: string,
  emailId: string,
  read: boolean,
) {
  const stub = getMailboxStub(env, mailboxId);
  await stub.updateEmail(emailId, { read });
  return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
  env: Env,
  mailboxId: string,
  emailId: string,
  folderId: string,
) {
  const stub = getMailboxStub(env, mailboxId);
  const success = await stub.moveEmail(emailId, folderId);
  if (success) {
    return { status: "moved", emailId, folder: folderId };
  }
  return { error: "Failed to move email" };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(env: Env, mailboxId: string, draftId: string) {
  const stub = getMailboxStub(env, mailboxId);
  const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
  if (!email) {
    return { error: "Draft not found" };
  }
  if (email.folder_id !== Folders.DRAFT) {
    return { error: "Cannot discard: email is not a draft" };
  }
  await stub.deleteEmail(draftId);
  return { status: "discarded", draftId };
}

// ── delete_email ───────────────────────────────────────────────────

export async function toolDeleteEmail(env: Env, mailboxId: string, emailId: string) {
  const stub = getMailboxStub(env, mailboxId);
  const result = await stub.deleteEmail(emailId);
  if (result === null) {
    return { error: "Email not found", emailId };
  }
  return { status: "deleted", emailId };
}

// ── send_reply / send_email ────────────────────────────────────────

type SendResult = { status: "sent"; messageId: string; message: string } | { error: string };
type SendParams = { to: string; subject: string; bodyHtml: string };

/**
 * The agent's send, once. `send_reply` and `send_email` differ only in whether
 * a thread is being answered — which decides the threading headers, the quoted
 * block, and the noun in the two messages the caller sees.
 *
 * DELIVERY COMES BEFORE THE SENT COPY here, unlike the HTTP routes: the tools
 * answer the model synchronously, so a send that fails must be reported as a
 * failure rather than left as a SENT row nothing delivered.
 */
async function toolSend(
  env: Env,
  stub: DurableObjectStub<MailboxDO>,
  mailboxId: string,
  params: SendParams,
  { threading, quote, noun }: { threading: Threading; quote: string; noun: string },
): Promise<SendResult> {
  const fromDomain = mailboxId.split("@")[1];
  if (!fromDomain) throw new Error("Invalid mailbox email address");
  const { messageId, outgoingMessageId } = generateMessageId(fromDomain);

  const sanitizedBody = await verifyDraft(env.AI, params.bodyHtml);
  if (!sanitizedBody) {
    return {
      error: "Draft verification failed — refusing to send unverified content. Please try again.",
    };
  }
  const html = sanitizedBody + quote;
  const { inReplyTo, references } = threading;

  try {
    await sendEmail(env.EMAIL, {
      to: params.to,
      from: mailboxId,
      subject: params.subject,
      html,
      ...(inReplyTo ? { headers: buildThreadingHeaders(inReplyTo, references) } : {}),
    });
  } catch (e) {
    console.error("Email send failed:", (e as Error).message);
    return { error: `Failed to send ${noun}: ${(e as Error).message}` };
  }

  await stub.createEmail(
    Folders.SENT,
    {
      id: messageId,
      subject: params.subject,
      sender: mailboxId.toLowerCase(),
      recipient: params.to.toLowerCase(),
      date: new Date().toISOString(),
      body: html,
      in_reply_to: inReplyTo,
      email_references: references.length > 0 ? JSON.stringify(references) : null,
      thread_id: threading.threadId ?? messageId,
      message_id: outgoingMessageId,
    },
    [],
  );

  const sent = noun === "reply" ? "Reply" : "Email";
  return { status: "sent", messageId, message: `${sent} sent to ${params.to}` };
}

export async function toolSendReply(
  env: Env,
  mailboxId: string,
  params: SendParams & { originalEmailId: string },
): Promise<SendResult> {
  const stub = getMailboxStub(env, mailboxId);

  const rateLimitError = await stub.checkSendRateLimit();
  if (rateLimitError) return { error: rateLimitError };

  const original = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
  if (!original) return { error: "Original email not found" };

  const { originalMsgId, references, threadId } = buildReferencesChain(original);

  return toolSend(env, stub, mailboxId, params, {
    threading: { inReplyTo: originalMsgId, references, threadId },
    quote: buildQuotedReplyBlock({
      date: original.date,
      sender: original.sender || params.to,
      body: original.body ?? undefined,
    }),
    noun: "reply",
  });
}

export async function toolSendEmail(
  env: Env,
  mailboxId: string,
  params: SendParams,
): Promise<SendResult> {
  const stub = getMailboxStub(env, mailboxId);

  const rateLimitError = await stub.checkSendRateLimit();
  if (rateLimitError) return { error: rateLimitError };

  return toolSend(env, stub, mailboxId, params, {
    threading: { inReplyTo: null, references: [], threadId: null },
    quote: "",
    noun: "email",
  });
}
