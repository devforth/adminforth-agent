import { logger } from "adminforth";
import { randomUUID } from "crypto";
import type { IAdminForth } from "adminforth";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { AgentModelFactory } from "./agent/models/AgentModelFactory.js";
import { AgentModeResolver } from "./agent/models/AgentModeResolver.js";
import { createSequenceDebugCollector } from "./agent/middleware/sequenceDebug.js";
import { AgentRuntimeFactory } from "./agent/runtime/AgentRuntimeFactory.js";
import { AgentToolProvider } from "./agent/tools/AgentToolProvider.js";
import { TurnLifecycleService } from "./agent/turn/TurnLifecycleService.js";
import { TurnPersistenceService } from "./agent/turn/TurnPersistenceService.js";
import { TurnPromptBuilder } from "./agent/turn/TurnPromptBuilder.js";
import { TurnStreamConsumer } from "./agent/turn/TurnStreamConsumer.js";
import type {
  BaseAgentTurnInput,
  HandleSpeechTurnInput,
  HandleTurnInput,
  PreparedAgentTurn,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agent/turn/turnTypes.js";
import { getErrorMessage, isAbortError } from "./errors.js";
import type { AgentSessionStore } from "./sessionStore.js";
import { SpeechTurnService } from "./agent/speech/SpeechTurnService.js";
import type { PluginOptions } from "./types.js";

export type {
  BaseAgentTurnInput,
  HandleSpeechTurnInput,
  HandleTurnInput,
  RunAndPersistAgentResponseInput,
  RunAndPersistAgentResponseResult,
} from "./agent/turn/turnTypes.js";

type AgentTurnServiceOptions = {
  getAdminforth: () => IAdminForth;
  getPluginInstanceId: () => string;
  options: PluginOptions;
  sessionStore: AgentSessionStore;
  getCheckpointer: () => BaseCheckpointSaver;
  getInternalAgentResourceIds: () => string[];
  getAgentSystemPrompt: () => Promise<string>;
};

export class AgentTurnService {
  private readonly modeResolver: AgentModeResolver;
  private readonly modelFactory: AgentModelFactory;
  private readonly runtimeFactory: AgentRuntimeFactory;
  private readonly lifecycle: TurnLifecycleService;
  private readonly promptBuilder: TurnPromptBuilder;
  private readonly streamConsumer = new TurnStreamConsumer();
  private readonly speechTurnService: SpeechTurnService;

  constructor(private readonly serviceOptions: AgentTurnServiceOptions) {
    const toolProvider = new AgentToolProvider(
      serviceOptions.getAdminforth,
      serviceOptions.getInternalAgentResourceIds,
    );
    const persistence = new TurnPersistenceService(
      serviceOptions.getAdminforth,
      serviceOptions.options,
    );

    this.modeResolver = new AgentModeResolver(serviceOptions.options);
    this.modelFactory = new AgentModelFactory(serviceOptions.options.maxTokens ?? 1000);
    this.runtimeFactory = new AgentRuntimeFactory(
      serviceOptions.getAdminforth,
      serviceOptions.getCheckpointer,
      toolProvider,
      () => `adminforth-agent-${serviceOptions.getPluginInstanceId()}`,
    );
    this.lifecycle = new TurnLifecycleService(serviceOptions.sessionStore, persistence);
    this.promptBuilder = new TurnPromptBuilder({
      getAdminforth: serviceOptions.getAdminforth,
      getAgentSystemPrompt: serviceOptions.getAgentSystemPrompt,
    });
    this.speechTurnService = new SpeechTurnService(
      this.runAndPersistAgentResponse.bind(this),
    );
  }

  private async prepareTurn(input: BaseAgentTurnInput): Promise<PreparedAgentTurn> {
    const sequenceDebugCollector = createSequenceDebugCollector();
    const { turnId, previousUserMessages } = await this.lifecycle.start(input);

    return {
      prompt: input.prompt,
      sessionId: input.sessionId,
      turnId,
      previousUserMessages,
      modeName: input.modeName,
      context: {
        adminUser: input.adminUser,
        userTimeZone: input.userTimeZone,
        sessionId: input.sessionId,
        turnId,
        abortSignal: input.abortSignal,
        currentPage: input.currentPage,
        chatSurface: input.chatSurface,
        adminPublicOrigin: input.adminPublicOrigin,
      },
      observability: {
        emit: undefined,
        sequenceDebugSink: sequenceDebugCollector,
      },
    };
  }

  private async runAgentTurn(input: PreparedAgentTurn) {
    const selectedMode = this.modeResolver.resolve(input.modeName);
    const [models, messages] = await Promise.all([
      this.modelFactory.create(selectedMode.completionAdapter),
      this.promptBuilder.build({
        prompt: input.prompt,
        previousUserMessages: input.previousUserMessages,
        adminUser: input.context.adminUser,
        completionAdapter: selectedMode.completionAdapter,
        chatSurface: input.context.chatSurface,
        abortSignal: input.context.abortSignal,
      }),
    ]);
    const runtime = this.runtimeFactory.create();
    const stream = await runtime.stream({
      models,
      messages,
      context: input.context,
      observability: input.observability,
    });

    return this.streamConsumer.consume({
      stream: stream as AsyncIterable<[any, any]>,
      abortSignal: input.context.abortSignal,
      emit: input.observability.emit,
    });
  }

  async runAndPersistAgentResponse(
    input: RunAndPersistAgentResponseInput,
  ): Promise<RunAndPersistAgentResponseResult> {
    const preparedTurn = await this.prepareTurn(input);
    preparedTurn.observability.emit = input.emit;

    let fullResponse = "";
    let aborted = false;
    let failed = false;

    try {
      const agentResponse = await this.runAgentTurn(preparedTurn);
      fullResponse = agentResponse.text;
    } catch (error) {
      if (input.abortSignal?.aborted || isAbortError(error)) {
        aborted = true;
        logger.info(input.abortLogMessage);
      } else {
        failed = true;
        fullResponse = getErrorMessage(error);
        logger.error(`${input.failureLogMessage}:\n${fullResponse}`);
      }
    }

    preparedTurn.observability.sequenceDebugSink.flush();
    await this.lifecycle.finish({
      turnId: preparedTurn.turnId,
      responseText: fullResponse,
      debugHistory: preparedTurn.observability.sequenceDebugSink.getHistory(),
    });

    return {
      text: fullResponse,
      turnId: preparedTurn.turnId,
      aborted,
      failed,
    };
  }

  async handleTurn(input: HandleTurnInput) {
    await input.emit({
      type: "turn-started",
      messageId: randomUUID(),
    });

    const agentResponse = await this.runAndPersistAgentResponse({
      prompt: input.prompt,
      sessionId: input.sessionId,
      modeName: input.modeName,
      userTimeZone: input.userTimeZone,
      currentPage: input.currentPage,
      chatSurface: input.chatSurface,
      adminPublicOrigin: input.adminPublicOrigin,
      abortSignal: input.abortSignal,
      adminUser: input.adminUser,
      emit: input.emit,
      failureLogMessage: input.failureLogMessage ?? "Agent response failed",
      abortLogMessage: input.abortLogMessage ?? "Agent response aborted",
    });

    if (agentResponse.failed) {
      await input.emit({
        type: "error",
        error: agentResponse.text,
      });
    } else if (!agentResponse.aborted) {
      await input.emit({
        type: "response",
        text: agentResponse.text,
        sessionId: input.sessionId,
        turnId: agentResponse.turnId,
      });
    }

    await input.emit({
      type: "finish",
    });

    return agentResponse;
  }

  async handleSpeechTurn(input: HandleSpeechTurnInput) {
    return this.speechTurnService.handle(input);
  }
}
