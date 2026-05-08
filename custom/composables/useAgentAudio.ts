import adminforth from "@/adminforth";
import { useAgentStore } from "./useAgentStore";
import { defineStore } from 'pinia';
import type { SpeechStreamEvent } from '../types';
import { ref } from 'vue';
import { getCurrentPageContext } from './agentStore/pageContext';

type StreamingAudioState = {
  mimeType: string;
  mediaSource: MediaSource;
  sourceBuffer: SourceBuffer | null;
  pendingChunks: ArrayBuffer[];
  hasStartedPlayback: boolean;
  isDone: boolean;
};

let audioUnlockSourceUrl: string | null = null;
let audioUnlockInFlight: Promise<void> | null = null;
let isAudioPlaybackUnlocked = false;
let standByAudio: HTMLAudioElement | null = null;
let isStandByAudioPlaying = false;

function writeAsciiString(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function createSilentWavBlob(durationMs = 50) {
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const channelCount = 1;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const pcmDataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + pcmDataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmDataSize, true);
  writeAsciiString(view, 8, 'WAVE');
  writeAsciiString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAsciiString(view, 36, 'data');
  view.setUint32(40, pcmDataSize, true);

  return new Blob([buffer], { type: 'audio/wav' });
}

function getAudioUnlockSourceUrl() {
  if (!audioUnlockSourceUrl) {
    audioUnlockSourceUrl = URL.createObjectURL(createSilentWavBlob());
  }

  return audioUnlockSourceUrl;
}

async function unlockAudioPlayback() {
  if (isAudioPlaybackUnlocked) {
    return;
  }

  if (audioUnlockInFlight) {
    await audioUnlockInFlight;
    return;
  }

  audioUnlockInFlight = (async () => {
    const unlockAudio = new Audio(getAudioUnlockSourceUrl());
    unlockAudio.muted = true;
    unlockAudio.preload = 'auto';
    unlockAudio.setAttribute('playsinline', '');

    try {
      await unlockAudio.play();
      unlockAudio.pause();
      unlockAudio.currentTime = 0;
      isAudioPlaybackUnlocked = true;
    } catch (error) {
      console.error('Failed to unlock audio playback:', error);
    } finally {
      unlockAudio.removeAttribute('src');
      unlockAudio.load();
      audioUnlockInFlight = null;
    }
  })();

  await audioUnlockInFlight;
}

async function playStandByAudio() {
  if (!standByAudio) {
    standByAudio = new Audio(`/plugins/AdminForthAgentPlugin/agentAudio/agent-processing.mp3`);
    standByAudio.preload = 'auto';
    standByAudio.setAttribute('playsinline', '');
    standByAudio.addEventListener('ended', () => {
      if (standByAudio?.paused === false) {
        restartStandByAudio();
      }
    });
  }

  if (!standByAudio) {
    return;
  }

  standByAudio.currentTime = 0;

  try {
    await standByAudio.play();
    isStandByAudioPlaying = true;
  } catch (error) {
    isStandByAudioPlaying = false;
    console.error('Failed to play standby audio:', error);
  }
}

function stopStandByAudio() {
  if (!standByAudio) {
    return;
  }

  standByAudio.pause();
  standByAudio.currentTime = 0;
  isStandByAudioPlaying = false;
}

function restartStandByAudio() {
  if (standByAudio) {
    standByAudio.currentTime = 0;
  }

  void playStandByAudio();
}

