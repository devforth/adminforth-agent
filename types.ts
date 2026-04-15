import  {type PluginsCommonOptions } from "adminforth";
import { type CompletionAdapter } from "adminforth";

interface ISessionResource {
  resource_id: string;
  id_field: string;
  title_field: string;
  turns_field: string;
  asker_id_field: string;
  created_at_field: string;
}

interface ITurnResource {
  resource_id: string;
  id_field: string;
  session_id_field: string;
  created_at_field: string;
  prompt_field: string;
  response_field: string;
}

export interface PluginOptions extends PluginsCommonOptions {
  /**
   * Adapter instance that will be used to generate responses. 
   * You can use any adapter that implements the CompletionAdapter interface, for example the OpenAIAdapter included in adminforth, 
   * or create your own that fetches responses from your custom backend.
   */
  adapter: CompletionAdapter;

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
