import type { IAdminForth } from "adminforth";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentRuntime } from "./AgentRuntime.js";
import type { AgentToolProvider } from "../tools/AgentToolProvider.js";

export class AgentRuntimeFactory {
  constructor(
    private readonly getAdminforth: () => IAdminForth,
    private readonly getCheckpointer: () => BaseCheckpointSaver,
    private readonly toolProvider: AgentToolProvider,
    private readonly getName: () => string,
  ) {}

  create() {
    return new AgentRuntime({
      name: this.getName(),
      adminforth: this.getAdminforth(),
      checkpointer: this.getCheckpointer(),
      toolProvider: this.toolProvider,
    });
  }
}
