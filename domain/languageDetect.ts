import { logger } from "adminforth";
import type { PluginOptions } from "../types.js";

export type DetectedLanguage = {
  language: string;
  code: string; // ISO 639-1
  ambiguous: boolean;
};

export type PreviousUserMessage = {
  text: string;
};

const USER_LANGUAGE_OUTPUT_SCHEMA = {
  name: "user_language",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      language: {
        type: "string",
        description: "Full English language name, for example English, Ukrainian, French.",
      },
      code: {
        type: "string",
        description: "Uppercase ISO 639-1 two-letter language code, for example EN, UK, FR.",
      },
      ambiguous: {
        type: "boolean",
        description: "True if the user's language cannot be confidently detected from the message.",
      },
    },
    required: ["language", "code", "ambiguous"],
  },
} as const;

function parseUserLanguage(content: string | undefined): DetectedLanguage | null {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as DetectedLanguage;
    return {
      language: parsed.language,
      code: parsed.code,
      ambiguous: parsed.ambiguous,
    };
  } catch (error) {
    logger.warn(`Failed to parse detected user language: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function detectUserLanguage(
  completionAdapter: PluginOptions["modes"][number]["completionAdapter"],
  prompt: string,
  previousUserMessages: PreviousUserMessage[] = [],
): Promise<DetectedLanguage | null> {
  const previousMessages = previousUserMessages.length
    ? [
      "",
      "Previous user messages:",
      ...previousUserMessages.map((message) => message.text),
    ]
    : [];
  const response = await completionAdapter.complete({
    content: [
      "Detect the language the assistant should use for the current user message.",
      "Use recent conversation context only to resolve short or ambiguous current messages.",
      "Return only the requested structured output.",
      "The language must be the full English language name.",
      "The code must be an uppercase ISO 639-1 two-letter code like UK, EN, FR.",
      "Set ambiguous to true if the response language cannot be confidently detected from the current message or context.",
      ...previousMessages,
      "",
      "Current user message:",
      prompt,
    ].join("\n"),
    maxTokens: 80,
    outputSchema: USER_LANGUAGE_OUTPUT_SCHEMA,
    reasoningEffort: "none",
  });

  if (response.error) {
    logger.warn(`Failed to detect user language: ${response.error}`);
    return null;
  }

  return parseUserLanguage(response.content);
}
