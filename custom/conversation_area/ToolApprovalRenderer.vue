<template>
  <div class="mx-4 my-3 max-w-[min(34rem,calc(100%-2rem))] rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-700/80 dark:bg-amber-950/30 dark:text-amber-100">
    <div class="flex items-start gap-3">
      <IconExclamationCircleOutline class="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold leading-5">{{ $t('Approval required') }}</h3>
        <p class="mt-1 text-sm leading-5 text-amber-900/90 dark:text-amber-100/90">
          {{ $t('Review the agent message before continuing.') }}
        </p>
        <button
          v-if="data.messages?.length"
          type="button"
          class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-amber-900 transition hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-200"
          @click="isExpanded = !isExpanded"
        >
          <IconChevronDownOutline
            class="h-4 w-4 transition-transform"
            :class="isExpanded ? 'rotate-180' : ''"
          />
          {{ isExpanded ? $t('Hide details') : $t('Show details') }}
          <span class="text-amber-800/80 dark:text-amber-100/80">
            {{ data.messages.length }}
          </span>
        </button>
        <ul
          v-if="isExpanded && data.messages?.length"
          class="mt-3 space-y-1 text-sm leading-5 text-amber-950 dark:text-amber-50"
        >
          <li
            v-for="message in data.messages"
            :key="message"
            class="flex gap-2"
          >
            <span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-300" />
            <span>{{ message }}</span>
          </li>
        </ul>
        <div class="mt-4 flex flex-wrap gap-2">
          <template v-if="data.status === 'pending'">
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md bg-lightPrimary px-3 text-sm font-medium text-white transition hover:opacity-90 dark:bg-darkPrimary"
              @click="submit('approve')"
            >
              <IconCheckOutline class="h-4 w-4" />
              {{ $t('Approve') }}
            </button>
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-sm font-medium text-amber-950 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/40"
              @click="submit('reject')"
            >
              <IconCloseOutline class="h-4 w-4" />
              {{ $t('Reject') }}
            </button>
          </template>
          <span
            v-else
            class="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium"
            :class="data.status === 'processing'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
              : data.status === 'approved'
              ? 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'"
          >
            <IconCheckOutline v-if="data.status === 'approved'" class="h-4 w-4" />
            <IconCloseOutline v-else-if="data.status === 'rejected'" class="h-4 w-4" />
            {{ data.status === 'processing' ? $t('Processing') : data.status === 'approved' ? $t('Approved') : $t('Rejected') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { IPartData } from '../types';
import { useAgentStore } from '../composables/useAgentStore';
import { ref } from 'vue';
import { IconCheckOutline, IconChevronDownOutline, IconCloseOutline, IconExclamationCircleOutline } from '@iconify-prerendered/vue-flowbite';

const props = defineProps<{
  data: IPartData;
}>();

const agentStore = useAgentStore();
const isExpanded = ref(false);

function submit(decision: 'approve' | 'reject') {
  if (!props.data.sessionId || props.data.status !== 'pending') {
    return;
  }

  agentStore.submitToolApproval(props.data.sessionId, decision);
}
</script>
