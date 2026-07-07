import type {
  AdminForthResource,
  IAdminForth,
  IHttpServer,
} from "adminforth";

import { AdminForthPlugin, logger } from "adminforth";

import type { PluginOptions } from './types.js';
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AdminForthCheckpointSaver } from "./persistence/checkpointStore.js";
import { appendCustomSystemPrompt, buildAgentSystemPrompt, DEFAULT_AGENT_SYSTEM_PROMPT} from "./domain/systemPrompt.js";
import { setupCoreEndpoints } from "./transport/http/coreEndpoints.js";
import { setupSessionEndpoints } from "./transport/http/sessionEndpoints.js";
import { setupChatSurfaceEndpoints } from "./transport/http/chatSurfaceEndpoints.js";
import type { AgentEndpointsContext } from "./transport/http/context.js";
import { AgentSessionStore } from "./persistence/sessionStore.js";
import { ChatSurfaceService } from "./transport/surfaces/chatSurfaceService.js";
import { RunTurnUseCase } from "./application/runTurnUseCase.js";
import { createSequenceDebugCollector } from "./llm/middleware/sequenceDebug.js";
import { LangGraphLlm } from "./llm/langGraphLlm.js";
import { AgentModelFactory } from "./llm/modelFactory.js";
import { AgentRuntime } from "./llm/agentRuntime.js";
import { SpeechTurnService } from "./transport/surfaces/speechTurnService.js";
import { AgentToolProvider } from "./tools/agentToolProvider.js";
import { SteerBuffer } from "./domain/steerBuffer.js";