export const useAgentAudio = defineStore('agentAudio', () => {
  const agentStore = useAgentStore();
  const agentAudioMode = ref<'transcribing' | 'streaming' | 'fetchingAudio' | 'playingAgentResponse' | 'readyToRespond'>('readyToRespond');
  const isStreamingResponse = ref(false);

  let currentAbortController: AbortController | null = null;
  let isPlaying = false;
  let currentAudio: HTMLAudioElement | null = null;
  let currentAudioObjectUrl: string | null = null;
  let currentStreamingAudio: StreamingAudioState | null = null;
  let bufferedAudioChunks: ArrayBuffer[] = [];
  let bufferedAudioMimeType = 'audio/mpeg';
  let wasAudioResponseReceived = false;

  function stopGenerationAndAudio() {
    setAudioModeReadyToRespond();
    stopCurrentAudioPlayback();
    currentAbortController?.abort();
  }

  function setAudioModeReadyToRespond() {
    agentAudioMode.value = 'readyToRespond';
  }

  async function sendAudioToServerAndHandleResponse(blob: Blob) {
    currentAbortController = new AbortController();
    wasAudioResponseReceived = false;
    const formData = new FormData();
    formData.append('file', blob, 'user_prompt.wav');
    formData.append('sessionId', agentStore.activeSessionId);
    formData.append('mode', agentStore.activeModeName ?? '');
    formData.append('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    formData.append('currentPage', JSON.stringify(getCurrentPageContext()));
    const fullPath = `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/speech-response`;

    try {
      agentAudioMode.value = 'transcribing';
      const res = await fetch(fullPath, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'text/event-stream',
        },
        signal: currentAbortController!.signal,
      });

      isStreamingResponse.value = true;

      if (res.ok) {
        agentAudioMode.value = 'streaming';
        await readSpeechResponseStream(res);
      } else {
        console.error('Failed to transcribe audio:', res.statusText);
        adminforth.alert({ message: 'Failed to transcribe audio', variant: 'danger' });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Error sending audio to server:', error);
      }
    } finally {
      isStreamingResponse.value = false;

      if (!wasAudioResponseReceived) {
        setAudioModeReadyToRespond();
      }
    }
  }

  async function readSpeechResponseStream(res: Response) {
    const reader = res.body?.getReader();

    if (!reader) {
      adminforth.alert({ message: 'Speech response stream is not available', variant: 'danger' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    agentStore.setCurrentChatStatus('streaming');

    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const eventBlocks = buffer.split('\n\n');
        buffer = eventBlocks.pop() ?? '';

        for (const eventBlock of eventBlocks) {
          await handleSpeechStreamEvent(eventBlock);
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        await handleSpeechStreamEvent(buffer);
      }

      finishAudioStream();
    } finally {
      reader.releaseLock();
      agentStore.setCurrentChatStatus('ready');
    }
  }

  async function handleSpeechStreamEvent(eventBlock: string) {
    if (currentAbortController?.signal.aborted) {
      return;
    }

    const data = eventBlock
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');

    if (!data || data === '[DONE]') {
      return;
    }

    const event = JSON.parse(data) as SpeechStreamEvent;

    if (event.type === 'error') {
      return;
    }

    if (event.type === 'transcript') {
      agentStore.addUserMessage(event.data.text);
      agentStore.updateLastAgentMessage('');
      return;
    }

    if (event.type === 'speech-response') {
      stopStandByAudio();
      agentStore.setCurrentChatStatus('ready');
      agentStore.addAgentMessage(event.data.response.text);
      return;
    }

    if (event.type === 'audio-start') {
      wasAudioResponseReceived = true;
      isStreamingResponse.value = false;
      agentAudioMode.value = 'fetchingAudio';
      initializeAudioStream(event.data.mimeType);
      agentAudioMode.value = 'playingAgentResponse';
      return;
    }

    if (event.type === 'audio-delta') {
      appendAudioChunk(event.data.base64);
      return;
    }

    if (event.type === 'audio-done') {
      finishAudioStream();
      return;
    }

    if (event.type === 'data-tool-call') {
      if (!isStandByAudioPlaying) {
        void playStandByAudio();
      }

      agentStore.addDataToolCallMessage(event.data);
    }
  }

  async function setIsPlaying(value: boolean) {
    isPlaying = value;

    if (!currentAudio) {
      return;
    }

    if (!isPlaying) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      return;
    }

    agentAudioMode.value = 'playingAgentResponse';

    try {
      await currentAudio.play();
    } catch (error) {
      isPlaying = false;
      setAudioModeReadyToRespond();
      console.error('Failed to play audio:', error);
    }
  }

  function initializeAudioStream(mimeType: string) {
    stopCurrentAudioPlayback();
    bufferedAudioMimeType = mimeType;

    if (typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mimeType)) {
      return;
    }

    const mediaSource = new MediaSource();
    currentAudioObjectUrl = URL.createObjectURL(mediaSource);
    currentAudio = new Audio(currentAudioObjectUrl);
    currentAudio.preload = 'auto';
    currentAudio.setAttribute('playsinline', '');
    currentAudio.addEventListener('ended', handleAudioEnded, { once: true });
    currentStreamingAudio = {
      mimeType,
      mediaSource,
      sourceBuffer: null,
      pendingChunks: [],
      hasStartedPlayback: false,
      isDone: false,
    };

    mediaSource.addEventListener('sourceopen', handleMediaSourceOpen, { once: true });
  }

  function handleMediaSourceOpen() {
    if (!currentStreamingAudio) {
      return;
    }

    try {
      currentStreamingAudio.sourceBuffer = currentStreamingAudio.mediaSource.addSourceBuffer(currentStreamingAudio.mimeType);
      currentStreamingAudio.sourceBuffer.mode = 'sequence';
      currentStreamingAudio.sourceBuffer.addEventListener('updateend', flushStreamingAudioQueue);
      flushStreamingAudioQueue();
    } catch (error) {
      console.error('Failed to initialize streaming audio playback:', error);
      bufferedAudioChunks.push(...currentStreamingAudio.pendingChunks);
      detachStreamingAudio();
      destroyCurrentAudioElement();
    }
  }

  function appendAudioChunk(base64: string) {
    const chunk = base64ToArrayBuffer(base64);

    if (!currentStreamingAudio) {
      bufferedAudioChunks.push(chunk);
      return;
    }

    currentStreamingAudio.pendingChunks.push(chunk);
    flushStreamingAudioQueue();
  }

  function flushStreamingAudioQueue() {
    if (!currentStreamingAudio?.sourceBuffer || currentStreamingAudio.sourceBuffer.updating) {
      return;
    }

    const nextChunk = currentStreamingAudio.pendingChunks.shift();

    if (nextChunk) {
      currentStreamingAudio.sourceBuffer.appendBuffer(nextChunk);

      if (!currentStreamingAudio.hasStartedPlayback) {
        currentStreamingAudio.hasStartedPlayback = true;
        void setIsPlaying(true);
      }

      return;
    }

    if (currentStreamingAudio.isDone && currentStreamingAudio.mediaSource.readyState === 'open') {
      currentStreamingAudio.mediaSource.endOfStream();
    }
  }

  function finishAudioStream() {
    if (currentStreamingAudio) {
      currentStreamingAudio.isDone = true;
      flushStreamingAudioQueue();
      return;
    }

    if (!bufferedAudioChunks.length) {
      return;
    }

    playAudioChunks(bufferedAudioChunks, bufferedAudioMimeType);
    bufferedAudioChunks = [];
  }

  function detachStreamingAudio() {
    if (currentStreamingAudio?.sourceBuffer) {
      currentStreamingAudio.sourceBuffer.removeEventListener('updateend', flushStreamingAudioQueue);
    }

    currentStreamingAudio = null;
  }

  function destroyCurrentAudioElement() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
      currentAudio.load();
      currentAudio = null;
    }

    if (currentAudioObjectUrl) {
      URL.revokeObjectURL(currentAudioObjectUrl);
      currentAudioObjectUrl = null;
    }

    isPlaying = false;
  }

  function stopCurrentAudioPlayback(dontResetMode = false) {
    stopStandByAudio();
    bufferedAudioChunks = [];
    bufferedAudioMimeType = 'audio/mpeg';
    detachStreamingAudio();
    destroyCurrentAudioElement();

    if (!dontResetMode) {
      setAudioModeReadyToRespond();
    }
  }

  function handleAudioEnded() {
    setAudioModeReadyToRespond();
    stopCurrentAudioPlayback();
  }

  function playAudioChunks(chunks: ArrayBuffer[], mimeType: string) {
    currentAudioObjectUrl = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    currentAudio = new Audio(currentAudioObjectUrl);
    currentAudio.preload = 'auto';
    currentAudio.setAttribute('playsinline', '');
    currentAudio.addEventListener('ended', handleAudioEnded, { once: true });
    void setIsPlaying(true);
  }

  function base64ToArrayBuffer(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes.buffer;
  }

  function playBeep(freq = 800, duration = 0.05) {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.value = freq;
    osc.type = 'sine';

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();

    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.stop(ctx.currentTime + duration);
  }

  return {
    sendAudioToServerAndHandleResponse,
    stopGenerationAndAudio,
    stopCurrentAudioPlayback,
    unlockAudioPlayback,
    playBeep,
    agentAudioMode,
    playStandByAudio,
  };
});
