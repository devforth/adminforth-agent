import {
  type PluginsCommonOptions,
  type AdminUser,
  type HttpExtra,
  type AudioAdapter,
  type ChatSurfaceAdapter,
  type StorageAdapter,
} from "adminforth";
import type { AgentModeCompletionAdapter } from "./application/ports.js";

interface ISessionResource {
  resourceId: string;
  idField: string;
  titleField: string;
  /**
   * @deprecated Not used by the plugin — session turns are looked up via
   * `turnResource.sessionIdField`. Kept optional for backward compatibility;
   * will be removed in a future major version.
   */
  turnsField?: string;
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
  checkpointIdField?: string;
  /**
   * JSON field with the images attached to the prompt of the turn.
   * Required when `attachments` are enabled.
   */
  attachmentsField?: string;
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
   * Optional external chat surfaces, such as Telegram webhooks.
   */
  chatSurfaceAdapters?: ChatSurfaceAdapter[];

  /**
   * Lets users attach images (PNG, JPEG, WebP) to their messages. The images are kept by the
   * storage adapter and sent to the model of the mode, so the models of all modes must accept images.
   * Requires `turnResource.attachmentsField`.
   */
  attachments?: {
    /**
     * Storage for the images. Use an adapter instance of its own, not one shared with other plugins.
     */
    storageAdapter: StorageAdapter;
    /**
     * Max size of one image in megabytes. Default is 10.
     */
    maxFileSizeMb?: number;
    /**
     * Max number of images attached to one message. Default is 5.
     */
    maxFilesPerMessage?: number;
  };

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
   * @deprecated Not applied — reasoning effort is configured on the completion
   * adapter (e.g. `extraRequestBodyParameters.reasoning.effort`), not here.
   * Kept for backward compatibility; will be removed in a future major version.
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

  /**
   * Optional resource configuration for resolving chat users through OAuth external identities.
   */
  chatExternalIdentityResource?: {
    resourceId: string;
    adminUserIdField?: string;
    providerField?: string;
    subjectField?: string;
    externalUserIdField?: string;
    surfaces: Record<string, {
      provider: string;
    }>;
  };
}
