import {
  type PluginsCommonOptions,
  type CompletionAdapter,
  type AdminUser,
  type HttpExtra,
} from "adminforth";

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
    httpExtra: HttpExtra;
  }) => string[] | Promise<string[]>);

  /**
   * Modes for the plugin.
   * Each mode can have its own configuration.
   * Each mode uses its own completion adapter instance.
   */
  modes: {
    name: string;
    completionAdapter: CompletionAdapter;
  }[];

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
   * Optional resource configuration for a persistent LangGraph checkpointer.
   * Falls back to an in-memory MemorySaver when omitted.
   */
  checkpointResource?: ICheckpointResource;
}
