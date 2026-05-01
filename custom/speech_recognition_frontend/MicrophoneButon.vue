<template>
  <button 
    class="absolute bottom-2 h-9 bg-lightPrimary dark:bg-darkPrimary 
      hover:opacity-90 rounded-full flex items-center justify-center right-16
      transition-all duration-300 ease-in-out overflow-hidden"
    :class="isRecording ? 'w-16': 'w-9'" 
    @click="toggleRecording"
  >
    <div class="w-5 h-5 flex items-center justify-center">
      <div v-if="!showCalibrationAnimation" class="flex justify-evenly items-center gap-[0.1rem]">
        <div 
          class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
          :class="{
            'recordingAnimation1' : showAnimation,
            'h-2': !isRecording,
            'h-1': isRecording,
          }"  
        />
        <div 
          class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
          :class="{
            'recordingAnimation2' : showAnimation,
            'h-4': !isRecording,
            'h-1': isRecording,
          }"  
        />
        <div 
          class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
          :class="{
            'recordingAnimation3' : showAnimation,
            'h-3': !isRecording,
            'h-1': isRecording,
          }"  
        />
        <div 
          class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
          :class="{
            'recordingAnimation4' : showAnimation,
            'h-2': !isRecording,
            'h-1': isRecording,
          }"  
        />
        <div 
          v-if="isRecording"
          class=" bg-white w-[0.2rem] rounded-sm h-1 transition-all duration-300 ease-in-out"
          :class="{
            'recordingAnimation5' : showAnimation,
          }"  
        />
      </div>
      <Spinner v-else class="w-4 h-4 text-lightButtonsText dark:text-darkButtonsText fill-lightButtonsBackground dark:fill-darkPrimary" />
    </div>
   
  </button>
</template>


<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import debounce from 'lodash/debounce';
import { requestMicAndStartVAD, stopUserMedia, CALIBRATION_DURATION } from './voiceActivityDetection';
import { Spinner } from '@/afcl'
import { callApi } from '@/utils';
import { useAdminforth } from '@/adminforth';
 
const adminforth = useAdminforth();

const isRecording = ref(false);
const showAnimation = ref(false);
const showCalibrationAnimation = ref(false);
const hideAnimationDebounced = debounce(() => {
  showAnimation.value = false;
}, 100);
const stopUserMediaDebounced = debounce(() => {
  finishRecording();
}, 2000);

function toggleRecording() {
  isRecording.value = !isRecording.value;
  if (isRecording.value) {
    onStartRecording();
  } else {
    finishRecording();
  }
}


function saidSomething(amplutude: number) {
  console.log('User said something with amplitude: ', amplutude.toFixed(2));
  showAnimation.value = true;
  hideAnimationDebounced();
  stopUserMediaDebounced();
}

async function onStartRecording() {
  showCalibrationAnimation.value = true;
  await requestMicAndStartVAD(saidSomething);
  setTimeout(() => {
    showCalibrationAnimation.value = false;
  }, CALIBRATION_DURATION);
}

onBeforeUnmount(() => {
  hideAnimationDebounced.cancel();
});

async function finishRecording() {
  isRecording.value = false;
  showAnimation.value = false;
  const recordBlob = await stopUserMedia();
  if (recordBlob) {
    const fileURL = URL.createObjectURL(recordBlob);
    const audio = new Audio(fileURL);
    audio.play();

    sendAudioToServer(recordBlob);
  } else { 
    console.error('No audio recorded');
  }
}


async function sendAudioToServer(blob: Blob) {
  const formData = new FormData();
  formData.append('file', blob, 'user_prompt.webm');
  console.log('Sending audio blob to server:', formData);
  const fullPath = `${import.meta.env.VITE_ADMINFORTH_PUBLIC_PATH || ''}/adminapi/v1/agent/transcript-audio`;
  try {
    const res = await callApi({
      path: '/adminapi/v1/agent/transcript-audio',
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      console.log('Audio transcribed successfully:', res);
    } else {
      console.error('Failed to transcribe audio:', res.error);
      adminforth.alert({message: 'Failed to transcribe audio', variant: 'danger'});
    }
  } catch (error) {
    console.error('Error sending audio to server:', error);
  }
}

</script>

<style scoped lang="scss">
  .recordingAnimation1 {
    animation: recordingAnimation 1s infinite;
    height: 0.3rem;
  }

  .recordingAnimation2 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.2s;
    height: 0.5rem;
  }

  .recordingAnimation3 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.4s;
    height: 0.4rem;
  }
  
  .recordingAnimation4 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.6s;
    height: 0.5rem;
  }

  .recordingAnimation5 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.8s;
    height: 0.3rem;
  }

  @keyframes recordingAnimation {
    0% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(2);
    }
    100% {
      transform: scaleY(1);
    }
  }
</style>