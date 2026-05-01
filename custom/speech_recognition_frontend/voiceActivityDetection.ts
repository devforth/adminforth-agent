import vad from 'voice-activity-detection';

let currentStream: MediaStream | null = null;
let vadInstance: any = null;
let audioContext: AudioContext | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];

export const CALIBRATION_DURATION = 1000; // in ms

export async function requestMicAndStartVAD(
  userSaidSomethingCallback: (amplitude: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    try {
      audioContext = new AudioContext();

      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          currentStream = stream;
          startRecording(stream);
          resolve();
          startUserMedia(audioContext as AudioContext, stream, userSaidSomethingCallback);
        })
        .catch((error) => {
          handleMicConnectError();
          reject(error);
        });
    } catch (e) {
      handleUserMediaError();
      reject(e);
    }
  });
}

function handleUserMediaError() {
  console.error('Mic input is not supported by the browser.');
}

function handleMicConnectError() {
  console.error('Could not connect microphone. Possible rejected by the user or is blocked by the browser.');
}

export async function stopUserMedia(): Promise<Blob | null> {
  const recordingBlob = await stopRecording();

  if (vadInstance && vadInstance.destroy) {
    vadInstance.destroy();
    vadInstance = null;
  }

  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
    currentStream = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  return recordingBlob;
}

function startRecording(stream: MediaStream) {
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  mediaRecorder.start();
}

function stopRecording(): Promise<Blob | null> {
  if (!mediaRecorder) {
    return Promise.resolve(null);
  }

  const recorder = mediaRecorder;
  mediaRecorder = null;

  const finalizeBlob = () => {
    const blob = new Blob(recordedChunks, { type: recorder.mimeType || 'audio/webm' });
    recordedChunks = [];
    return blob;
  };

  if (recorder.state === 'inactive') {
    return Promise.resolve(finalizeBlob());
  }

  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      resolve(finalizeBlob());
    };
    recorder.onerror = () => {
      recordedChunks = [];
      reject(new Error('Failed to finalize audio recording.'));
    };
    recorder.stop();
  });
}

function startUserMedia(
  audioContext: AudioContext, 
  stream: MediaStream, 
  userSaidSomethingCallback: (amplitude: number) => void,
) {
  const options = {
    fftSize: 1024,
    bufferLen: 1024,
    smoothingTimeConstant: 0.2,
    minCaptureFreq: 85,         // in Hz
    maxCaptureFreq: 255,        // in Hz
    noiseCaptureDuration: CALIBRATION_DURATION, // in ms
    minNoiseLevel: 0.3,         // from 0 to 1
    maxNoiseLevel: 0.7,         // from 0 to 1
    avgNoiseMultiplier: 1.2,
    onVoiceStart() {
      console.log('voice start');
    },
    onVoiceStop() {}, //Doesn't work properly, so we will handle it with onUpdate callback
    onUpdate(val: number) {
      if (val > 0) {
        userSaidSomethingCallback(val);
      }
    }
  };

  vadInstance = vad(audioContext, stream, options);
}