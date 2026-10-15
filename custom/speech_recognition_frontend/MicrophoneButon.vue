<template>
  <div
    v-show="!agentStore.isResponseInProgress || isAudioChatMode"
    class="flex items-center"
  >
    <!-- One button for the whole voice flow: the icon shows the state, the label what a click does -->
    <button
      type="button"
      class="flex h-8 shrink-0 items-center justify-center rounded-full transition-colors duration-150"
      :class="isAudioChatMode
        ? `w-40 gap-2 px-3 text-sm font-medium
          bg-lightPrimary/10 text-gray-800 hover:bg-lightPrimary/15
          dark:bg-darkPrimary/20 dark:text-gray-100 dark:hover:bg-darkPrimary/30`
        : 'w-8 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'"
      :title="$t(buttonTitle)"
      :aria-label="$t(buttonTitle)"
      @click="isGenerating ? stopCurrentGeneration() : toggleChatMode()"
    >
      <span
        class="flex h-5 items-center gap-[0.1rem]"
        :class="isAudioChatMode ? 'text-lightPrimary dark:text-darkPrimary' : ''"
      >
        <span v-if="isGenerating" class="w-2.5 h-2.5 rounded-sm bg-current" />
        <Spinner v-else-if="isPolling || microphoneButtonMode === 'transcribing'" class="w-4 h-4" />
        <AudioLines
          v-else
          :showAnimation="showAudioWavesAnimation"
          :isRecording="microphoneButtonMode === 'listen'"
          :amplitude="audioAmplitude"
        />
      </span>
      <template v-if="isAudioChatMode">{{ isGenerating ? $t('Stop') : $t('End') }}</template>
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
const { unlockAudio } = agentAudio;
const microphoneButtonMode = ref<'off' | 'listen' | 'transcribing' | 'generating'>('off');
const showAudioWavesAnimation = ref(false);
const audioAmplitude = ref(0);
const hideAnimationDebounced = debounce(() => {
  showAudioWavesAnimation.value = false;
}, 100);
const sendUserRecordDebounced = debounce(() => {
  sendRecordForTranscription();
}, 500);
const isPolling = ref(false);

const isAudioChatMode = computed(() => agentStore.isAudioChatMode);
const isGenerating = computed(() => microphoneButtonMode.value === 'generating');
const buttonTitle = computed(() => {
  if (!isAudioChatMode.value) {
    return 'Start voice chat';
  }
  return isGenerating.value ? 'Stop response' : 'End voice chat';
});

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
      await unlockAudio();
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
  isPolling.value = true;
  await unlockAudio();
  await requestMicAndStartVAD(saidSomething, stopRecording, onAnySound);
  isPolling.value = false;
  microphoneButtonMode.value = 'listen';
  agentAudio.playBeep(1000);
}

function onStopRecording(playBeep = true) {
  if (playBeep) {
    agentAudio.playBeep(600);
  }
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
  onStopRecording(false);
  hideAnimationDebounced.cancel();
  sendUserRecordDebounced.cancel();
});


</script>