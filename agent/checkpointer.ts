import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointPendingWrite,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  WRITES_IDX_MAP,
} from "@langchain/langgraph-checkpoint";
import type { PluginOptions } from "../types.js";
import { Filters } from "adminforth";

const ROOT_CHECKPOINT_NAMESPACE = "__root__";

export class AdminForthCheckpointSaver extends BaseCheckpointSaver {
  constructor(
    private readonly adminforth: any,
    private readonly pluginOptions: PluginOptions,
  ) {
    super();
  }

  private get resourceConfig() {
    const resource = this.pluginOptions.checkpointResource;
    if (!resource) {
      throw new Error("checkpointResource is not configured");
    }
    return resource;
  }

  private resource() {
    return this.adminforth.resource(this.resourceConfig.resourceId);
  }

  private serialize(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
  }

  private deserialize<T>(value: unknown): T | null {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") {
      return JSON.parse(value) as T;
    }
    return value as T;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private encodeCheckpointNamespace(checkpointNs: string): string {
    return checkpointNs === "" ? ROOT_CHECKPOINT_NAMESPACE : checkpointNs;
  }

  private decodeCheckpointNamespace(checkpointNs: unknown): string {
    return checkpointNs === ROOT_CHECKPOINT_NAMESPACE ? "" : String(checkpointNs ?? "");
  }

  private getConfigValues(config: RunnableConfig) {
    const configurable = (config.configurable ?? {}) as Record<string, unknown>;

    return {
      threadId: String(configurable.thread_id ?? ""),
      checkpointNs: String(configurable.checkpoint_ns ?? ""),
      checkpointId: configurable.checkpoint_id
        ? String(configurable.checkpoint_id)
        : null,
    };
  }

