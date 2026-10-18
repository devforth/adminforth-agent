<template>
  <div
    class="af-agent-approval mx-4 my-2 max-w-[min(34rem,calc(100%-2rem))] z-20 rounded-lg border p-3.5"
    :class="isAwaitingDecision
      ? 'border-lightWarningBorder bg-lightWarningSoft dark:border-darkWarningBorder dark:bg-darkWarningSoft'
      : 'border-lightCardBorder bg-lightCardBackground dark:border-darkCardBorder dark:bg-darkCardBackground'"
  >
    <div class="flex items-start gap-2.5">
      <IconShieldAlert
        class="mt-0.5 h-4 w-4 shrink-0"
        :class="isAwaitingDecision ? 'text-lightWarning dark:text-darkWarning' : 'text-lightInputIconColor dark:text-darkInputIconColor'"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold leading-5 text-lightCardTitle dark:text-darkCardTitle">{{ $t('Approval needed') }}</h3>
        <p class="text-[0.8125rem] leading-5 text-lightCardDescription dark:text-darkCardDescription">
          {{ $t('Review what the agent is about to do before continuing.') }}
        </p>
      </div>
    </div>
    <ul
      class="mt-3 divide-y rounded-default border text-[0.8125rem] leading-5
        divide-lightCardBorder border-lightCardBorder bg-lightCardBackground text-lightTableText
        dark:divide-darkCardBorder dark:border-darkCardBorder dark:bg-darkCardBackground dark:text-darkTableText"
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
            <dt class="text-lightInputIconColor dark:text-darkInputIconColor [overflow-wrap:anywhere]">{{ field.label }}</dt>
            <dd class="flex min-w-0 flex-wrap items-center gap-1.5">
              <template v-if="field.from !== undefined && field.from !== field.to">
                <span
                  class="min-w-0 rounded px-1.5 line-through [overflow-wrap:anywhere]
                    bg-lightDangerSoft text-lightDanger decoration-lightDanger/50 dark:bg-darkDangerSoft dark:text-darkDanger dark:decoration-darkDanger/50"
                >
                  {{ field.from }}
                </span>
                <IconArrowRight class="h-3.5 w-3.5 shrink-0 text-lightInputIconColor dark:text-darkInputIconColor" />
                <span
                  class="min-w-0 rounded px-1.5 font-medium [overflow-wrap:anywhere]
                    bg-lightSuccessSoft text-lightSuccess dark:bg-darkSuccessSoft dark:text-darkSuccess"
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
        <Button size="sm" type="button" @click="submit('approve')">
          <IconCheck class="h-4 w-4" />
          {{ $t('Approve') }}
        </Button>
        <Button variant="secondary" size="sm" type="button" @click="submit('reject')">
          {{ $t('Reject') }}
        </Button>
      </template>
      <span
        v-else
        class="inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium"
        :class="STATUS_BADGE_CLASSES[data.status]"
      >
        <Spinner v-if="data.status === 'processing'" class="h-3.5 w-3.5" />
        <IconCheck v-else-if="data.status === 'approved'" class="h-3.5 w-3.5" />
        <IconX v-else class="h-3.5 w-3.5" />
        {{ data.status === 'processing' ? $t('Processing') : data.status === 'approved' ? $t('Approved') : $t('Rejected') }}
      </span>
    </div>
    <p
      v-if="data.error"
      class="mt-3 text-sm leading-5 text-lightDanger dark:text-darkDanger"
    >
      {{ data.error }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { IPartData } from '../types';
import { useAgentStore } from '../composables/useAgentStore';
import { Button, Spinner } from '@/afcl';
import { IconArrowRight, IconCheck, IconShieldAlert, IconX } from '@iconify-prerendered/vue-lucide';

const props = defineProps<{
  data: IPartData;
}>();

const STATUS_BADGE_CLASSES: Record<string, string> = {
  processing: 'border-transparent bg-lightSecondaryDarken text-lightInputIconColor dark:bg-darkSecondaryLighten dark:text-darkInputIconColor',
  approved: 'border-lightSuccessBorder bg-lightSuccessSoft text-lightSuccess dark:border-darkSuccessBorder dark:bg-darkSuccessSoft dark:text-darkSuccess',
  rejected: 'border-lightDangerBorder bg-lightDangerSoft text-lightDanger dark:border-darkDangerBorder dark:bg-darkDangerSoft dark:text-darkDanger',
};

const agentStore = useAgentStore();

const isAwaitingDecision = computed(() => props.data.status === 'pending' || props.data.status === 'processing');

function submit(decision: 'approve' | 'reject') {
  if (!props.data.sessionId || props.data.status !== 'pending') {
    return;
  }

  agentStore.submitToolApproval(props.data.sessionId, decision);
}
</script>
