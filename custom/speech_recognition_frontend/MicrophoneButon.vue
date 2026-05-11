<template>
  <div 
    class="absolute bottom-2 flex items-center justify-center z-10 gap-4"
    :class="[!agentStore.isAudioChatMode ? 'right-16': agentStore.isMobile ? 'right-1/2 translate-x-1/2' : 'right-1/2 translate-x-1/2']"
  > 
    <button 
      v-if="isAudioChatMode && microphoneButtonMode === 'generating'"
      class="bg-red-500 hover:bg-red-600 dark:bg-red-700 dark:hover:bg-red-800 h-9 flex items-center justify-center rounded-full gap-2 text-white px-4"
      @click="stopCurrentGeneration()"
    >
      <div class="w-3 h-3 bg-white rounded-full"/>
      {{ $t('Stop') }}
    </button>
    <button
      v-else 
      class="h-9 bg-lightPrimary dark:bg-darkPrimary 
        hover:opacity-90 rounded-full flex items-center justify-center
        transition-all duration-300 ease-in-out overflow-hidden"
      :class="[isAudioChatMode ? 'w-32 px-2': 'w-9']" 
      @click="toggleChatMode"
    >
      <div class="w-5 h-5 flex items-center justify-center">
        <div v-if="microphoneButtonMode === 'listen' || microphoneButtonMode === 'off'" class="flex justify-evenly items-center gap-[0.1rem]">
          <AudioLines
            :showAnimation="showAudioWavesAnimation"
            :isRecording="microphoneButtonMode === 'listen'"
            :amplitude="audioAmplitude"
          />
        </div>
        <div v-else-if="microphoneButtonMode === 'generating'" class="flex items-center justify-center gap-2 text-white text-sm">
          <span class="w-3 h-3 bg-white rounded-sm" />
          {{ $t('End') }}
        </div>
        <Spinner v-else class="w-4 h-4 text-lightButtonsText dark:text-darkButtonsText fill-lightButtonsBackground dark:fill-darkPrimary" />
      </div>
    </button>
  </div>
</template>


<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import debounce from 'lodash.debounce';
import { requestMicAndStartVAD, stopUserMedia, getRecord } from './voiceActivityDetection';
import { Spinner } from '@/afcl'
import { storeToRefs } from 'pinia';
import { useAgentStore } from '../composables/useAgentStore';
import { useAgentAudio } from '../composables/useAgentAudio';
import AudioLines from './AudioLines.vue';

const agentStore = useAgentStore();
const agentAudio = useAgentAudio();
const { sendAudioToServerAndHandleResponse } = agentAudio;
const { stopGenerationAndAudio } = agentAudio;
const { stopCurrentAudioPlayback } = agentAudio;
const { agentAudioMode } = storeToRefs(agentAudio);
const microphoneButtonMode = ref<'off' | 'listen' | 'transcribing' | 'generating'>('off');
const showAudioWavesAnimation = ref(false);
const audioAmplitude = ref(0);
const hideAnimationDebounced = debounce(() => {
  showAudioWavesAnimation.value = false;
}, 100);
const sendUserRecordDebounced = debounce(() => {
  sendRecordForTranscription();
}, 500);

const isAudioChatMode = computed(() => agentStore.isAudioChatMode);

onMounted(() => {
  agentStore.registerOnBeforeChatCloseCallback(async () => {
    if(agentStore.isAudioChatMode) {
      onStopRecording();
      resetAll();
      agentStore.setIsAudioChatMode(false);
    }
  });
});

watch(agentAudioMode, async (newVal) => {
  if(newVal === 'streaming') {
    stopCurrentAudioPlayback(true);
    microphoneButtonMode.value = 'generating';
  } else if (newVal === 'transcribing') {
    microphoneButtonMode.value = 'transcribing';
  } else if (newVal === 'fetchingAudio') {
    //Generation is done, waiting for audio to be ready
  } else if (newVal === 'playingAgentResponse') {
    // Audio is playing' 
  } else if (newVal === 'readyToRespond') {
    if(isAudioChatMode.value) {
      microphoneButtonMode.value = 'listen';
      await requestMicAndStartVAD(saidSomething, stopRecording, onAnySound);
      agentAudio.playBeep(1000);
    } else {
      microphoneButtonMode.value = 'off';
    }
  }
})

function stopCurrentGeneration() {
  stopGenerationAndAudio();
  agentAudio.playBeep(1000);
}

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
  await requestMicAndStartVAD(saidSomething, stopRecording, onAnySound);
  microphoneButtonMode.value = 'listen';
  agentAudio.playBeep(1000);
}

function onStopRecording() {
  agentAudio.playBeep(600);
  stopUserMedia();
  audioAmplitude.value = 0;
  showAudioWavesAnimation.value = false;
}

function resetAll() {
  stopGenerationAndAudio();
  microphoneButtonMode.value = 'off';
  audioAmplitude.value = 0;
  showAudioWavesAnimation.value = false;
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
}


function saidSomething() {
  showAudioWavesAnimation.value = true;
  hideAnimationDebounced();
  sendUserRecordDebounced();
}

function stopRecording() {
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
}

function onAnySound(amplitude: number) {
  audioAmplitude.value = Math.min(Math.max(amplitude, 0), 1);

  if(amplitude < 0.01) {
    audioAmplitude.value = 0;
    showAudioWavesAnimation.value = false;
    return;
  }
  showAudioWavesAnimation.value = true;
  hideAnimationDebounced.cancel();
}

async function sendRecordForTranscription() {
  showAudioWavesAnimation.value = false;
  const recordBlob = await getRecord();
  if (recordBlob) {
    onStopRecording();
    await sendAudioToServerAndHandleResponse(recordBlob);
  } else { 
    console.error('No audio recorded');
  }
}

onBeforeUnmount(() => {
  stopUserMedia();
  agentStore.setIsAudioChatMode(false);
  onStopRecording();
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
});


</script>