export type { AgentEvent, AgentEventEmitter } from "./domain/agentEvents.js";

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  agentSystemPromptPromise: Promise<string>;
  pluginsScope: "resource" | "global" = "global";
  private agentSystemPrompt: string | null = null;
  private checkpointer: BaseCheckpointSaver | null = null;
  private sessionStore: AgentSessionStore;
  private steerBuffer: SteerBuffer;
  private runTurnUseCase: RunTurnUseCase;
  private speechTurnService: SpeechTurnService;
  private chatSurfaceService: ChatSurfaceService;

  private getCheckpointer() {
    if (this.checkpointer) return this.checkpointer;

    this.checkpointer = this.options.checkpointResource
      ? new AdminForthCheckpointSaver(this.adminforth, this.options)
      : new MemorySaver();

    return this.checkpointer;
  }

  private getInternalAgentResourceIds() {
    return [
      this.options.sessionResource.resourceId,
      this.options.turnResource.resourceId,
      this.options.checkpointResource?.resourceId,
    ].filter((resourceId): resourceId is string => Boolean(resourceId));
  }

  private async getAgentSystemPrompt(): Promise<string> {
    if (!this.agentSystemPrompt) {
      const systemPrompt = await buildAgentSystemPrompt(
        this.adminforth,
        this.getInternalAgentResourceIds(),
      ).catch((err) => {
        logger.error(
          `Failed to build agent system prompt, falling back to default: ${err instanceof Error ? err.message : String(err)}`,
        );
        return DEFAULT_AGENT_SYSTEM_PROMPT;
      });
      this.agentSystemPrompt = appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt);
    }
    return this.agentSystemPrompt;
  }

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.sessionStore = new AgentSessionStore(() => this.adminforth, this.options);
    this.steerBuffer = new SteerBuffer();
    const toolProvider = new AgentToolProvider(
      () => this.adminforth,
      this.getInternalAgentResourceIds.bind(this),
    );
    const runtime = new AgentRuntime({
      name: `adminforth-agent-${this.pluginInstanceId}`,
      getAdminforth: () => this.adminforth,
      getCheckpointer: this.getCheckpointer.bind(this),
      toolProvider,
      steerBuffer: this.steerBuffer,
    });
    const llm = new LangGraphLlm(
      runtime,
      new AgentModelFactory(this.options.maxTokens ?? 1000),
    );
    this.runTurnUseCase = new RunTurnUseCase({
      llm,
      sessions: this.sessionStore,
      steerBuffer: this.steerBuffer,
      modes: this.options.modes,
      getAdminforth: () => this.adminforth,
      getAgentSystemPrompt: this.getAgentSystemPrompt.bind(this),
      hasPersistentCheckpointer: Boolean(this.options.checkpointResource),
      createDebugSink: createSequenceDebugCollector,
    });
    this.speechTurnService = new SpeechTurnService(
      this.runTurnUseCase.runAndPersistAgentResponse.bind(this.runTurnUseCase),
    );
    this.chatSurfaceService = new ChatSurfaceService(
      () => this.adminforth,
      this.options,
      this.sessionStore,
      this.runTurnUseCase.handleTurn.bind(this.runTurnUseCase),
      this.runTurnUseCase.runAndPersistAgentResponse.bind(this.runTurnUseCase),
    );
    this.agentSystemPromptPromise = Promise.resolve(
      appendCustomSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT, this.options.systemPrompt),
    );
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyGlobalConfig(adminforth: IAdminForth) {
    super.modifyGlobalConfig(adminforth);
    if (!this.options.modes?.length) {
      throw new Error("modes is required for AdminForthAgentPlugin");
    }
    if (!this.adminforth.config.customization.globalInjections.header) {
      this.adminforth.config.customization.globalInjections.header = [];
    }
    this.adminforth.config.customization.globalInjections.header.push({
      file: this.componentPath("ChatSurface.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
        modes: this.options.modes.map((mode) => ({ name: mode.name })),
        defaultModeName: this.options.modes[0].name,
        stickByDefault: this.options.stickByDefault ?? false,
        hasAudioAdapter: Boolean(this.options.audioAdapter),
      }
    });
    if (!this.adminforth.config.customization.customHeadItems) {
      this.adminforth.config.customization.customHeadItems = [];
    }
    this.adminforth.config.customization.customHeadItems.push(
      {
        tagName: 'script',
        attributes: {
          src: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js'
        }
      },
      {
        tagName: 'script',
        attributes: {
          src: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js'
        },
      }
    );
    if (!this.options.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
  }

  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    this.options.audioAdapter?.validate();
    for (const chatSurfaceAdapter of this.options.chatSurfaceAdapters ?? []) {
      chatSurfaceAdapter.validate();
    }
    this.agentSystemPromptPromise = buildAgentSystemPrompt(
      adminforth,
      this.getInternalAgentResourceIds(),
    )
      .then((systemPrompt) => {
        const finalPrompt = appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt);
        this.agentSystemPrompt = finalPrompt;
        return finalPrompt;
      });
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  setupEndpoints(server: IHttpServer) {
    const endpointContext = {
      adminforth: this.adminforth,
      options: this.options,
      handleTurn: this.runTurnUseCase.handleTurn.bind(this.runTurnUseCase),
      handleSpeechTurn: this.speechTurnService.handle.bind(this.speechTurnService),
      steer: ({ sessionId, message }) => {
        const { id } = this.steerBuffer.add(sessionId, message);
        return { id, queued: this.steerBuffer.size(sessionId) };
      },
      runAndPersistAgentResponse: this.runTurnUseCase.runAndPersistAgentResponse.bind(this.runTurnUseCase),
      getSessionTurns: this.sessionStore.getSessionTurns.bind(this.sessionStore),
      createNewTurn: this.sessionStore.createNewTurn.bind(this.sessionStore),
      createSystemTurn: this.sessionStore.createSystemTurn.bind(this.sessionStore),
      appendSteerToCurrentTurn: this.sessionStore.appendSteerToCurrentTurn.bind(this.sessionStore),
      handleChatSurfaceMessage: this.chatSurfaceService.handleMessage.bind(this.chatSurfaceService),
    } satisfies AgentEndpointsContext;

    setupCoreEndpoints(endpointContext, server);
    setupSessionEndpoints(endpointContext, server);
    setupChatSurfaceEndpoints(endpointContext, server);
  }
}
