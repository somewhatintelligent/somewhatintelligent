// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toolListMailboxes,
  toolListEmails,
  toolGetEmail,
  toolGetThread,
  toolSearchEmails,
  toolDraftReply,
  toolDraftEmail,
  toolUpdateDraft,
  toolDeleteEmail,
  toolSendReply,
  toolSendEmail,
  toolMarkEmailRead,
  toolMoveEmail,
} from "../lib/tools";
import {
  Folders,
  FOLDER_TOOL_DESCRIPTION,
  MOVE_FOLDER_TOOL_DESCRIPTION,
} from "../../shared/folders";
import type { Env } from "../types";

/** Wrap a plain result object into MCP content format. */
function mcpText(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

/** Wrap an error string into MCP error format. */
function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

/**
 * Wrap a result that may contain an `error` field into MCP format,
 * automatically setting isError when appropriate.
 */
function mcpResult(result: Record<string, unknown>) {
  if ("error" in result) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: true as const,
    };
  }
  return mcpText(result);
}

/**
 * EmailMCP — exposes email tools over the Model Context Protocol.
 *
 * Clients (ProtoAgent, Claude Code, Cursor, etc.) connect to the
 * `/mcp` endpoint and can list mailboxes, read/search emails,
 * draft replies, send messages, and manage folders.
 */
