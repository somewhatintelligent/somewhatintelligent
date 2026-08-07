// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The shape of an email, and the one request body that is validated.
 *
 * Only the REQUEST is enforced — the routes hand-build their JSON responses,
 * and a response schema nothing parses against goes stale silently.
 */
import { z } from "zod";

// ── TypeScript Interfaces ──────────────────────────────────────────

export interface EmailMetadata {
  id: string;
  subject: string;
  sender: string;
  recipient: string;
  cc?: string | null;
  bcc?: string | null;
  date: string;
  read: boolean;
  starred: boolean;
  in_reply_to?: string | null;
  email_references?: string | null;
  thread_id?: string | null;
  folder_id?: string | null;
  snippet?: string | null;
}

export interface EmailFull extends EmailMetadata {
  body?: string | null;
  message_id?: string | null;
  raw_headers?: string | null;
  attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  content_id?: string | null;
  disposition?: string | null;
}

// ── Zod Schemas ────────────────────────────────────────────────────

const RecipientFieldSchema = z.union([z.email(), z.array(z.email()).min(1)]);

export const SendEmailRequestSchema = z
  .object({
    to: RecipientFieldSchema,
    cc: RecipientFieldSchema.optional(),
    bcc: RecipientFieldSchema.optional(),
    from: z.union([z.email(), z.object({ email: z.email(), name: z.string() })]),
    subject: z.string(),
    html: z.string().optional(),
    text: z.string().optional(),
    attachments: z
      .array(
        z.object({
          content: z.string(), // base64 encoded
          filename: z.string(),
          type: z.string(),
          disposition: z.enum(["attachment", "inline"]),
          contentId: z.string().optional(),
        }),
      )
      .optional(),
    in_reply_to: z.string().optional(),
    references: z.array(z.string()).optional(),
    thread_id: z.string().optional(),
  })
  .refine((data) => data.html || data.text, {
    message: "Either 'html' or 'text' must be provided",
  });
