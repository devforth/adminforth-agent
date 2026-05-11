import adminforth from "@/adminforth";
import { useAgentStore } from "./useAgentStore";
import { defineStore } from 'pinia';
import type { SpeechStreamEvent } from '../types';
import { ref } from 'vue';
import { getCurrentPageContext } from './agentStore/pageContext';
import {
  createChatResponseAudioPlayback,
  endStandByAudio,
  finishChatResponseAudio,
  playChatResponseCurrentChunks,
  startStandByAudio,
  stopChatResponseAudio,
  unlockAudio,
} from './agentAudio/utils';
import type { ChatResponseAudioPlayback } from './agentAudio/utils';

let isStandByAudioPlaying = false;
let isAudioUnlocked = false;
async function playStandByAudio() {
  isStandByAudioPlaying = true;
  await startStandByAudio();
}

function stopStandByAudio() {
  endStandByAudio();
  isStandByAudioPlaying = false;
}

export const useAgentAudio = defineStore('agentAudio', () => {
  const agentStore = useAgentStore();
  const agentAudioMode = ref<'transcribing' | 'streaming' | 'fetchingAudio' | 'playingAgentResponse' | 'readyToRespond' >('readyToRespond');
  const isStreamingResponse = ref(false);
    
  let currentAbortController: AbortController | null = null;
  let currentStreamingAudio: ChatResponseAudioPlayback | null = null;
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
    if (!isAudioUnlocked) {
      await unlockAudio();
      isAudioUnlocked = true;
    }
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
        adminforth.alert({message: 'Failed to transcribe audio', variant: 'danger'});
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        //
      } else {
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
      adminforth.alert({message: 'Speech response stream is not available', variant: 'danger'});
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
      initializeAudioStream(event.data);
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
        playStandByAudio();
      }
      agentStore.addDataToolCallMessage(event.data);
    }
  }

  function initializeAudioStream(audioData: Extract<SpeechStreamEvent, { type: 'audio-start' }>['data']) {
    stopCurrentAudioPlayback();
    currentStreamingAudio = createChatResponseAudioPlayback({
      sampleRate: audioData.sampleRate,
      channelCount: audioData.channelCount,
      bitsPerSample: audioData.bitsPerSample,
      onEnded: handleAudioEnded,
    });
  }

  function appendAudioChunk(base64: string) {
    playChatResponseCurrentChunks({
      playback: currentStreamingAudio!,
      chunks: [base64ToArrayBuffer(base64)],
    });
  }

  function finishAudioStream() {
    finishChatResponseAudio(currentStreamingAudio);
  }

  function stopCurrentAudioPlayback(dontResetMode = false) {
    stopStandByAudio();
    stopChatResponseAudio(currentStreamingAudio);
    currentStreamingAudio = null;
    if (!dontResetMode) {
      setAudioModeReadyToRespond();
    }
  }

  function handleAudioEnded() {
    currentStreamingAudio = null;
    setAudioModeReadyToRespond();
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
    playBeep,
    agentAudioMode
  };

});