  private buildConfig(threadId: string, checkpointNs: string, checkpointId: string): RunnableConfig {
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  private buildCheckpointRowId(threadId: string, checkpointNs: string, checkpointId: string) {
    return `cp:${threadId}:${checkpointNs}:${checkpointId}`;
  }

  private buildWritesRowId(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
    taskId: string,
    seq: number,
  ) {
    return `wr:${threadId}:${checkpointNs}:${checkpointId}:${taskId}:${seq}`;
  }

  private getWriteIndex(channel: string, index: number): number {
    return WRITES_IDX_MAP[channel] ?? index;
  }

  private isDuplicateCheckpointWriteError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("UNIQUE constraint failed");
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, unknown>,
  ): Promise<RunnableConfig> {
    const r = this.resourceConfig;
    const { threadId, checkpointNs } = this.getConfigValues(config);
    const checkpointId = String((checkpoint as any).id);
    const storedCheckpointNs = this.encodeCheckpointNamespace(checkpointNs);

    const parentCheckpointId = this.getConfigValues(config).checkpointId;
    const createdAt = this.now();

    await this.resource().create({
      [r.idField]: this.buildCheckpointRowId(threadId, storedCheckpointNs, checkpointId),
      [r.threadIdField]: threadId,
      [r.checkpointNamespaceField]: storedCheckpointNs,
      [r.checkpointIdField]: checkpointId,
      [r.parentCheckpointIdField]: parentCheckpointId,
      [r.rowKindField]: "checkpoint",
      [r.taskIdField]: null,
      [r.sequenceField]: 0,
      [r.createdAtField]: createdAt,
      [r.checkpointPayloadField]: this.serialize(checkpoint),
      [r.metadataPayloadField]: this.serialize(metadata),
      [r.writesPayloadField]: null,
      [r.schemaVersionField]: 1,
    });

    return this.buildConfig(threadId, checkpointNs, checkpointId);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const r = this.resourceConfig;
    const { threadId, checkpointNs, checkpointId } = this.getConfigValues(config);
    const storedCheckpointNs = this.encodeCheckpointNamespace(checkpointNs);

    if (!checkpointId) {
      throw new Error("putWrites requires checkpoint_id in config");
    }

    const createdAt = this.now();

    await Promise.all(
      writes.map(async ([channel, value], index) => {
        const writeIndex = this.getWriteIndex(channel, index);

        try {
          await this.resource().create({
            [r.idField]: this.buildWritesRowId(
              threadId,
              storedCheckpointNs,
              checkpointId,
              taskId,
              writeIndex,
            ),
            [r.threadIdField]: threadId,
            [r.checkpointNamespaceField]: storedCheckpointNs,
            [r.checkpointIdField]: checkpointId,
            [r.parentCheckpointIdField]: null,
            [r.rowKindField]: "writes",
            [r.taskIdField]: taskId,
            [r.sequenceField]: writeIndex,
            [r.createdAtField]: createdAt,
            [r.checkpointPayloadField]: null,
            [r.metadataPayloadField]: null,
            [r.writesPayloadField]: this.serialize([channel, value] satisfies PendingWrite),
            [r.schemaVersionField]: 1,
          });
        } catch (error) {
          if (!this.isDuplicateCheckpointWriteError(error)) {
            throw error;
          }
        }
      }),
    );
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const r = this.resourceConfig;
    const { threadId, checkpointNs, checkpointId } = this.getConfigValues(config);
    const storedCheckpointNs = this.encodeCheckpointNamespace(checkpointNs);

    const checkpointRows = await this.resource().list(
      checkpointId
        ? Filters.AND(
            Filters.EQ(r.threadIdField, threadId),
            Filters.EQ(r.checkpointNamespaceField, storedCheckpointNs),
            Filters.EQ(r.checkpointIdField, checkpointId),
            Filters.EQ(r.rowKindField, "checkpoint"),
          )
        : Filters.AND(
            Filters.EQ(r.threadIdField, threadId),
            Filters.EQ(r.checkpointNamespaceField, storedCheckpointNs),
            Filters.EQ(r.rowKindField, "checkpoint"),
      ),
      1,
      undefined,
      [{ field: r.checkpointIdField, direction: "desc" }],
    );

    const checkpointRow = checkpointRows[0];
    if (!checkpointRow) {
      return undefined;
    }

    const resolvedCheckpointId = String(checkpointRow[r.checkpointIdField]);

    const writesRows = await this.resource().list(
      Filters.AND(
        Filters.EQ(r.threadIdField, threadId),
        Filters.EQ(r.checkpointNamespaceField, storedCheckpointNs),
        Filters.EQ(r.checkpointIdField, resolvedCheckpointId),
        Filters.EQ(r.rowKindField, "writes"),
      ),
      undefined,
      undefined,
      [{ field: r.sequenceField, direction: "asc" }],
    );

    const pendingWrites: CheckpointPendingWrite[] = writesRows.flatMap((row) => {
      const taskId = String(row[r.taskIdField] ?? "");
      const write = this.deserialize<PendingWrite>(row[r.writesPayloadField]);
      if (!write) {
        return [];
      }

      const [channel, value] = write;
      return [[taskId, channel, value]];
    });

    const parentCheckpointId = checkpointRow[r.parentCheckpointIdField]
      ? String(checkpointRow[r.parentCheckpointIdField])
      : null;

    const tuple: CheckpointTuple = {
      config: this.buildConfig(threadId, checkpointNs, resolvedCheckpointId),
      checkpoint: this.deserialize<Checkpoint>(
        checkpointRow[r.checkpointPayloadField],
      ) as Checkpoint,
      metadata: (this.deserialize<CheckpointMetadata>(
        checkpointRow[r.metadataPayloadField],
      ) ?? {}) as CheckpointMetadata,
      parentConfig: parentCheckpointId
        ? this.buildConfig(threadId, checkpointNs, parentCheckpointId)
        : undefined,
      pendingWrites,
    };

    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: {
      before?: RunnableConfig;
      limit?: number;
    },
  ): AsyncGenerator<CheckpointTuple> {
    const r = this.resourceConfig;
    const { threadId, checkpointNs } = this.getConfigValues(config);
    const storedCheckpointNs = this.encodeCheckpointNamespace(checkpointNs);
    const beforeCheckpointId = options?.before
      ? this.getConfigValues(options.before).checkpointId
      : null;

    const filters: Filters[] = [
      Filters.EQ(r.rowKindField, "checkpoint"),
      Filters.EQ(r.threadIdField, threadId),
      Filters.EQ(r.checkpointNamespaceField, storedCheckpointNs),
    ];

    if (beforeCheckpointId) {
      filters.push(Filters.LT(r.checkpointIdField, beforeCheckpointId));
    }

    const rows = await this.resource().list(
      Filters.AND(...filters),
      options?.limit,
      undefined,
      [{ field: r.checkpointIdField, direction: "desc" }],
    );

    for (const row of rows) {
      const tuple = await this.getTuple(
        this.buildConfig(
          String(row[r.threadIdField]),
          this.decodeCheckpointNamespace(row[r.checkpointNamespaceField]),
          String(row[r.checkpointIdField]),
        ),
      );

      if (tuple) {
        yield tuple;
      }
    }
  }

  async deleteThread(threadId: string, checkpointNs = ""): Promise<void> {
    const r = this.resourceConfig;
    const storedCheckpointNs = this.encodeCheckpointNamespace(checkpointNs);

    const rows = await this.resource().list(
      Filters.AND(
        Filters.EQ(r.threadIdField, threadId),
        Filters.EQ(r.checkpointNamespaceField, storedCheckpointNs),
      ),
      undefined,
      undefined,
      [{ field: r.createdAtField, direction: "desc" }],
    );

    for (const row of rows) {
      await this.adminforth
        .resource(this.pluginOptions.checkpointResource!.resourceId)
        .delete(row[r.idField]);
    }
  }
}
