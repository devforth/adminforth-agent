import type {
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
} from "adminforth";
import type {
  HandleEditTurnInput,
  HandleSpeechTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../../domain/turnTypes.js";
import type { PluginOptions } from "../../types.js";

export type SessionTurn = {
  id: string;
  prompt: string;
  response: string;
};

export type AgentEndpointsContext = {
  adminforth: IAdminForth;
  options: PluginOptions;
  handleTurn(input: HandleTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleEditTurn(input: HandleEditTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleSpeechTurn(input: HandleSpeechTurnInput): Promise<RunAndPersistAgentResponseResult | null>;
  steer(input: { sessionId: string; message: string }): { id: string; queued: number };
  runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput): Promise<RunAndPersistAgentResponseResult>;
  getSessionTurns(sessionId: string): Promise<SessionTurn[]>;
  createNewTurn(sessionId: string, prompt: string, response?: string): Promise<string>;
  createSystemTurn(sessionId: string, systemMessage: string): Promise<string>;
  appendSteerToCurrentTurn(sessionId: string, steerText: string): Promise<void>;
  handleChatSurfaceMessage(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
  ): Promise<void>;
};

export type CoreEndpointsContext = Pick<
  AgentEndpointsContext,
  "options" | "handleTurn" | "handleEditTurn" | "handleSpeechTurn" | "steer"
>;

export type SessionEndpointsContext = Pick<
  AgentEndpointsContext,
  "adminforth" | "options" | "getSessionTurns" | "createNewTurn"
  | "createSystemTurn" | "appendSteerToCurrentTurn"
>;

export type ChatSurfaceEndpointsContext = Pick<
  AgentEndpointsContext,
  | "adminforth"
  | "options"
  | "handleChatSurfaceMessage"
>;
