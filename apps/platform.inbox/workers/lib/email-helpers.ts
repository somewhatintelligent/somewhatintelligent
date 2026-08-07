// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared email helpers for the API routes, MCP and the agent: DO stubs, sender
 * validation, message-ID generation, threading, and the two full-body reads.
 *
 * HTML escaping and quoting live in `shared/html.ts` — the browser needs them too.
 */
import type { MailboxDO } from "../durableObject";
import type { EmailFull } from "./schemas";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { stripHtmlToText } from "../../shared/html";

// ── DO Stub ────────────────────────────────────────────────────────

/** The mailbox's Durable Object, addressed by its email. */
export function getMailboxStub(env: Env, mailboxId: string): DurableObjectStub<MailboxDO> {
  const ns = env.MAILBOX;
  const id = ns.idFromName(mailboxId);
  return ns.get(id);
}

// ── Mailbox Listing ────────────────────────────────────────────────

/** Every mailbox, read off the R2 keys rather than a listing. */
export async function listMailboxes(bucket: R2Bucket): Promise<{ id: string; email: string }[]> {
  const list = await bucket.list({ prefix: "mailboxes/" });
  return list.objects.map((obj) => {
    const id = obj.key.replace("mailboxes/", "").replace(".json", "");
    return { id, email: id };
  });
}

// ── Sender Validation ──────────────────────────────────────────────

/**
 * Normalised addresses, or a `SenderValidationError` carrying a message the
 * caller can hand to the user unchanged.
 */
export function validateSender(
  to: string | string[],
  from: string | { email: string; name: string },
  mailboxId: string,
): { toStr: string; fromEmail: string; fromDomain: string } {
  const toStr = (Array.isArray(to) ? to.join(", ") : to).toLowerCase();
  const fromEmail = (typeof from === "string" ? from : from.email).toLowerCase();

  if (fromEmail !== mailboxId.toLowerCase()) {
    throw new SenderValidationError("From address must match the mailbox email address");
  }

  const fromDomain = fromEmail.split("@")[1];
  if (!fromDomain) {
    throw new SenderValidationError("Invalid sender email address");
  }

  return { toStr, fromEmail, fromDomain };
}

export class SenderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SenderValidationError";
  }
}

// ── Message ID ─────────────────────────────────────────────────────

/** An internal UUID, and the RFC 2822 Message-ID derived from it. */
export function generateMessageId(fromDomain: string): {
  messageId: string;
  outgoingMessageId: string;
} {
  const messageId = crypto.randomUUID();
  const outgoingMessageId = `${messageId}@${fromDomain}`;
  return { messageId, outgoingMessageId };
}

// ── Threading ──────────────────────────────────────────────────────

/** The In-Reply-To, References chain and thread a reply to this message takes. */
export function buildReferencesChain(original: EmailFull): {
  originalMsgId: string;
  references: string[];
  threadId: string;
} {
  const originalMsgId = original.message_id || original.id;
  let existingRefs: string[] = [];
  if (original.email_references) {
    try {
      existingRefs = JSON.parse(original.email_references);
    } catch {
      // Malformed JSON in email_references — treat as empty
    }
  }
  const references = [...existingRefs, originalMsgId].filter(Boolean);
  const threadId = original.thread_id || original.id;
  return { originalMsgId, references, threadId };
}

/** In-Reply-To plus, when there is a chain to carry, References. */
export function buildThreadingHeaders(
  originalMsgId: string,
  references: readonly string[],
): Record<string, string> {
  return {
    "In-Reply-To": `<${originalMsgId}>`,
    ...(references.length > 0 ? { References: references.map((r) => `<${r}>`).join(" ") } : {}),
  };
}

// ── Draft-follows-in_reply_to ──────────────────────────────────────

/**
 * If the given email is a draft with an in_reply_to, resolve the real original.
 * Used by reply/forward routes to avoid threading against the draft itself.
 */
export async function resolveOriginalEmail(
  stub: DurableObjectStub<MailboxDO>,
  email: EmailFull,
): Promise<EmailFull> {
  if (email.folder_id === Folders.DRAFT && email.in_reply_to) {
    const realOriginal = (await stub.getEmail(email.in_reply_to)) as EmailFull | null;
    if (realOriginal) return realOriginal;
  }
  return email;
}

// ── Tool Logic (getFullEmail / getFullThread) ──────────────────────

type MailboxThreadReaderStub = {
  getThreadEmails: (threadId: string) => Promise<EmailFull[]>;
};

/** One email carrying both bodies, or `null` if there is no such email. */
export async function getFullEmail(stub: DurableObjectStub<MailboxDO>, emailId: string) {
  const email = (await stub.getEmail(emailId)) as EmailFull | null;
  if (!email) return null;

  const textBody = email.body ? stripHtmlToText(email.body) : "";
  return { ...email, body_text: textBody, body_html: email.body };
}

/**
 * A whole thread, bodies included, in ONE DO call — `getThreadEmails` costs two
 * SQL queries where reading each message costs one per message.
 */
export async function getFullThread(stub: DurableObjectStub<MailboxDO>, threadId: string) {
  const threadStub = stub as unknown as MailboxThreadReaderStub;
  const emails = await threadStub.getThreadEmails(threadId);

  const enriched = emails.map((email) => {
    const textBody = email.body ? stripHtmlToText(email.body) : "";
    return { ...email, body_text: textBody };
  });

  // The DO query already orders these; re-sorting keeps the contract local.
  enriched.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return { thread_id: threadId, message_count: enriched.length, messages: enriched };
}
