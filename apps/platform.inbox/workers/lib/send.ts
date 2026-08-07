// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * THE ONE SEND PATH. `POST /emails`, reply and forward all do the same six
 * things — validate the sender, mint a Message-ID, check the rate limit, store
 * attachments, write the SENT copy, defer delivery — and differ only in how
 * they thread. That was three copies, and the copies had drifted:
 *
 *   - the plain path omitted `in-reply-to`/`references` from the SENT row's
 *     `raw_headers` while still putting them on the wire, so the stored copy
 *     misdescribed the message that was actually sent;
 *   - reply and forward stamped `date` from two separate `new Date()` calls,
 *     one for the row and one for the headers, which can disagree by a ms.
 *
 * Both are fixed by there being one copy. Threading is the only parameter.
 */
import type { Context } from "hono";
import { sendEmail } from "../email-sender";
import { storeAttachments } from "./attachments";
import {
  SenderValidationError,
  buildThreadingHeaders,
  generateMessageId,
  validateSender,
} from "./email-helpers";
import type { MailboxContext } from "./mailbox";
import type { SendEmailRequestSchema } from "./schemas";
import { Folders } from "../../shared/folders";
import type { z } from "zod";

type AppContext = Context<MailboxContext>;
type SendEmailRequest = z.infer<typeof SendEmailRequestSchema>;

export interface Threading {
  /** The message this one answers, or `null` when it answers nothing. */
  readonly inReplyTo: string | null;
  /** The full References chain, oldest first. Empty for a message that starts a thread. */
  readonly references: readonly string[];
  /** `null` opens a new thread rooted at this message — what a forward does. */
  readonly threadId: string | null;
}

export interface SendOptions {
  readonly threading: Threading;
  /** A reply clears the unread flag on the thread it answers. Nothing else does. */
  readonly markThreadRead?: boolean;
  /** Names this path in the deferred-delivery log line: "Deferred <kind> delivery failed". */
  readonly kind: string;
}

const list = (value: string | string[]): string =>
  Array.isArray(value) ? value.join(", ") : value;

/**
 * The SENT copy, as a value — no bindings, no stub, no context.
 *
 * Kept pure and exported so the threading rules (which thread a message joins,
 * what lands in `raw_headers`) are testable without a Worker runtime. That is
 * the same trade the `core/` modules elsewhere in this repo make, and it is
 * the part of the send path most worth pinning down: it is where the three
 * copies had already drifted from one another.
 */
export function buildSentRow(
  body: SendEmailRequest,
  threading: Threading,
  identity: { messageId: string; outgoingMessageId: string; fromEmail: string; toStr: string },
  date: string,
) {
  const { to, cc, bcc, from, subject, html, text } = body;
  const { inReplyTo, references } = threading;

  return {
    id: identity.messageId,
    subject,
    sender: identity.fromEmail,
    recipient: identity.toStr,
    cc: cc ? list(cc).toLowerCase() : null,
    bcc: bcc ? list(bcc).toLowerCase() : null,
    date,
    body: html || text || "",
    in_reply_to: inReplyTo,
    email_references: references.length > 0 ? JSON.stringify(references) : null,
    thread_id: threading.threadId ?? identity.messageId,
    message_id: identity.outgoingMessageId,
    raw_headers: JSON.stringify([
      { key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
      { key: "to", value: list(to) },
      ...(cc ? [{ key: "cc", value: list(cc) }] : []),
      ...(bcc ? [{ key: "bcc", value: list(bcc) }] : []),
      { key: "subject", value: subject },
      { key: "date", value: date },
      { key: "message-id", value: `<${identity.outgoingMessageId}>` },
      ...(inReplyTo ? [{ key: "in-reply-to", value: `<${inReplyTo}>` }] : []),
      ...(references.length > 0
        ? [{ key: "references", value: references.map((r) => `<${r}>`).join(" ") }]
        : []),
    ]),
  };
}

/**
 * Write the SENT copy, hand the message to the Email binding, and answer 202.
 *
 * Delivery is deferred through `waitUntil`: the SENT copy is what the caller
 * is told about, and a failure to hand off is logged rather than surfaced.
 */
export async function sendFromMailbox(
  c: AppContext,
  body: SendEmailRequest,
  { threading, markThreadRead = false, kind }: SendOptions,
) {
  const mailboxId = c.req.param("mailboxId") ?? "";
  const { to, cc, bcc, from, subject, html, text, attachments } = body;

  let toStr: string, fromEmail: string, fromDomain: string;
  try {
    ({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
  } catch (e) {
    if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
    throw e;
  }

  const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
  const stub = c.var.mailboxStub;

  const rateLimitError = await stub.checkSendRateLimit();
  if (rateLimitError) return c.json({ error: rateLimitError }, 429);

  const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

  const { inReplyTo, references } = threading;
  const row = buildSentRow(
    body,
    threading,
    { messageId, outgoingMessageId, fromEmail, toStr },
    new Date().toISOString(),
  );

  await stub.createEmail(Folders.SENT, row, attachmentData);

  if (markThreadRead) await stub.markThreadRead(row.thread_id);

  c.executionCtx.waitUntil(
    sendEmail(c.env.EMAIL, {
      to,
      cc,
      bcc,
      from,
      subject,
      html,
      text,
      attachments: attachments?.map((att) => ({
        content: att.content,
        filename: att.filename,
        type: att.type,
        disposition: att.disposition,
        contentId: att.contentId,
      })),
      ...(inReplyTo ? { headers: buildThreadingHeaders(inReplyTo, references) } : {}),
    }).catch((e) => console.error(`Deferred ${kind} delivery failed:`, (e as Error).message)),
  );

  return c.json({ id: messageId, status: "sent" }, 202);
}
