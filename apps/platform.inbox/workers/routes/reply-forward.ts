// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply and forward: the same send as `POST /emails`, threaded differently.
 *
 * A REPLY joins the original's thread and carries its References chain. A
 * FORWARD starts a fresh thread and carries nothing — it is a new message that
 * happens to quote an old one. Everything else lives in `lib/send.ts`.
 */
import type { Context } from "hono";
import { buildReferencesChain, resolveOriginalEmail } from "../lib/email-helpers";
import type { MailboxContext } from "../lib/mailbox";
import type { EmailFull } from "../lib/schemas";
import { SendEmailRequestSchema } from "../lib/schemas";
import { sendFromMailbox } from "../lib/send";

type AppContext = Context<MailboxContext>;

export async function handleReplyEmail(c: AppContext) {
  const body = SendEmailRequestSchema.parse(await c.req.json());
  const stub = c.var.mailboxStub;

  const rawOriginal = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
  if (!rawOriginal) return c.json({ error: "Original email not found" }, 404);

  // A draft answering a message threads against THAT message, not against itself.
  const original = await resolveOriginalEmail(stub, rawOriginal);
  const { originalMsgId, references, threadId } = buildReferencesChain(original);

  return sendFromMailbox(c, body, {
    threading: { inReplyTo: originalMsgId, references, threadId },
    markThreadRead: true,
    kind: "reply",
  });
}

export async function handleForwardEmail(c: AppContext) {
  const body = SendEmailRequestSchema.parse(await c.req.json());
  const stub = c.var.mailboxStub;

  // Read only to answer 404 for a forward of something that is not there. The
  // original's threading is deliberately unused — see the docblock above.
  const original = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
  if (!original) return c.json({ error: "Original email not found" }, 404);

  return sendFromMailbox(c, body, {
    threading: { inReplyTo: null, references: [], threadId: null },
    kind: "forward",
  });
}
