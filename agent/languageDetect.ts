import { logger } from "adminforth";
import type { PluginOptions } from "../types.js";

export type UserLanguage = {
  language: string;
  code: string;
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
        description: "Uppercase two-letter language code, for example EN, UA, FR.",
      },
    },
    required: ["language", "code"],
  },
} as const;

export function formatLanguagePrompt(language: UserLanguage | null) {
  if (!language) {
    return "Respond in the user's language.";
  }

  return `Respond in ${language.language} (${language.code}).`;
}

function parseUserLanguage(content: string | undefined): UserLanguage | null {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as UserLanguage;
    return {
      language: parsed.language,
      code: parsed.code,
    };
  } catch (error) {
    logger.warn(`Failed to parse detected user language: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function detectUserLanguage(
  completionAdapter: PluginOptions["modes"][number]["completionAdapter"],
  prompt: string,
): Promise<UserLanguage | null> {
  const response = await completionAdapter.complete({
    content: [
      "Detect the language of the user's message.",
      "Return only the requested structured output.",
      "The language must be the full English language name.",
      "The code must be an uppercase two-letter code like EN, UA, FR.",
      "",
      "User message:",
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
