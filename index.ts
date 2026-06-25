import type {
  AdminForthResource,
  IAdminForth,
  IHttpServer,
} from "adminforth";

import { AdminForthPlugin } from "adminforth";

import type { PluginOptions } from './types.js';
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { z } from "zod";
import { AdminForthCheckpointSaver } from "./agent/checkpointer.js";
import { appendCustomSystemPrompt, buildAgentSystemPrompt, DEFAULT_AGENT_SYSTEM_PROMPT} from "./agent/systemPrompt.js";
import { setupCoreEndpoints } from "./endpoints/core.js";
import { setupSessionEndpoints } from "./endpoints/sessions.js";
import { setupChatSurfaceEndpoints } from "./endpoints/chatSurfaces.js";
import type { AgentEndpointsContext } from "./endpoints/context.js";
import { AgentSessionStore } from "./sessionStore.js";
import { ChatSurfaceService } from "./chatSurfaceService.js";
import { AgentTurnService } from "./agentTurnService.js";
import { AgentModelFactory } from "./agent/models/AgentModelFactory.js";
import { AgentModeResolver } from "./agent/models/AgentModeResolver.js";
import { AgentRuntime } from "./agent/runtime/AgentRuntime.js";
import { SpeechTurnService } from "./agent/speech/SpeechTurnService.js";
import { AgentToolProvider } from "./agent/tools/AgentToolProvider.js";
import { TurnContextBuilder } from "./agent/turn/TurnContextBuilder.js";
import { TurnLifecycleService } from "./agent/turn/TurnLifecycleService.js";
import { TurnPersistenceService } from "./agent/turn/TurnPersistenceService.js";
import { TurnPromptBuilder } from "./agent/turn/TurnPromptBuilder.js";
import { TurnStreamConsumer } from "./agent/turn/TurnStreamConsumer.js";

export type { AgentEvent, AgentEventEmitter } from "./agentEvents.js";

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  agentSystemPromptPromise: Promise<string>;
  pluginsScope: "resource" | "global" = "global";
  private agentSystemPrompt: string | null = null;
  private checkpointer: BaseCheckpointSaver | null = null;
  private sessionStore: AgentSessionStore;
  private agentTurnService: AgentTurnService;
  private speechTurnService: SpeechTurnService;
  private chatSurfaceService: ChatSurfaceService;
  private parseBody<T>(
    schema: z.ZodType<T>,
    body: unknown,
    response: { setStatus: (code: number, message: string) => void },
  ): T | null {
    const parsed = schema.safeParse(body ?? {});
    if (!parsed.success) {
      response.setStatus(422, parsed.error.message);
      return null;
    }
    return parsed.data;
  }
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

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.sessionStore = new AgentSessionStore(() => this.adminforth, this.options);
    const toolProvider = new AgentToolProvider(
      () => this.adminforth,
      this.getInternalAgentResourceIds.bind(this),
    );
    const runtime = new AgentRuntime({
      name: `adminforth-agent-${this.pluginInstanceId}`,
      getAdminforth: () => this.adminforth,
      getCheckpointer: this.getCheckpointer.bind(this),
      toolProvider,
    });
    const persistence = new TurnPersistenceService(() => this.adminforth, this.options);
    this.agentTurnService = new AgentTurnService(
      new TurnLifecycleService(this.sessionStore, persistence, this.options),
      new TurnContextBuilder(() => this.adminforth),
      new AgentModeResolver(this.options),
      new AgentModelFactory(this.options.maxTokens ?? 1000),
      new TurnPromptBuilder({
        getAdminforth: () => this.adminforth,
        getAgentSystemPrompt: async () => {
          if (!this.agentSystemPrompt) {
            const systemPrompt = await buildAgentSystemPrompt(
              this.adminforth,
              this.getInternalAgentResourceIds(),
            ).catch((err) => {
              return DEFAULT_AGENT_SYSTEM_PROMPT;
            });
            this.agentSystemPrompt = appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt);
          }
          return this.agentSystemPrompt;
        },
      }),
      runtime,
      new TurnStreamConsumer(),
    );
    this.speechTurnService = new SpeechTurnService(
      this.agentTurnService.runAndPersistAgentResponse.bind(this.agentTurnService),
    );
    this.chatSurfaceService = new ChatSurfaceService(
      () => this.adminforth,
      this.options,
      this.sessionStore,
      this.agentTurnService.handleTurn.bind(this.agentTurnService),
      this.agentTurnService.runAndPersistAgentResponse.bind(this.agentTurnService),
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
      parseBody: this.parseBody.bind(this),
      handleTurn: this.agentTurnService.handleTurn.bind(this.agentTurnService),
      handleSpeechTurn: this.speechTurnService.handle.bind(this.speechTurnService),
      runAndPersistAgentResponse: this.agentTurnService.runAndPersistAgentResponse.bind(this.agentTurnService),
      getSessionTurns: this.sessionStore.getSessionTurns.bind(this.sessionStore),
      createNewTurn: this.sessionStore.createNewTurn.bind(this.sessionStore),
      createSystemTurn: this.sessionStore.createSystemTurn.bind(this.sessionStore),
      handleChatSurfaceMessage: this.chatSurfaceService.handleMessage.bind(this.chatSurfaceService),
    } satisfies AgentEndpointsContext;

    setupCoreEndpoints(endpointContext, server);
    setupSessionEndpoints(endpointContext, server);
    setupChatSurfaceEndpoints(endpointContext, server);
  }
}
