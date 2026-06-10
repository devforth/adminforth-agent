<template>
  <div class="mx-4 my-3 max-w-[min(34rem,calc(100%-2rem))] rounded-lg border border-lightPrimary/30 bg-lightNavbar p-4 text-lightListTableHeadingText shadow-sm dark:border-darkPrimary/40 dark:bg-darkNavbar dark:text-darkListTableHeadingText">
    <div class="flex items-start gap-3">
      <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lightPrimary/10 text-lightPrimary dark:bg-darkPrimary/15 dark:text-darkPrimary">
        <IconExclamationCircleOutline class="h-5 w-5" />
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold leading-5">{{ $t('Approval required') }}</h3>
        <p class="mt-1 text-sm leading-5 text-lightListTableText dark:text-darkListTableText">
          {{ $t('Review the agent message before continuing.') }}
        </p>
        <button
          v-if="data.messages?.length"
          type="button"
          class="mt-3 inline-flex items-center gap-2 text-sm font-medium text-lightListTableHeadingText transition hover:opacity-80 dark:text-darkListTableHeadingText"
          @click="isExpanded = !isExpanded"
        >
          <IconChevronDownOutline
            class="h-4 w-4 transition-transform"
            :class="isExpanded ? 'rotate-180' : ''"
          />
          {{ isExpanded ? $t('Hide details') : $t('Show details') }}
          <span class="rounded-full bg-lightListTableText/10 px-2 py-0.5 text-xs text-lightListTableHeadingText dark:bg-darkListTableText/10 dark:text-darkListTableHeadingText">
            {{ data.messages.length }}
          </span>
        </button>
        <ul
          v-if="isExpanded && data.messages?.length"
          class="mt-3 space-y-1 text-sm leading-5 text-lightListTableHeadingText dark:text-darkListTableHeadingText"
        >
          <li
            v-for="message in data.messages"
            :key="message"
            class="flex gap-2"
          >
            <span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lightListTableHeadingText dark:bg-darkListTableHeadingText" />
            <span>{{ message }}</span>
          </li>
        </ul>
        <div class="mt-4 flex flex-wrap gap-2">
          <template v-if="data.status === 'pending'">
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md border border-lightButtonsBorder bg-lightButtonsBackground px-3 text-sm font-medium text-lightButtonsText transition hover:bg-lightButtonsHover dark:border-darkButtonsBorder dark:bg-darkButtonsBackground dark:text-darkButtonsText dark:hover:bg-darkButtonsHover"
              @click="submit('approve')"
            >
              <IconCheckOutline class="h-4 w-4" />
              {{ $t('Approve') }}
            </button>
            <button
              type="button"
              class="inline-flex h-9 items-center gap-2 rounded-md border border-lightListTableText/20 bg-transparent px-3 text-sm font-medium text-lightListTableHeadingText transition hover:bg-lightListTableText/10 dark:border-darkListTableText/20 dark:text-darkListTableHeadingText dark:hover:bg-darkListTableText/10"
              @click="submit('reject')"
            >
              <IconCloseOutline class="h-4 w-4" />
              {{ $t('Reject') }}
            </button>
          </template>
          <span
            v-else
            class="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm font-medium"
            :class="data.status === 'processing'
              ? 'border-lightListTableText/20 bg-lightListTableText/10 text-lightListTableHeadingText dark:border-darkListTableText/20 dark:bg-darkListTableText/10 dark:text-darkListTableHeadingText'
              : data.status === 'approved'
              ? 'border-lightListTableText/20 bg-lightListTableText/10 text-lightListTableHeadingText dark:border-darkListTableText/20 dark:bg-darkListTableText/10 dark:text-darkListTableHeadingText'
              : 'border-lightListTableText/20 bg-lightListTableText/10 text-lightListTableHeadingText dark:border-darkListTableText/20 dark:bg-darkListTableText/10 dark:text-darkListTableHeadingText'"
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
