import  {type PluginsCommonOptions } from "adminforth";
import { type CompletionAdapter } from "adminforth";

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
}

export interface PluginOptions extends PluginsCommonOptions {
  /**
   * Adapter instance that will be used to generate responses. 
   * You can use any adapter that implements the CompletionAdapter interface, for example the OpenAIAdapter included in adminforth, 
   * or create your own that fetches responses from your custom backend.
   */
  completionAdapter: CompletionAdapter;

  /**
   * Max tokens for the generation.
   * Default is 1000
   */
  maxTokens?: number;

  /**
   * Response generation level.
   * Default is low
   */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

  sessionResource: ISessionResource;
  // turnResource: ITurnResource;
}
