<template>
  <Teleport to="body">
    <div
      class="af-agent-image-lightbox fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-10 bg-black/80"
      role="dialog"
      aria-modal="true"
      :aria-label="props.name"
      @click.self="emit('close')"
    >
      <img :src="props.url" :alt="props.name" class="max-w-full max-h-full rounded-default object-contain" />
      <button
        ref="closeButton"
        type="button"
        class="absolute top-3 right-3 flex items-center justify-center w-9 h-9 rounded-full text-white/80 hover:text-white hover:bg-white/10
          focus:outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
        :title="$t('Close')"
        :aria-label="$t('Close')"
        @click="emit('close')"
      >
        <IconX class="w-5 h-5" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, useTemplateRef } from 'vue';
import { IconX } from '@iconify-prerendered/vue-lucide';
import { onKeyStroke } from '@vueuse/core';

const props = defineProps<{
  url: string;
  name: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const closeButton = useTemplateRef('closeButton');

onKeyStroke('Escape', () => emit('close'));

onMounted(() => closeButton.value?.focus());
</script>
