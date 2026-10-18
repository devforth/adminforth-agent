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
        class="flex items-center gap-2 rounded-lg border border-lightCardBorder bg-lightCardBackground py-1.5 pl-3 pr-1.5 shadow-popover dark:border-darkCardBorder dark:bg-darkCardBackground dark:shadow-darkPopover"
      >
        <span
          class="flex-1 min-w-0 truncate text-sm text-lightInputText dark:text-darkInputText"
          :title="item.text"
        >
          {{ item.text }}
        </span>
        <span class="shrink-0 text-xs text-lightInputPlaceholderText dark:text-darkInputPlaceholderText">
          {{ $t('queued') }}
        </span>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          :disabled="agentStore.isFinalResponseStreaming"
          :title="agentStore.isFinalResponseStreaming
            ? $t('The final response is streaming; this message will be sent after it finishes')
            : $t('Steer into the current response')"
          @click="agentStore.steerQueuedMessage(item.id)"
        >
          {{ $t('Steer') }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          type="button"
          :title="$t('Remove from queue')"
          :aria-label="$t('Remove from queue')"
          @click="agentStore.removeQueuedMessage(item.id)"
        >
          <IconX />
        </Button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { IconX } from '@iconify-prerendered/vue-lucide';
import { Button } from '@/afcl';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();
</script>
