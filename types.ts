import  {type PluginsCommonOptions } from "adminforth";
import { type CompletionAdapter } from "adminforth";
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
}
