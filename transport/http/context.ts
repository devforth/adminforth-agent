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
import type { TurnAttachment } from "../../domain/turnTypes.js";
import type { ImageAttachmentsLimits } from "../../domain/imageAttachments.js";

export type SessionTurn = {
  id: string;
  prompt: string;
  response: string;
  attachments: TurnAttachment[];
};

export type AgentEndpointsContext = {
  adminforth: IAdminForth;
  options: PluginOptions;
  imageAttachmentsLimits: ImageAttachmentsLimits;
  handleTurn(input: HandleTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleEditTurn(input: HandleEditTurnInput): Promise<RunAndPersistAgentResponseResult>;
  handleSpeechTurn(input: HandleSpeechTurnInput): Promise<RunAndPersistAgentResponseResult | null>;
  steer(input: { sessionId: string; message: string; adminUser: any }): Promise<{ id: string; queued: number }>;
  createAttachmentUploadUrl(input: {
    sessionId: string;
    filename: string;
    contentType: string;
    size: number;
    adminUser: AdminUser;
  }): Promise<{
    uploadUrl: string;
    uploadExtraParams?: Record<string, string>;
    contentType: string;
    filePath: string;
    previewUrl: string;
    token: string;
  }>;
  runAndPersistAgentResponse(input: RunAndPersistAgentResponseInput): Promise<RunAndPersistAgentResponseResult>;
  getSessionTurns(sessionId: string): Promise<SessionTurn[]>;
  getPendingApprovals(sessionId: string, adminUser: AdminUser): Promise<ApprovalDescription[]>;
  createNewTurn(sessionId: string, prompt: string, attachments?: string[]): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
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
  "options" | "imageAttachmentsLimits" | "handleTurn" | "handleEditTurn" | "handleSpeechTurn" | "steer"
  | "createAttachmentUploadUrl"
>;

export type SessionEndpointsContext = Pick<
  AgentEndpointsContext,
  "adminforth" | "options" | "getSessionTurns" | "getPendingApprovals" | "createNewTurn"
  | "createSystemTurn" | "appendSteerToCurrentTurn" | "deleteSession"
>;

export type ChatSurfaceEndpointsContext = Pick<
  AgentEndpointsContext,
  | "adminforth"
  | "options"
  | "handleChatSurfaceMessage"
>;
