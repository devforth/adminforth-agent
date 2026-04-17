<template>
  <div v-if="props.data?.toolInfo" class="inline-flex m-2 max-w-[80%] items-center gap-3 rounded-xl p-2 text-lightListTableHeadingText dark:text-darkListTableHeadingText">
    <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-blue-700/20">
      <Spinner v-if="isRunning" class="h-4 w-4" />
      <IconCheckOutline v-else class="h-4 w-4 text-lightPrimary dark:text-darkPrimary" />
    </div>

    <div class="min-w-0">
      <p class="text-xs text-gray-500 dark:text-gray-400 font-bold">
        {{ statusLabel }}
      </p>
      <p class="break-all font-mono text-sm leading-5">
        {{ props.data?.toolInfo?.toolName }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed } from 'vue';
  import { type IPartData } from './types';
  import { Spinner } from '@/afcl';
  import { IconCheckOutline } from '@iconify-prerendered/vue-flowbite';

  const props = defineProps<{
    data: {
      type: string;
      toolInfo: IPartData;
    }
  }>();

  const isRunning = computed(() => props.data?.toolInfo?.phase === 'start');
  const statusLabel = computed(() => isRunning.value ? 'Running tool' : 'Tool finished');
</script>