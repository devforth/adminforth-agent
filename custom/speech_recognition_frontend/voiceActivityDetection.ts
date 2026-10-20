// @ricky0123/vad-web brings onnxruntime-web (about 170 KB gzip): it loads when the microphone starts, not with the chat
let vad: typeof import("@ricky0123/vad-web") | null = null;
let VADInstance: any = null;
let recordedAudioChunks: Float32Array[] = [];
let onVoiceStopCallback: () => void = () => {};
let onVoiceStartCallback: () => void = () => {};
let onUpdateCallback: (amplitude: number) => void = () => {};

async function createVADInstance(){
  vad = await import("@ricky0123/vad-web");
  VADInstance = await vad.MicVAD.new({
    onFrameProcessed: ({ isSpeech }) => {
      onUpdateCallback(isSpeech);
    },
    onSpeechEnd: (audio) => {
      recordedAudioChunks.push(audio);
      onVoiceStopCallback();
    },
    onSpeechStart: () => {
      onVoiceStartCallback();
    },
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/",
  })
}

export async function requestMicAndStartVAD(
  onVoiceStop: () => void,
  onVoiceStart: () => void,
  onUpdate: (amplitude: number) => void
) {
  onVoiceStopCallback = onVoiceStop;
  onVoiceStartCallback = onVoiceStart;
  onUpdateCallback = onUpdate;

  if (!VADInstance) {
    await createVADInstance();
  }
  VADInstance?.start(); 
}

export async function stopUserMedia() {
  await VADInstance?.pause();
}

export async function getRecord() {
  const totalSamples = recordedAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (totalSamples === 0) {
    return null;
  }

  const mergedAudio = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of recordedAudioChunks) {
    mergedAudio.set(chunk, offset);
    offset += chunk.length;
  }

  // chunks are recorded only by a started VAD, so the module is loaded here
  const wavBuffer = vad!.utils.encodeWAV(mergedAudio, 1, 16000, 1, 16);
  const recordToReturn = new Blob([wavBuffer], { type: 'audio/wav' });
  recordedAudioChunks = [];
  return recordToReturn;
}