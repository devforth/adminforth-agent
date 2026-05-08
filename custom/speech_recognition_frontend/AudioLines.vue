<template>
  <div
    v-for="(height, index) in lineHeights"
    :key="index"
    class="bg-white w-[0.2rem] rounded-sm transition-all duration-100 ease-out"
    :style="{ height }"
  />
  <p v-if="isRecording" class="text-white ml-2">{{ $t('End') }}</p>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const IDLE_LINE_HEIGHTS = [0.5, 1, 0.75, 0.5];
const RECORDING_LINE_WEIGHTS = [0.45, 1, 0.75, 0.9, 0.55];
const MIN_RECORDING_HEIGHT = 0.25;
const MAX_RECORDING_DELTA = 0.9;

const props = defineProps<{
  showAnimation: boolean;
  isRecording: boolean;
  amplitude: number;
}>();

const normalizedAmplitude = computed(() => {
  if (!props.isRecording || !props.showAnimation) {
    return 0;
  }

  return Math.min(Math.max(props.amplitude, 0), 1);
});

const lineHeights = computed(() => {
  if (!props.isRecording) {
    return IDLE_LINE_HEIGHTS.map((height) => `${height}rem`);
  }

  return RECORDING_LINE_WEIGHTS.map((weight) => {
    const height = MIN_RECORDING_HEIGHT + normalizedAmplitude.value * MAX_RECORDING_DELTA * weight;
    return `${height}rem`;
  });
});
</script>