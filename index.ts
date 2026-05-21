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

export type { AgentEvent, AgentEventEmitter } from "./agentEvents.js";

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  agentSystemPromptPromise: Promise<string>;
  private checkpointer: BaseCheckpointSaver | null = null;
  private sessionStore: AgentSessionStore;
  private agentTurnService: AgentTurnService;
  private chatSurfaceService: ChatSurfaceService;
  private chatSurfaceSettingsPageRegistered = false;
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
    this.agentTurnService = new AgentTurnService({
      getAdminforth: () => this.adminforth,
      getPluginInstanceId: () => this.pluginInstanceId,
      options: this.options,
      sessionStore: this.sessionStore,
      getCheckpointer: this.getCheckpointer.bind(this),
      getInternalAgentResourceIds: this.getInternalAgentResourceIds.bind(this),
      getAgentSystemPrompt: () => this.agentSystemPromptPromise,
    });
    this.chatSurfaceService = new ChatSurfaceService(
      () => this.adminforth,
      this.options,
      this.sessionStore,
      this.agentTurnService.handleTurn.bind(this.agentTurnService),
    );
    this.agentSystemPromptPromise = Promise.resolve(
      appendCustomSystemPrompt(DEFAULT_AGENT_SYSTEM_PROMPT, this.options.systemPrompt),
    );
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);
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
    if (this.chatSurfaceService.getConnectActionAdapters().length && !this.chatSurfaceSettingsPageRegistered) {
      if (!this.adminforth.config.auth!.userMenuSettingsPages) {
        this.adminforth.config.auth!.userMenuSettingsPages = [];
      }
      this.adminforth.config.auth!.userMenuSettingsPages.push({
        icon: "flowbite:link-outline",
        pageLabel: "Chat Surfaces",
        slug: "chat-surfaces",
        component: this.componentPath("ChatSurfaceSettings.vue"),
        isVisible: () => true,
      });
      this.chatSurfaceSettingsPageRegistered = true;
    }
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
      .then((systemPrompt) => appendCustomSystemPrompt(systemPrompt, this.options.systemPrompt));
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
      runAndPersistAgentResponse: this.agentTurnService.runAndPersistAgentResponse.bind(this.agentTurnService),
      getSessionTurns: this.sessionStore.getSessionTurns.bind(this.sessionStore),
      createNewTurn: this.sessionStore.createNewTurn.bind(this.sessionStore),
      createSystemTurn: this.sessionStore.createSystemTurn.bind(this.sessionStore),
      getChatSurfaceConnectActionAdapters: this.chatSurfaceService.getConnectActionAdapters.bind(this.chatSurfaceService),
      createChatSurfaceLinkToken: this.chatSurfaceService.createLinkToken.bind(this.chatSurfaceService),
      handleChatSurfaceMessage: this.chatSurfaceService.handleMessage.bind(this.chatSurfaceService),
    } satisfies AgentEndpointsContext;

    setupCoreEndpoints(endpointContext, server);
    setupSessionEndpoints(endpointContext, server);
    setupChatSurfaceEndpoints(endpointContext, server);
  }
}
