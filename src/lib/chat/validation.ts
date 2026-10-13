import { z } from "zod";

// Request rules for the chat API. Free of server imports so client
// components can share the limits.

export const MAX_DOCUMENTS_PER_CONVERSATION = 20;

/** Longest title a user can give a chat, in characters */
export const MAX_TITLE_LENGTH = 100;

const documentIdsSchema = z
  .array(z.string().min(1).max(100))
  .min(1, "Select at least one document.")
  .max(
    MAX_DOCUMENTS_PER_CONVERSATION,
    `You can chat with up to ${MAX_DOCUMENTS_PER_CONVERSATION} documents at once.`,
  )
  // Duplicates would make the ownership count check fail for valid IDs
  .transform((ids) => [...new Set(ids)]);

export const createConversationSchema = z.object({
  documentIds: documentIdsSchema,
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

export const updateConversationSchema = z
  .object({
    title: z
      .string()
      // Line breaks would only come from a paste; a title is one line
      .transform((title) => title.replace(/\s+/g, " ").trim())
      .pipe(
        z
          .string()
          .min(1, "Title can't be empty.")
          .max(MAX_TITLE_LENGTH, `Titles can be up to ${MAX_TITLE_LENGTH} characters.`),
      )
      .optional(),
    documentIds: documentIdsSchema.optional(),
  })
  .refine((changes) => changes.title !== undefined || changes.documentIds !== undefined, {
    message: "Nothing to update: send a title or documentIds.",
  });

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

/** The first problem with a request body for the API's `{ error }` response, e.g. "documentIds: Select at least one document." */
export function firstIssueMessage(error: z.ZodError): string {
  const [issue] = error.issues;
  return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}

/** Longest message a user can send, in characters */
export const MAX_MESSAGE_LENGTH = 10_000;

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1).max(100),
  message: z
    .string()
    .trim()
    .min(1, "Message can't be empty.")
    .max(MAX_MESSAGE_LENGTH, `Messages can be up to ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters.`),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
