import type {
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import type {
  HandleSpeechTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../agentTurnService.js";
import type { PluginOptions } from "../types.js";

export type SessionTurn = {
  prompt: string;
  response: string;
};

export type AgentEndpointsContext = {
  adminforth: IAdminForth;
  options: PluginOptions;
  handleTurn(input: HandleTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleSpeechTurn(input: HandleSpeechTurnInput): Promise<RunAndPersistAgentResponseResult | null>;
  runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput): Promise<RunAndPersistAgentResponseResult>;
  getSessionTurns(sessionId: string): Promise<SessionTurn[]>;
  createNewTurn(sessionId: string, prompt: string, response?: string): Promise<string>;
  createSystemTurn(sessionId: string, systemMessage: string): Promise<string>;
  handleChatSurfaceMessage(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
  ): Promise<void>;
};

export type CoreEndpointsContext = Pick<
  AgentEndpointsContext,
  "options" | "handleTurn" | "handleSpeechTurn"
>;

export type SessionEndpointsContext = Pick<
  AgentEndpointsContext,
  "adminforth" | "options" | "getSessionTurns" | "createNewTurn"
  | "createSystemTurn"
>;

export type ChatSurfaceEndpointsContext = Pick<
  AgentEndpointsContext,
  | "adminforth"
  | "options"
  | "handleChatSurfaceMessage"
>;
