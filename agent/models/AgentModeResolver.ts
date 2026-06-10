import type { PluginOptions } from "../../types.js";

export class AgentModeResolver {
  constructor(private readonly options: PluginOptions) {}

  resolve(modeName?: string | null) {
    return this.options.modes.find((mode) => mode.name === modeName) ?? this.options.modes[0];
  }
}
