import type {
  AdminUser,
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import type { ZodType } from "zod";
import type {
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../agentTurnService.js";
import type { ChatSurfaceAdapterWithConnectAction } from "../chatSurfaceService.js";
import type { PluginOptions } from "../types.js";

export type { ChatSurfaceAdapterWithConnectAction } from "../chatSurfaceService.js";

export type EndpointResponse = {
  setStatus: (code: number, message: string) => void;
};

export type SessionTurn = {
  prompt: string;
  response: string;
};

export type AgentEndpointsContext = {
  adminforth: IAdminForth;
  options: PluginOptions;
  parseBody<T>(schema: ZodType<T>, body: unknown, response: EndpointResponse): T | null;
  handleTurn(input: HandleTurnInput): Promise<RunAndPersistAgentResponseResult>;
  runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput): Promise<RunAndPersistAgentResponseResult>;
  getSessionTurns(sessionId: string): Promise<SessionTurn[]>;
  createNewTurn(sessionId: string, prompt: string, response?: string): Promise<string>;
  getChatSurfaceConnectActionAdapters(): ChatSurfaceAdapterWithConnectAction[];
  createChatSurfaceLinkToken(surface: string, adminUser: AdminUser): string;
  handleChatSurfaceMessage(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
  ): Promise<void>;
};

export type CoreEndpointsContext = Pick<
  AgentEndpointsContext,
  "options" | "parseBody" | "handleTurn" | "runAndPersistAgentResponse"
>;

export type SessionEndpointsContext = Pick<
  AgentEndpointsContext,
  "adminforth" | "options" | "parseBody" | "getSessionTurns" | "createNewTurn"
>;

export type ChatSurfaceEndpointsContext = Pick<
  AgentEndpointsContext,
  | "adminforth"
  | "options"
  | "getChatSurfaceConnectActionAdapters"
  | "createChatSurfaceLinkToken"
  | "handleChatSurfaceMessage"
>;
