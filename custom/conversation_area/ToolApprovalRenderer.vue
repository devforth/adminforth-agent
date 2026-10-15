<template>
  <div
    class="mx-4 my-2 max-w-[min(34rem,calc(100%-2rem))] z-20 rounded-xl border p-3.5"
    :class="isAwaitingDecision
      ? 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'
      : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'"
  >
    <div class="flex items-start gap-2.5">
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        :class="isAwaitingDecision
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'"
      >
        <IconShieldExclamation class="h-4 w-4" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold leading-5 text-gray-900 dark:text-gray-100">{{ $t('Approval needed') }}</h3>
        <p class="text-[0.8125rem] leading-5 text-gray-600 dark:text-gray-300">
          {{ $t('Review what the agent is about to do before continuing.') }}
        </p>
      </div>
    </div>
    <ul
      class="mt-3 divide-y rounded-lg border bg-white text-[0.8125rem] leading-5 text-gray-800
        divide-gray-100 border-gray-200 dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200"
    >
      <li
        v-for="(approval, approvalIndex) in data.approvals"
        :key="approvalIndex"
        class="px-3 py-2.5"
      >
        <p class="font-medium [overflow-wrap:anywhere]">{{ approval.summary }}</p>
        <dl
          v-if="approval.fields.length"
          class="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5"
        >
          <template v-for="(field, fieldIndex) in approval.fields" :key="fieldIndex">
            <dt class="text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere]">{{ field.label }}</dt>
            <dd class="flex min-w-0 flex-wrap items-center gap-1.5">
              <template v-if="field.from !== undefined && field.from !== field.to">
                <span
                  class="min-w-0 rounded px-1.5 line-through [overflow-wrap:anywhere]
                    bg-red-50 text-red-700 decoration-red-700/50 dark:bg-red-500/15 dark:text-red-300 dark:decoration-red-300/50"
                >
                  {{ field.from }}
                </span>
                <IconArrowRight class="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span
                  class="min-w-0 rounded px-1.5 font-medium [overflow-wrap:anywhere]
                    bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                >
                  {{ field.to }}
                </span>
              </template>
              <span v-else class="min-w-0 font-medium [overflow-wrap:anywhere]">{{ field.to }}</span>
            </dd>
          </template>
        </dl>
      </li>
    </ul>
    <div class="mt-3 flex flex-wrap gap-2">
      <template v-if="data.status === 'pending'">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-medium transition-opacity duration-150
            bg-lightPrimary text-lightPrimaryContrast hover:opacity-90 dark:bg-darkPrimary dark:text-darkPrimaryContrast"
          @click="submit('approve')"
        >
          <IconCheck class="h-4 w-4" />
          {{ $t('Approve') }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center rounded-lg border px-3 text-[0.8125rem] font-medium transition-colors duration-150
            border-gray-300 bg-white text-gray-700 hover:bg-gray-50
            dark:border-gray-600 dark:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700/50"
          @click="submit('reject')"
        >
          {{ $t('Reject') }}
        </button>
      </template>
      <span
        v-else
        class="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[0.8125rem] font-medium
          bg-white text-gray-700 dark:bg-gray-900/40 dark:text-gray-200"
      >
        <Spinner v-if="data.status === 'processing'" class="h-4 w-4" />
        <IconCheck v-else-if="data.status === 'approved'" class="h-4 w-4" />
        <IconXMark v-else class="h-4 w-4" />
        {{ data.status === 'processing' ? $t('Processing') : data.status === 'approved' ? $t('Approved') : $t('Rejected') }}
      </span>
    </div>
    <p
      v-if="data.error"
      class="mt-3 text-sm leading-5 text-red-600 dark:text-red-400"
    >
      {{ data.error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { IPartData } from '../types';
import { useAgentStore } from '../composables/useAgentStore';
import { Spinner } from '@/afcl';
import { IconArrowRight, IconCheck, IconShieldExclamation, IconXMark } from '@iconify-prerendered/vue-heroicons';

const props = defineProps<{
  data: IPartData;
}>();

const agentStore = useAgentStore();

const isAwaitingDecision = computed(() => props.data.status === 'pending' || props.data.status === 'processing');

function submit(decision: 'approve' | 'reject') {
  if (!props.data.sessionId || props.data.status !== 'pending') {
    return;
  }

  agentStore.submitToolApproval(props.data.sessionId, decision);
}
</script>
