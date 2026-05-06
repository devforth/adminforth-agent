declare module 'voice-activity-detection' {
  type VADOptions = {
    fftSize: number,
    bufferLen: number,
    smoothingTimeConstant: number,
    minCaptureFreq: number,         // in Hz
    maxCaptureFreq: number,        // in Hz
    noiseCaptureDuration: number, // in ms
    minNoiseLevel: number,         // from 0 to 1
    maxNoiseLevel: number,         // from 0 to 1
    avgNoiseMultiplier: number,     // from 0 to 1
    onVoiceStart?: () => void;
    onVoiceStop?: () => void;
    onUpdate?: (value: number) => void;
  };

  export default function vad(
    audioContext: AudioContext,
    stream: MediaStream,
    options: VADOptions,
  ): void;
}
