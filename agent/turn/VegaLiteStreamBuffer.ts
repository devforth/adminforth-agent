import type { AgentEventEmitter } from "../../agentEvents.js";

const VEGA_LITE_FENCE_START = "```vega-lite";
const FENCE_END = "```";

export class VegaLiteStreamBuffer {
  private bufferedTextDelta = "";
  private isRenderingVegaLite = false;

  async push(textDelta: string, emit?: AgentEventEmitter) {
    this.bufferedTextDelta += textDelta;

    if (
      hasUnclosedLatestVegaLiteBlock(this.bufferedTextDelta)
    ) {
      if (!this.isRenderingVegaLite) {
        this.isRenderingVegaLite = true;
        await emit?.({
          type: "rendering",
          phase: "start",
          label: "Rendering...",
        });
      }
      return;
    }

    if (this.isRenderingVegaLite) {
      this.isRenderingVegaLite = false;
      await emit?.({
        type: "rendering",
        phase: "end",
        label: "Rendering...",
      });
    }

    const streamableLength = this.bufferedTextDelta.includes(VEGA_LITE_FENCE_START)
      ? this.bufferedTextDelta.length
      : this.bufferedTextDelta.length - getPartialVegaLiteFenceStartLength(this.bufferedTextDelta);

    if (!streamableLength) {
      return;
    }

    await emit?.({
      type: "text-delta",
      delta: this.bufferedTextDelta.slice(0, streamableLength),
    });
    this.bufferedTextDelta = this.bufferedTextDelta.slice(streamableLength);
  }

  async flush(emit?: AgentEventEmitter) {
    if (this.isRenderingVegaLite) {
      await emit?.({
        type: "rendering",
        phase: "end",
        label: "Rendering...",
      });
      this.isRenderingVegaLite = false;
    }

    if (this.bufferedTextDelta) {
      await emit?.({
        type: "text-delta",
        delta: this.bufferedTextDelta,
      });
      this.bufferedTextDelta = "";
    }
  }
}

function hasUnclosedLatestVegaLiteBlock(text: string): boolean {
  const latestBlockStart = text.lastIndexOf(VEGA_LITE_FENCE_START);

  if (latestBlockStart === -1) {
    return false;
  }

  const blockContentStart = latestBlockStart + VEGA_LITE_FENCE_START.length;
  return text.indexOf(FENCE_END, blockContentStart) === -1;
}

function getPartialVegaLiteFenceStartLength(text: string): number {
  for (let length = Math.min(text.length, VEGA_LITE_FENCE_START.length - 1); length > 0; length -= 1) {
    if (VEGA_LITE_FENCE_START.startsWith(text.slice(-length))) {
      return length;
    }
  }

  return 0;
}
