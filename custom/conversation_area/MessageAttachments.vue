<template>
  <div class="af-agent-message-attachments self-end flex flex-wrap justify-end gap-2 mr-4 mb-1">
    <ZoomableImage
      v-for="attachment in attachments"
      :key="attachment.url"
      :src="attachment.url"
      class="max-w-48 max-h-24 rounded-default border border-lightInputBorder dark:border-darkInputBorder"
      @error="agentStore.refreshAttachmentUrls()"
    />
  </div>
</template>

<script setup lang="ts">
import { ZoomableImage } from '@/afcl';
import { useAgentStore } from '../composables/useAgentStore';

defineProps<{
  attachments: Array<{ url: string }>;
}>();

const agentStore = useAgentStore();
</script>
