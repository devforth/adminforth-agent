<template>
  <div class="af-agent-message-attachments flex flex-wrap justify-end gap-1.5 max-w-[82%] mb-1">
    <button
      v-for="(part, index) in props.parts"
      :key="index"
      type="button"
      class="block overflow-hidden rounded-lg border border-lightCardBorder dark:border-darkCardBorder cursor-zoom-in
        focus:outline-none focus-visible:ring-[3px] focus-visible:ring-lightFocusRing dark:focus-visible:ring-darkFocusRing"
      :title="part.filename"
      :aria-label="$t('Open image')"
      @click="openedPart = part"
    >
      <img :src="part.url" :alt="part.filename" class="w-24 h-24 object-cover" loading="lazy" />
    </button>
    <ImageLightbox
      v-if="openedPart"
      :url="openedPart.url!"
      :name="openedPart.filename!"
      @close="openedPart = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { IPart } from '../types';
import ImageLightbox from './ImageLightbox.vue';

const props = defineProps<{
  parts: IPart[];
}>();

const openedPart = ref<IPart | null>(null);
</script>
