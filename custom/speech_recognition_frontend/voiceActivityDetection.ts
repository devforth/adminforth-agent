// @ricky0123/vad-web brings onnxruntime-web (about 170 KB gzip): it loads when the microphone starts, not with the chat
let vad: typeof import("@ricky0123/vad-web") | null = null;
let VADInstance: any = null;
let recordedAudioChunks: Float32Array[] = [];
let onVoiceStopCallback: () => void = () => {};
let onVoiceStartCallback: () => void = () => {};
let onUpdateCallback: (amplitude: number) => void = () => {};

async function createVADInstance(){
  vad = await import("@ricky0123/vad-web");
  // the package root does not re-export ort, MicVAD runs on the one from this module
  const { ort } = await import("@ricky0123/vad-web/dist/real-time-vad.js");
  // vad-web fetches the ORT .mjs and .wasm, the worklet and the model by URL, so Vite does not bundle them: they are committed to
  // custom/public/vad/<onnxruntime-web version>/ (a new version gets a new URL, assets are cached for a year).
  // After updating onnxruntime-web or @ricky0123/vad-web in custom, replace that folder with fresh copies of
  // onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm} and @ricky0123/vad-web/dist/{vad.worklet.bundle.min.js,silero_vad_legacy.onnx}
  // with origin: in dev Vite appends ?import to a dynamic import() of a path starting with "/", and answers a public .mjs requested so without a MIME type
  const assetsPath = `${window.location.origin}${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/assets/plugins/AdminForthAgentPlugin/vad/${ort.env.versions.web}/`;
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
    onnxWASMBasePath: assetsPath,
    baseAssetPath: assetsPath,
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