export class EmailMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "agentic-inbox",
    version: "1.0.0",
  });

  async init() {
    const env = this.env;

    /**
     * Verify a mailbox exists in R2 before operating on it.
     * Returns an MCP error response if the mailbox is not found, or null if valid.
     */
    const verifyMailbox = async (mailboxId: string) => {
      const obj = await env.BUCKET.head(`mailboxes/${mailboxId}.json`);
      if (!obj) {
        return mcpError(
          `Mailbox "${mailboxId}" not found. Use list_mailboxes to see available mailboxes.`,
        );
      }
      return null;
    };

    // ── list_mailboxes ─────────────────────────────────────────
    this.server.registerTool(
      "list_mailboxes",
      { description: "List all available mailboxes" },
      async () => {
        const result = await toolListMailboxes(env);
        return mcpText(result);
      },
    );

    // ── list_emails ────────────────────────────────────────────
    this.server.registerTool(
      "list_emails",
      {
        description:
          "List emails in a mailbox folder. Returns email metadata (id, subject, sender, recipient, date, read/starred status, thread_id).",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address (e.g. user@example.com)"),
          folder: z.string().default(Folders.INBOX).describe(FOLDER_TOOL_DESCRIPTION),
          limit: z.number().default(20).describe("Maximum number of emails to return"),
          page: z.number().default(1).describe("Page number for pagination"),
        },
      },
      async ({ mailboxId, folder, limit, page }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolListEmails(env, mailboxId, { folder, limit, page });
        return mcpText(result);
      },
    );

    // ── get_email ──────────────────────────────────────────────
    this.server.registerTool(
      "get_email",
      {
        description:
          "Get a single email with its full body content. Use this to read the actual content of an email.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          emailId: z.string().describe("The email ID to retrieve"),
        },
      },
      async ({ mailboxId, emailId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolGetEmail(env, mailboxId, emailId);
        if ("error" in result) {
          return {
            content: [{ type: "text" as const, text: "Email not found" }],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );

    // ── get_thread ─────────────────────────────────────────────
    this.server.registerTool(
      "get_thread",
      {
        description:
          "Get all emails in a conversation thread. Returns all messages sorted chronologically.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          threadId: z.string().describe("The thread_id to retrieve all messages for"),
        },
      },
      async ({ mailboxId, threadId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolGetThread(env, mailboxId, threadId);
        return mcpText(result);
      },
    );

    // ── search_emails ──────────────────────────────────────────
    this.server.registerTool(
      "search_emails",
      {
        description: "Search for emails matching a query across subject and body fields.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          query: z.string().describe("Search query to match against subject and body"),
          folder: z.string().optional().describe("Optional folder to restrict search to"),
        },
      },
      async ({ mailboxId, query, folder }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSearchEmails(env, mailboxId, { query, folder });
        return mcpText(result);
      },
    );

    // ── draft_reply ────────────────────────────────────────────
    this.server.registerTool(
      "draft_reply",
      {
        description:
          "Draft a reply to an email and save it to the Drafts folder. Does NOT send — saves a draft for review.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          originalEmailId: z.string().describe("The ID of the email being replied to"),
          to: z.email().describe("Recipient email address"),
          subject: z.string().describe("Subject line (usually 'Re: ...')"),
          bodyHtml: z.string().describe("The HTML body of the reply"),
        },
      },
      async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDraftReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
        });
        return mcpResult(result);
      },
    );

    // ── create_draft ───────────────────────────────────────────
    this.server.registerTool(
      "create_draft",
      {
        description: "Create a new draft email. Can be a new email or a reply draft.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          to: z.string().optional().describe("Recipient email address (optional for early drafts)"),
          subject: z.string().describe("Subject line"),
          bodyHtml: z.string().describe("The HTML body of the draft"),
          in_reply_to: z
            .string()
            .optional()
            .describe("The ID of the email this draft is replying to (optional)"),
          thread_id: z.string().optional().describe("Thread ID to attach this draft to (optional)"),
        },
      },
      async ({ mailboxId, to, subject, bodyHtml, in_reply_to, thread_id }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDraftEmail(env, mailboxId, {
          to: to || "",
          subject,
          body: bodyHtml,
          isPlainText: false,
          runVerifyDraft: true,
          in_reply_to,
          thread_id,
        });
        if ("error" in result) {
          return mcpResult(result);
        }
        // Map the response to match the original create_draft output shape
        return mcpText({
          status: "draft_created",
          draftId: result.draftId,
          threadId: result.threadId,
          message: "Draft created in Drafts folder.",
        });
      },
    );

    // ── update_draft ───────────────────────────────────────────
    this.server.registerTool(
      "update_draft",
      {
        description: "Update an existing draft email's content.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          draftId: z.string().describe("The ID of the draft to update"),
          to: z.string().optional().describe("Updated recipient email address"),
          subject: z.string().optional().describe("Updated subject line"),
          bodyHtml: z.string().optional().describe("Updated HTML body"),
        },
      },
      async ({ mailboxId, draftId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolUpdateDraft(env, mailboxId, {
          draftId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (result.error === "Draft not found") {
            return {
              content: [{ type: "text" as const, text: "Draft not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── delete_email ───────────────────────────────────────────
    this.server.registerTool(
      "delete_email",
      {
        description: "Permanently delete an email by ID.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          emailId: z.string().describe("The email ID to delete"),
        },
      },
      async ({ mailboxId, emailId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolDeleteEmail(env, mailboxId, emailId);
        return mcpResult(result);
      },
    );

    // ── send_reply ─────────────────────────────────────────────
    this.server.registerTool(
      "send_reply",
      {
        description: "Send a reply to an email. Only call after drafting and getting confirmation.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address to send from"),
          originalEmailId: z.string().describe("The ID of the email being replied to"),
          to: z.email().describe("Recipient email address"),
          subject: z.string().describe("Subject line"),
          bodyHtml: z.string().describe("The HTML body of the reply"),
        },
      },
      async ({ mailboxId, originalEmailId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSendReply(env, mailboxId, {
          originalEmailId,
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          // Preserve the original MCP error format for send failures
          if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          if (result.error === "Original email not found") {
            return {
              content: [{ type: "text" as const, text: "Original email not found" }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── send_email ─────────────────────────────────────────────
    this.server.registerTool(
      "send_email",
      {
        description: "Send a new email (not a reply). Only call after getting confirmation.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address to send from"),
          to: z.email().describe("Recipient email address"),
          subject: z.string().describe("Subject line"),
          bodyHtml: z.string().describe("The HTML body of the email"),
        },
      },
      async ({ mailboxId, to, subject, bodyHtml }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolSendEmail(env, mailboxId, {
          to,
          subject,
          bodyHtml,
        });
        if ("error" in result) {
          if (typeof result.error === "string" && result.error.startsWith("Failed to send")) {
            return {
              content: [{ type: "text" as const, text: result.error }],
              isError: true,
            };
          }
          return mcpResult(result);
        }
        return mcpText(result);
      },
    );

    // ── mark_email_read ────────────────────────────────────────
    this.server.registerTool(
      "mark_email_read",
      {
        description: "Mark an email as read or unread.",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          emailId: z.string().describe("The email ID"),
          read: z.boolean().describe("true to mark as read, false for unread"),
        },
      },
      async ({ mailboxId, emailId, read }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolMarkEmailRead(env, mailboxId, emailId, read);
        return mcpText(result);
      },
    );

    // ── move_email ─────────────────────────────────────────────
    this.server.registerTool(
      "move_email",
      {
        description: "Move an email to a different folder (inbox, sent, draft, archive, trash).",
        inputSchema: {
          mailboxId: z.string().describe("The mailbox email address"),
          emailId: z.string().describe("The email ID"),
          folderId: z.string().describe(MOVE_FOLDER_TOOL_DESCRIPTION),
        },
      },
      async ({ mailboxId, emailId, folderId }) => {
        const denied = await verifyMailbox(mailboxId);
        if (denied) return denied;
        const result = await toolMoveEmail(env, mailboxId, emailId, folderId);
        if ("error" in result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Failed to move email" }),
              },
            ],
            isError: true,
          };
        }
        return mcpText(result);
      },
    );
  }
}
