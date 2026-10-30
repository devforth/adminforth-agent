<template>
  <div v-if="agentStore.attachments.length" class="af-agent-composer-attachments flex flex-wrap gap-2 px-3 pt-3">
    <div
      v-for="attachment in agentStore.attachments"
      :key="attachment.id"
      class="af-agent-composer-attachment relative"
    >
      <!-- natural proportions: a cropped square would be zoomed cropped too -->
      <ZoomableImage
        :src="attachment.url"
        class="block max-h-14 max-w-28 rounded-default border border-lightInputBorder dark:border-darkInputBorder"
      />
      <Button
        variant="secondary"
        size="sm"
        iconOnly
        type="button"
        class="af-agent-composer-attachment-remove absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full [&>svg]:w-3 [&>svg]:h-3"
        :disabled="agentStore.isUploadingAttachments"
        :title="$t('Remove image')"
        :aria-label="$t('Remove image')"
        @click="agentStore.removeAttachment(attachment.id)"
      >
        <IconX />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IconX } from '@iconify-prerendered/vue-lucide';
import { Button, ZoomableImage } from '@/afcl';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();
</script>
