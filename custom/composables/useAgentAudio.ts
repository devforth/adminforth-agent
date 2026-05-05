import adminforth from "@/adminforth";
import { useAgentStore } from "./useAgentStore";
import { defineStore } from 'pinia';
import type { SpeechStreamEvent } from '../types';
import { ref } from 'vue';
import { getCurrentPageContext } from './agentStore/pageContext';

export const useAgentAudio = defineStore('agentAudio', () => {
  const agentStore = useAgentStore();

  const isStreamingResponse = ref(false);
  
  let currentAbortController: AbortController | null = null;

  function stopGenerationAndAudio() {
    if (isStreamingResponse.value) {
      isStreamingResponse.value = false;
      setIsPlaying(false);
    }
    currentAbortController?.abort();
  }

  async function sendAudioToServerAndHandleResponse(blob: Blob) {
    currentAbortController = new AbortController();
    const formData = new FormData();
    formData.append('file', blob, 'user_prompt.webm');
    formData.append('sessionId', agentStore.activeSessionId);
    formData.append('mode', agentStore.activeModeName ?? '');
    formData.append('timeZone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    formData.append('currentPage', JSON.stringify(getCurrentPageContext()));
    const fullPath = `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/speech-response`;
    try {
      isStreamingResponse.value = true;
      const res = await fetch(fullPath, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'text/event-stream',
        },
        signal: currentAbortController!.signal,
      });
      if (res.ok) {
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
    }
  }

  async function readSpeechResponseStream(res: Response) {
    const reader = res.body?.getReader();
    if (!reader) {
      adminforth.alert({message: 'Speech response stream is not available', variant: 'danger'});
      return;
    }

    const decoder = new TextDecoder();
    const audioChunks: string[] = [];
    let audioMimeType = 'audio/mpeg';
    let buffer = '';

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
          await handleSpeechStreamEvent(eventBlock, audioChunks, (mimeType) => {
            audioMimeType = mimeType;
          });
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        await handleSpeechStreamEvent(buffer, audioChunks, (mimeType) => {
          audioMimeType = mimeType;
        });
      }

      if (audioChunks.length) {
        playBase64AudioChunks(audioChunks, audioMimeType);
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function handleSpeechStreamEvent(
    eventBlock: string,
    audioChunks: string[],
    setAudioMimeType: (mimeType: string) => void,
  ) {
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
      return;
    }

    if (event.type === 'speech-response') {
      agentStore.addAgentMessage(event.data.response.text);
      return;
    }

    if (event.type === 'audio-start') {
      setAudioMimeType(event.data.mimeType);
      return;
    }

    if (event.type === 'audio-delta') {
      audioChunks.push(event.data.base64);
    }

    if (event.type === 'data-tool-call') {
      agentStore.addDataToolCallMessage(event.data.toolName, event.data.toolInput);
    }
  }

  let isPlaying = false;
  let currentAudio: HTMLAudioElement | null = null;

  function setIsPlaying(value: boolean) {
    isPlaying = value;
    if (!isPlaying && currentAudio) {
      currentAudio?.pause();
      currentAudio!.currentTime = 0;
    } else {
      currentAudio?.play();
    }
  }


  function playBase64AudioChunks(chunks: string[], mimeType: string) {
    const audioBlob = new Blob(chunks.map(base64ToUint8Array), { type: mimeType });
    const fileURL = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(fileURL);
    setIsPlaying(true);
    currentAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(fileURL);
      currentAudio = null;
    }, { once: true });
  }

  function base64ToUint8Array(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
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
    isStreamingResponse,
    stopGenerationAndAudio,
    playBeep
  };

});
