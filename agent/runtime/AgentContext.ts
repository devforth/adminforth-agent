import type { AdminUser } from "adminforth";
import { z } from "zod";
import type { AgentEventEmitter } from "../../agentEvents.js";
import type { SequenceDebugCollector } from "../middleware/sequenceDebug.js";
import type { CurrentPageContext } from "../tools/getUserLocation.js";
import type { AgentTurnContext } from "../turn/turnTypes.js";

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
  emit: z.custom<AgentEventEmitter>().optional(),
  sequenceDebugSink: z.custom<SequenceDebugCollector>(),
});

export function toLangchainAgentContext(
  context: AgentTurnContext & {
    adminBaseUrl: string;
    emit?: AgentEventEmitter;
    sequenceDebugSink: SequenceDebugCollector;
  },
) {
  return context;
}
