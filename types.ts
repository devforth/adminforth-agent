import {
  type PluginsCommonOptions,
  type AdminUser,
  type HttpExtra,
  type AudioAdapter,
} from "adminforth";
import type { AgentModeCompletionAdapter } from "./agent/simpleAgent.js";

interface ISessionResource {
  resourceId: string;
  idField: string;
  titleField: string;
  turnsField: string;
  askerIdField: string;
  createdAtField: string;
}

interface ITurnResource {
  resourceId: string;
  idField: string;
  sessionIdField: string;
  createdAtField: string;
  promptField: string;
  responseField: string;
  debugField?: string;
}

interface ICheckpointResource {
  resourceId: string;
  idField: string;
  threadIdField: string;
  checkpointNamespaceField: string;
  checkpointIdField: string;
  parentCheckpointIdField: string;
  rowKindField: string;
  taskIdField: string;
  sequenceField: string;
  createdAtField: string;
  checkpointPayloadField: string;
  metadataPayloadField: string;
  writesPayloadField: string;
  schemaVersionField: string;
}

export interface PluginOptions extends PluginsCommonOptions {
  /**
   * Optional placeholder examples to preload for the chat textarea.
   * They are resolved once when the chat frontend loads.
   */
  placeholderMessages?: ((input: {
    adminUser: AdminUser;
    headers: HttpExtra["headers"];
  }) => string[] | Promise<string[]>);

  /**
   * Modes for the plugin.
   * Each mode can have its own configuration.
   * Each mode uses its own completion adapter instance.
   */
  modes: {
    name: string;
    completionAdapter: AgentModeCompletionAdapter;
  }[];

  /**
   * Optional audio adapter for speech-to-text and text-to-speech flows.
   */
  audioAdapter?: AudioAdapter;

  /**
   * Max tokens for the generation.
   * Default is 1000
   */
  maxTokens?: number;

  /**
   * Optional custom system prompt appended to the built-in agent system prompt.
   */
  systemPrompt?: string;

  /**
   * Response generation level.
   * Default is low
   */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

  /**
   * Resource configuration for sessions.
   */
  sessionResource: ISessionResource;
  
  /**
   * Resource configuration for turns.
   */
  turnResource: ITurnResource;

  /**
   * Makes chat sticky by default. By default this prop is false
   */
  stickByDefault?: boolean;

  /**
   * Optional resource configuration for a persistent LangGraph checkpointer.
   * Falls back to an in-memory MemorySaver when omitted.
   */
  checkpointResource?: ICheckpointResource;
}
