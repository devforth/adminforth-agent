import type {
  IAdminForth,
  IHttpServer,
} from "adminforth";

import { AdminForthPlugin } from "adminforth";
import { readFileSync } from "fs";
import path from "path";

import type { PluginOptions } from './types.js';
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { AdminForthCheckpointSaver } from "./persistence/checkpointStore.js";
import { appendCustomSystemPrompt, buildAgentSystemPrompt } from "./domain/systemPrompt.js";
import { setupCoreEndpoints } from "./transport/http/coreEndpoints.js";
import { setupSessionEndpoints } from "./transport/http/sessionEndpoints.js";
import { setupChatSurfaceEndpoints } from "./transport/http/chatSurfaceEndpoints.js";
import type { AgentEndpointsContext } from "./transport/http/context.js";
import { AgentSessionStore } from "./persistence/sessionStore.js";
import { TurnAttachments } from "./persistence/turnAttachments.js";
import {
  getAttachmentsFrontendConfig,
  resolveImageAttachmentsLimits,
  type ImageAttachmentsLimits,
} from "./domain/imageAttachments.js";
import { ChatSurfaceService } from "./transport/surfaces/chatSurfaceService.js";
import { RunTurnUseCase } from "./application/runTurnUseCase.js";
import { createSequenceDebugCollector } from "./llm/middleware/sequenceDebug.js";
import { LangGraphLlm } from "./llm/langGraphLlm.js";
import { AgentModelFactory } from "./llm/modelFactory.js";
import { AgentRuntime } from "./llm/agentRuntime.js";
import { SpeechTurnService } from "./transport/surfaces/speechTurnService.js";
import { AgentToolProvider } from "./tools/agentToolProvider.js";
import { MCP_PLUGIN_CLASS_NAME } from "./tools/mcpConnection.js";
import { SteerBuffer } from "./domain/steerBuffer.js";

export type { AgentEvent, AgentEventEmitter } from "./domain/agentEvents.js";

// Vega-Lite guidance for the chat's chart renderer, appended to the system prompt.
const CHARTS_GUIDE_FILE = "charts.md";

export default class AdminForthAgentPlugin extends AdminForthPlugin {
  options: PluginOptions;
  pluginsScope: "resource" | "global" = "global";
  private agentSystemPrompt!: string;
  private checkpointer: BaseCheckpointSaver | null = null;
  private sessionStore: AgentSessionStore;
  private turnAttachments: TurnAttachments;
  private imageAttachmentsLimits: ImageAttachmentsLimits;
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

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.imageAttachmentsLimits = resolveImageAttachmentsLimits(options.imageAttachments);
    this.turnAttachments = new TurnAttachments(() => this.adminforth, this.options);
    this.sessionStore = new AgentSessionStore(() => this.adminforth, this.options, this.turnAttachments);
    this.steerBuffer = new SteerBuffer();
    const runtime = new AgentRuntime({
      name: `adminforth-agent-${this.pluginInstanceId}`,
      getAdminforth: () => this.adminforth,
      getCheckpointer: this.getCheckpointer.bind(this),
      toolProvider: new AgentToolProvider(() => this.adminforth),
      steerBuffer: this.steerBuffer,
      attachmentsEnabled: this.turnAttachments.enabled,
      imageAttachmentsLimits: this.imageAttachmentsLimits,
      loadAttachmentAsDataUrl: (filePath) => this.turnAttachments.loadAsDataUrl(filePath),
    });
    const llm = new LangGraphLlm(
      runtime,
      new AgentModelFactory(this.options.maxTokens ?? 1000),
    );
    this.runTurnUseCase = new RunTurnUseCase({
      llm,
      sessions: this.sessionStore,
      attachments: this.turnAttachments,
      steerBuffer: this.steerBuffer,
      modes: this.options.modes,
      getAdminforth: () => this.adminforth,
      getAgentSystemPrompt: () => this.agentSystemPrompt,
      hasPersistentCheckpointer: Boolean(this.options.checkpointResource),
      turnCheckpointsEnabled: Boolean(this.options.turnResource.checkpointIdField),
      sessionResource: this.options.sessionResource,
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
        editingEnabled: Boolean(this.options.checkpointResource && this.options.turnResource.checkpointIdField),
        attachments: this.turnAttachments.enabled ? getAttachmentsFrontendConfig(this.imageAttachmentsLimits) : null,
      }
    });
    if (!this.options.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
    // Chat history and checkpoints of the agent are not data for agents to work with.
    const internalResourceIds = [
      this.options.sessionResource.resourceId,
      this.options.turnResource.resourceId,
      this.options.checkpointResource?.resourceId,
    ];
    for (const resource of adminforth.config.resources) {
      if (internalResourceIds.includes(resource.resourceId)) {
        resource.options.agent = { ...resource.options.agent, hiddenFromAgents: true };
      }
    }
  }

  validateConfigAfterDiscover(adminforth: IAdminForth) {
    this.options.audioAdapter?.validate();
    for (const chatSurfaceAdapter of this.options.chatSurfaceAdapters ?? []) {
      chatSurfaceAdapter.validate();
    }
    adminforth.getPluginByClassName(MCP_PLUGIN_CLASS_NAME);
    this.turnAttachments.resolveUploadPlugin();
    this.agentSystemPrompt = appendCustomSystemPrompt(
      buildAgentSystemPrompt(
        adminforth.config.baseUrlSlashed,
        readFileSync(path.join(this.customFolderPath, CHARTS_GUIDE_FILE), "utf8"),
      ),
      this.options.systemPrompt,
    );
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  setupEndpoints(server: IHttpServer) {
    const endpointContext = {
      adminforth: this.adminforth,
      options: this.options,
      imageAttachmentsLimits: this.imageAttachmentsLimits,
      handleTurn: this.runTurnUseCase.handleTurn.bind(this.runTurnUseCase),
      handleEditTurn: this.runTurnUseCase.handleEditTurn.bind(this.runTurnUseCase),
      handleSpeechTurn: this.speechTurnService.handle.bind(this.speechTurnService),
      steer: async ({ sessionId, message, adminUser }) => {
        await this.runTurnUseCase.assertSessionOwnership(sessionId, adminUser);
        const { id } = this.steerBuffer.add(sessionId, message);
        return { id, queued: this.steerBuffer.size(sessionId) };
      },
      createAttachmentUploadUrl: async ({ adminUser, ...input }) => {
        await this.runTurnUseCase.assertSessionOwnership(input.sessionId, adminUser);
        return this.turnAttachments.createUploadUrl(input);
      },
      runAndPersistAgentResponse: this.runTurnUseCase.runAndPersistAgentResponse.bind(this.runTurnUseCase),
      getSessionTurns: this.sessionStore.getSessionTurns.bind(this.sessionStore),
      getPendingApprovals: (sessionId, adminUser) => this.runTurnUseCase.getPendingApprovals(sessionId, adminUser),
      createNewTurn: this.sessionStore.createNewTurn.bind(this.sessionStore),
      deleteSession: this.sessionStore.deleteSession.bind(this.sessionStore),
      createSystemTurn: this.sessionStore.createSystemTurn.bind(this.sessionStore),
      appendSteerToCurrentTurn: this.sessionStore.appendSteerToCurrentTurn.bind(this.sessionStore),
      handleChatSurfaceMessage: this.chatSurfaceService.handleMessage.bind(this.chatSurfaceService),
    } satisfies AgentEndpointsContext;

    setupCoreEndpoints(endpointContext, server);
    setupSessionEndpoints(endpointContext, server);
    setupChatSurfaceEndpoints(endpointContext, server);
  }
}
