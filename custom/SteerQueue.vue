<template>
  <div
    v-if="agentStore.steerQueue.length"
    class="absolute bottom-full left-0 w-full mb-2 flex flex-col gap-1.5 px-2 z-20"
  >
    <TransitionGroup
      appear
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0 translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-for="item in agentStore.steerQueue"
        :key="item.id"
        class="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 shadow-sm dark:border-gray-600 dark:bg-gray-800"
      >
        <span
          class="flex-1 min-w-0 truncate text-sm text-lightInputText dark:text-darkInputText"
          :title="item.text"
        >
          {{ item.text }}
        </span>
        <span class="shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {{ $t('queued') }}
        </span>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-lightPrimary transition-colors hover:bg-lightPrimary/10 dark:text-darkPrimary dark:hover:bg-darkPrimary/10"
          :title="$t('Steer into the current response')"
          @click="agentStore.steerQueuedMessage(item.id)"
        >
          {{ $t('Steer') }}
        </button>
        <button
          type="button"
          class="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-lg leading-none text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          :title="$t('Remove from queue')"
          @click="agentStore.removeQueuedMessage(item.id)"
        >
          &times;
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();
</script>
