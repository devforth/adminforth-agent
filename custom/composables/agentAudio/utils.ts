const ctx = new AudioContext();
let standbySource: AudioBufferSourceNode | null = null;

const DEFAULT_PCM_SAMPLE_RATE = 24000;
const DEFAULT_PCM_CHANNEL_COUNT = 1;
const DEFAULT_PCM_BITS_PER_SAMPLE = 16;

export type ChatResponseAudioPlayback = {
  nextStartTime: number;
  activeSources: Set<AudioBufferSourceNode>;
  pendingSourceCount: number;
  pendingPcmBytes: Uint8Array;
  isDone: boolean;
  isStopped: boolean;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  onEnded?: () => void;
};

export async function unlockAudio() {
  await ctx.resume();

  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();

  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start(0);
}

export async function startStandByAudio() {
  const response = await fetch(
    `/plugins/AdminForthAgentPlugin/agentAudio/agent-processing.mp3`
  );

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  standbySource = source;

  source.buffer = audioBuffer;
  source.connect(ctx.destination);

  source.start();
}

export function createChatResponseAudioPlayback(options: {
  sampleRate?: number;
  channelCount?: number;
  bitsPerSample?: number;
  onEnded?: () => void;
} = {}): ChatResponseAudioPlayback {
  return {
    nextStartTime: ctx.currentTime,
    activeSources: new Set(),
    pendingSourceCount: 0,
    pendingPcmBytes: new Uint8Array(0),
    isDone: false,
    isStopped: false,
    sampleRate: options.sampleRate ?? DEFAULT_PCM_SAMPLE_RATE,
    channelCount: options.channelCount ?? DEFAULT_PCM_CHANNEL_COUNT,
    bitsPerSample: options.bitsPerSample ?? DEFAULT_PCM_BITS_PER_SAMPLE,
    onEnded: options.onEnded,
  };
}

export function playChatResponseCurrentChunks({
  playback,
  chunks,
}: {
  playback: ChatResponseAudioPlayback;
  chunks: ArrayBuffer[];
}) {
  void ctx.resume().catch(() => undefined);

  for (const chunk of chunks) {
    if (playback.isStopped || !chunk.byteLength) {
      continue;
    }

    const pcmBytes = concatUint8Arrays(playback.pendingPcmBytes, new Uint8Array(chunk));
    const bytesPerFrame = playback.channelCount * (playback.bitsPerSample / 8);
    const alignedByteLength = pcmBytes.byteLength - (pcmBytes.byteLength % bytesPerFrame);

    playback.pendingPcmBytes = pcmBytes.slice(alignedByteLength);

    if (!alignedByteLength) {
      continue;
    }

    const audioBuffer = createAudioBufferFromPcmChunk(
      playback,
      pcmBytes.subarray(0, alignedByteLength)
    );
    const source = ctx.createBufferSource();
    const startTime = Math.max(playback.nextStartTime, ctx.currentTime);

    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    playback.activeSources.add(source);
    playback.pendingSourceCount += 1;
    playback.nextStartTime = startTime + audioBuffer.duration;

    source.addEventListener(
      'ended',
      () => {
        playback.activeSources.delete(source);
        playback.pendingSourceCount = Math.max(0, playback.pendingSourceCount - 1);

        if (!playback.isStopped && playback.isDone && playback.pendingSourceCount === 0) {
          playback.onEnded?.();
        }
      },
      { once: true }
    );

    source.start(startTime);
  }
}

export function finishChatResponseAudio(playback: ChatResponseAudioPlayback | null) {
  if (!playback || playback.isStopped) {
    return;
  }

  playback.isDone = true;

  if (playback.pendingSourceCount === 0) {
    playback.onEnded?.();
  }
}

export function stopChatResponseAudio(playback: ChatResponseAudioPlayback | null) {
  if (!playback || playback.isStopped) {
    return;
  }

  playback.isStopped = true;

  for (const source of playback.activeSources) {
    source.stop();
  }

  playback.activeSources.clear();
  playback.pendingSourceCount = 0;
  playback.pendingPcmBytes = new Uint8Array(0);
  playback.nextStartTime = ctx.currentTime;
}

function createAudioBufferFromPcmChunk(
  playback: ChatResponseAudioPlayback,
  chunk: Uint8Array
) {
  if (playback.bitsPerSample !== DEFAULT_PCM_BITS_PER_SAMPLE) {
    throw new Error(`Unsupported PCM bit depth: ${playback.bitsPerSample}`);
  }

  const bytesPerSample = playback.bitsPerSample / 8;
  const frameCount = chunk.byteLength / playback.channelCount / bytesPerSample;
  const audioBuffer = ctx.createBuffer(
    playback.channelCount,
    frameCount,
    playback.sampleRate
  );
  const pcm = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  const channelData = Array.from(
    { length: playback.channelCount },
    (_, channelIndex) => audioBuffer.getChannelData(channelIndex)
  );

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < playback.channelCount; channelIndex += 1) {
      const sampleOffset =
        (frameIndex * playback.channelCount + channelIndex) * bytesPerSample;
      const sample = pcm.getInt16(sampleOffset, true) / 32768;

      channelData[channelIndex][frameIndex] = sample;
    }
  }

  return audioBuffer;
}

function concatUint8Arrays(left: Uint8Array, right: Uint8Array) {
  if (!left.byteLength) {
    return right;
  }

  const combined = new Uint8Array(left.byteLength + right.byteLength);

  combined.set(left, 0);
  combined.set(right, left.byteLength);

  return combined;
}

export function endStandByAudio() {
  if (standbySource) {
    standbySource.stop();
    standbySource = null;
  }
}
