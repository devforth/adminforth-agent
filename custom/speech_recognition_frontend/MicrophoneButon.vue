<template>
  <button 
    class="absolute bottom-2 h-9 bg-lightPrimary dark:bg-darkPrimary 
      hover:opacity-90 rounded-full flex items-center justify-center right-16
      transition-all duration-300 ease-in-out overflow-hidden"
    :class="isAudioChatMode ? 'w-20 px-2': 'w-9'" 
    @click="toggleChatMode"
  >
    <div class="w-5 h-5 flex items-center justify-center">
      <div v-if="!showButtonSpinner" class="flex justify-evenly items-center gap-[0.1rem]">
        <AudioLines :showAnimation="showAnimation" :isRecording="isAudioChatMode" />
      </div>
      <Spinner v-else class="w-4 h-4 text-lightButtonsText dark:text-darkButtonsText fill-lightButtonsBackground dark:fill-darkPrimary" />
    </div>
   
  </button>
</template>


<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import debounce from 'lodash/debounce';
import { requestMicAndStartVAD, stopUserMedia, getRecorder, CALIBRATION_DURATION } from './voiceActivityDetection';
import { Spinner } from '@/afcl'
import { useAdminforth } from '@/adminforth';
import { storeToRefs } from 'pinia';
import { useAgentStore } from '../composables/useAgentStore';
import { useAgentAudio } from '../composables/useAgentAudio';
import AudioLines from './AudioLines.vue';

const adminforth = useAdminforth();
const agentStore = useAgentStore();
const agentAudio = useAgentAudio();
const { sendAudioToServerAndHandleResponse } = agentAudio;
const { stopGenerationAndAudio } = agentAudio;
const { isStreamingResponse } = storeToRefs(agentAudio);

agentStore.registerOnBeforeChatCloseCallback(async () => {
  if(agentStore.isAudioChatMode) {
    onStopRecording();
    agentStore.setIsAudioChatMode(false);
  }
});

const showAnimation = ref(false);
const showButtonSpinner = ref(false);
const hideAnimationDebounced = debounce(() => {
  showAnimation.value = false;
}, 100);
const sendUserRecordDebounced = debounce(() => {
  sendRecordForTranscription();
}, 1000);

const isAudioChatMode = computed(() => agentStore.isAudioChatMode);

watch(isStreamingResponse, (newVal) => {
  if(!newVal) {
    showButtonSpinner.value = false;
  } else {
    showButtonSpinner.value = true;
  }
})

function toggleChatMode() {
  agentStore.setIsAudioChatMode(!isAudioChatMode.value);
  if (isAudioChatMode.value) {
    onStartRecording();
  } else {
    resetAll();
    onStopRecording();
  }
}

async function onStartRecording() {
  showButtonSpinner.value = true;
  await requestMicAndStartVAD(saidSomething, stopRecording, onAnySound);
  setTimeout(() => {
    showButtonSpinner.value = false;
    //Play a sound to indicate that recording has started
  }, CALIBRATION_DURATION);
}

function onStopRecording() {
  stopUserMedia();
  showAnimation.value = false;
  // Play a sound to indicate that recording has stopped
}

function resetAll() {
  stopGenerationAndAudio();
  showAnimation.value = false;
  showButtonSpinner.value = false;
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
}


function saidSomething() {
  showAnimation.value = true;
  hideAnimationDebounced();
  sendUserRecordDebounced();
}

function stopRecording() {
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
}

function onAnySound(amplitude: number) {
  if(amplitude < 0.01) {
    showAnimation.value = false;
    return;
  }
  showAnimation.value = true;
  hideAnimationDebounced.cancel();
}

onBeforeUnmount(() => {
  stopUserMedia();
  agentStore.setIsAudioChatMode(false);
  onStopRecording();
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
});

async function sendRecordForTranscription() {
  showAnimation.value = false;
  const recordBlob = await getRecorder();
  if (recordBlob) {
    sendAudioToServerAndHandleResponse(recordBlob, onStartRecording, onStopRecording);
  } else { 
    console.error('No audio recorded');
  }
}



</script>