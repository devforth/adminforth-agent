import adminforth from "@/adminforth";
import { useAgentStore } from "./useAgentStore";
import { defineStore } from 'pinia';
import type { SpeechStreamEvent } from '../types';
import { ref } from 'vue';

export const useAgentAudio = defineStore('agentAudio', () => {
  const agentStore = useAgentStore();

  const isStreamingResponse = ref(false);

  async function sendAudioToServerAndHandleResponse(blob: Blob, startRecordingCallback: () => void, stopRecordingCallback: () => void) {
    stopRecordingCallback();
    const formData = new FormData();
    formData.append('file', blob, 'user_prompt.webm');
    formData.append('sessionId', agentStore.activeSessionId);
    const fullPath = `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/speech-response`;
    try {
      isStreamingResponse.value = true;
      const res = await fetch(fullPath, {
        method: 'POST',
        body: formData,
        headers: {
          Accept: 'text/event-stream',
        },
      });
      if (res.ok) {
        await readSpeechResponseStream(res);
      } else {
        console.error('Failed to transcribe audio:', res.statusText);
        adminforth.alert({message: 'Failed to transcribe audio', variant: 'danger'});
      }
    } catch (error) {
      console.error('Error sending audio to server:', error);
    } finally {
      isStreamingResponse.value = false;
      startRecordingCallback();
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
      isStreamingResponse.value = false;
      reader.releaseLock();
    }
  }

  async function handleSpeechStreamEvent(
    eventBlock: string,
    audioChunks: string[],
    setAudioMimeType: (mimeType: string) => void,
  ) {
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
      adminforth.alert({ message: event.error, variant: 'danger' });
      return;
    }

    if (event.type === 'transcript') {
      console.log('Speech transcript:', event.data);
      agentStore.addUserMessage(event.data.text);
      return;
    }

    if (event.type === 'speech-response') {
      console.log('Speech response:', event.data);
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
  }

  function playBase64AudioChunks(chunks: string[], mimeType: string) {
    const audioBlob = new Blob(chunks.map(base64ToUint8Array), { type: mimeType });
    const fileURL = URL.createObjectURL(audioBlob);
    const audio = new Audio(fileURL);
    audio.play().catch((error) => {
      console.error('Failed to play speech response audio:', error);
    });
    audio.addEventListener('ended', () => URL.revokeObjectURL(fileURL), { once: true });
  }

  function base64ToUint8Array(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  return {
    sendAudioToServerAndHandleResponse,
    isStreamingResponse,
  };

});
