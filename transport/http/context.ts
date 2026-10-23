import type {
  AdminUser,
  ChatSurfaceAdapter,
  ChatSurfaceEventSink,
  ChatSurfaceIncomingMessage,
  IAdminForth,
  IAdminForthEndpointHandlerInput,
} from "adminforth";
import type {
  HandleEditTurnInput,
  HandleSpeechTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "../../domain/turnTypes.js";
import type { PluginOptions } from "../../types.js";
import type { ApprovalDescription } from "../../tools/approvalFormatter.js";
import type { AgentAttachment } from "../../domain/attachments.js";
import type { AttachmentStore } from "../../persistence/attachmentStore.js";

export type SessionTurn = {
  id: string;
  prompt: string;
  response: string;
  attachments: AgentAttachment[];
};

export type AgentEndpointsContext = {
  adminforth: IAdminForth;
  options: PluginOptions;
  /** Null when image attachments are not enabled. */
  attachmentStore: AttachmentStore | null;
  handleTurn(input: HandleTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleEditTurn(input: HandleEditTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleSpeechTurn(input: HandleSpeechTurnInput): Promise<RunAndPersistAgentResponseResult | null>;
  steer(input: { sessionId: string; message: string; adminUser: any }): Promise<{ id: string; queued: number }>;
  runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput): Promise<RunAndPersistAgentResponseResult>;
  getSessionTurns(sessionId: string): Promise<SessionTurn[]>;
  getPendingApprovals(sessionId: string, adminUser: AdminUser): Promise<ApprovalDescription[]>;
  createNewTurn(sessionId: string, prompt: string, attachments?: AgentAttachment[]): Promise<string>;
  deleteSessionTurns(sessionId: string): Promise<void>;
  createSystemTurn(sessionId: string, systemMessage: string): Promise<string>;
  appendSteerToCurrentTurn(sessionId: string, steerText: string): Promise<void>;
  handleChatSurfaceMessage(
    adapter: ChatSurfaceAdapter,
    incoming: ChatSurfaceIncomingMessage,
    sink: ChatSurfaceEventSink,
    request: IAdminForthEndpointHandlerInput,
  ): Promise<void>;
};

export type CoreEndpointsContext = Pick<
  AgentEndpointsContext,
  "options" | "attachmentStore" | "handleTurn" | "handleEditTurn" | "handleSpeechTurn" | "steer"
>;

export type SessionEndpointsContext = Pick<
  AgentEndpointsContext,
  "adminforth" | "options" | "attachmentStore" | "getSessionTurns" | "getPendingApprovals" | "createNewTurn"
  | "deleteSessionTurns" | "createSystemTurn" | "appendSteerToCurrentTurn"
>;

export type AttachmentEndpointsContext = Pick<AgentEndpointsContext, "attachmentStore">;

export type ChatSurfaceEndpointsContext = Pick<
  AgentEndpointsContext,
  | "adminforth"
  | "options"
  | "handleChatSurfaceMessage"
>;
