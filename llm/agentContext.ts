import type { AdminUser } from "adminforth";
import { z } from "zod";
import type { AgentEventEmitter } from "../domain/agentEvents.js";
import type { SequenceDebugCollector } from "./middleware/sequenceDebug.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentTurnContext } from "../domain/turnTypes.js";
import type { DetectedLanguage } from "../domain/languageDetect.js";

export const contextSchema = z.object({
  adminUser: z.custom<AdminUser>(),
  userTimeZone: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  abortSignal: z.custom<AbortSignal>().optional(),
  currentPage: z.custom<CurrentPageContext>().optional(),
  chatSurface: z.string().optional(),
  adminBaseUrl: z.string().optional(),
  adminPublicOrigin: z.string().optional(),
  userLanguage: z.custom<DetectedLanguage | null>().optional(),
  emit: z.custom<AgentEventEmitter>().optional(),
  sequenceDebugSink: z.custom<SequenceDebugCollector>(),
});

export type AgentContext = z.infer<typeof contextSchema>;

export function toLangchainAgentContext(
  context: AgentTurnContext & {
    adminBaseUrl: string;
    emit?: AgentEventEmitter;
    sequenceDebugSink: SequenceDebugCollector;
  },
) {
  return context;
}
