<template>
  <div class="af-agent-composer-attachments flex flex-wrap gap-2 px-3 pt-3">
    <div
      v-for="attachment in agentStore.composerAttachments"
      :key="attachment.id"
      class="relative"
      :title="attachment.error ?? attachment.name"
    >
      <img
        :src="attachment.localUrl"
        :alt="attachment.name"
        class="w-14 h-14 rounded-lg object-cover border"
        :class="attachment.status === 'error'
          ? 'border-lightDangerBorder dark:border-darkDangerBorder'
          : 'border-lightInputBorder dark:border-darkInputBorder'"
      />
      <div
        v-if="attachment.status === 'uploading'"
        class="absolute inset-0 flex items-center justify-center rounded-lg bg-lightInputBackground/60 dark:bg-darkInputBackground/60"
      >
        <Spinner class="w-5 h-5" />
      </div>
      <div
        v-else-if="attachment.status === 'error'"
        class="absolute inset-0 flex items-center justify-center rounded-lg bg-lightDangerSoft/80 dark:bg-darkDangerSoft/80"
      >
        <IconTriangleAlert class="w-5 h-5 text-lightDanger dark:text-darkDanger" />
      </div>
      <button
        type="button"
        class="absolute -top-1.5 -right-1.5 flex items-center justify-center w-5 h-5 rounded-full border shadow-popover
          border-lightCardBorder bg-lightCardBackground text-lightInputIconColor hover:text-lightInputText
          dark:border-darkCardBorder dark:bg-darkCardBackground dark:text-darkInputIconColor dark:hover:text-darkInputText dark:shadow-darkPopover
          focus:outline-none focus-visible:ring-[3px] focus-visible:ring-lightFocusRing dark:focus-visible:ring-darkFocusRing"
        :title="$t('Remove image')"
        :aria-label="$t('Remove image')"
        @click="agentStore.removeComposerAttachment(attachment.id)"
      >
        <IconX class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconTriangleAlert, IconX } from '@iconify-prerendered/vue-lucide';
import { Spinner } from '@/afcl';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();
</script>
