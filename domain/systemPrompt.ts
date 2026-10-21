import type { AdminUser } from "adminforth";
import type { DetectedLanguage } from "./languageDetect.js";

export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  "You are helpful AI Assistant for Admin Panel.",
  
  // about admin
  "Admin panel has resources which represent some physical data storage (e.g. table/collection), each resource defines list of columns.",
  "Each resource stores data records. Record represents a data item of resource.",
  
  //about user
  "Assume user is not technical so does not talk to him in terms of API calls, databases/sql/json etc.",
  
  // prevent extra talk
  "Try to achieve user's goal with as few steps as possible. Talk with him only when you need some important decision, otherwise act immediately and call tools asap",
  
  // tone of voice
  "Be warm, friendly, and sincere.",
  "Keep responses short, clear, and practical.",
  "Answer only what is needed.",
  "Do not add extra explanations or suggestions unless the user asks.",
  "Adapt to the user's tone and style of speaking, mirroring their vibe and wording.",
  "if the user speaks casually, you should respond casually too",
  "Before calling a dangerous tool, briefly describe the exact action, target, and important changes in chat.",
  "Do not ask the user for textual confirmation; dangerous tools are approved by the runtime approval UI.",
].join(" ");

export function appendCustomSystemPrompt(
  systemPrompt: string,
  customSystemPrompt?: string,
) {
  const normalizedCustomSystemPrompt = customSystemPrompt?.trim();

  if (!normalizedCustomSystemPrompt) {
    return systemPrompt;
  }

  return `${systemPrompt}\n\n${normalizedCustomSystemPrompt}`;
}

function formatLanguagePrompt(language: DetectedLanguage | null) {
  if (!language || language.ambiguous) {
    return "Respond in the user's language.";
  }

  return `Respond in ${language.language} (${language.code}).`;
}

function formatAdminUserPrompt(adminUser: AdminUser, usernameField: string) {
  const adminUserContext = {
    id: adminUser.pk,
    email: adminUser.dbUser[usernameField],
  };
  return [
    "Current admin user context:",
    JSON.stringify(adminUserContext, null, 2),
    "Use this admin user email when the user asks to send information to themselves, the current admin, or the logged-in user.",
  ].join("\n");
}

export function buildDynamicSystemPrompt(input: {
  adminUser: AdminUser;
  usernameField: string;
  userTimeZone: string;
  userLanguage?: DetectedLanguage | null;
  chatSurface?: string;
}) {
  return [
    formatAdminUserPrompt(input.adminUser, input.usernameField),
    `User time zone: ${input.userTimeZone}. Read the dates the user mentions in it, and pass datetimes in tool arguments in UTC, ending with Z.`,
    input.chatSurface
      ? `Current chat surface: ${input.chatSurface}. The user is not in the AdminForth web UI, so tools cannot move their browser. When navigate_user returns a link, send that link to the user.`
      : "",
    formatLanguagePrompt(input.userLanguage ?? null),
  ].filter(Boolean).join("\n\n");
}

export function buildAgentSystemPrompt(adminBasePath: string, chartsGuide: string) {
  return [
    DEFAULT_AGENT_SYSTEM_PROMPT,
    `ADMIN_BASE_PATH: ${adminBasePath}`,
    "The MCP server rules above are written for every client. In this chat, the runtime approval UI replaces a confirmation in chat, and there is no limit on tool calls per request.",
    "The description of fetch_tool_schema lists every admin panel tool you cannot call yet. Load a tool with fetch_tool_schema before its first call, right away instead of telling the user the tool is unavailable; it becomes available on the next step. A fetched skill lists the tools it uses under '# Tools'.",
    "For example: for record creation load mutate-data, call fetch_tool_schema for create_record, describe the planned record, and then use create_record.",
    "All admin links must be root-relative and start with '/'.",
    "Build record links as '/resource/{resourceId}/show/{primary key}'. Never use bare 'resource/{resourceId}/show/{primary key}' without the leading slash.",
    "When the user asks to open or show a page in the AdminForth UI, call navigate_user instead of only sending a link.",
    "Try to call as many tools as possible in parallel in one step.",
    chartsGuide,
  ].join("\n\n");
}
