<!--
  TEMPORARY debug helper: enqueues a test steer message into the buffer WITHOUT sending
  or steering it, so the SteerQueue enter/leave animation can be exercised without a live
  generating turn. Remove before shipping.
-->
<template>
  <div
    class="fixed bottom-[400px] left-4 z-[9999] flex items-center gap-2 rounded-lg border border-dashed border-amber-400 bg-amber-50/95 px-2.5 py-2 shadow-lg backdrop-blur dark:border-amber-500 dark:bg-amber-950/95"
  >
    <span class="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
      Steer&nbsp;debug
    </span>
    <input
      v-model="debugText"
      type="text"
      placeholder="Test steer text…"
      class="w-44 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-400 dark:border-amber-600 dark:bg-gray-800 dark:text-gray-100"
      @keydown.enter.prevent="addTestSteer"
    />
    <button
      type="button"
      class="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-600 active:bg-amber-700"
      @click="addTestSteer"
    >
      Add steer
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();
const debugText = ref('');
let counter = 0;

function addTestSteer() {
  counter += 1;
  const text = debugText.value.trim() || `Test steer #${counter}`;
  // enqueue() only pushes onto the client-side buffer — no /agent/steer, no send.
  agentStore.enqueueSteerMessage(text);
  debugText.value = '';
}
</script>
