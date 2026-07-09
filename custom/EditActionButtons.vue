<template>
  <div class="flex items-center gap-3">
    <Button
      variant="secondary"
      class="!p-0 h-7 w-7 mr-1 bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
      title="Cancel edit"
      @click="emit('cancel')"
    >
      <IconCloseOutline class="w-5 h-5" />
    </Button>
    <Button
      class="!p-0 h-7 w-7"
      title="Send edited message"
      :disabled="confirmDisabled"
      @click="emit('confirm')"
    >
      <IconCheckOutline class="w-6 h-6 text-white" />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { IconCloseOutline, IconCheckOutline } from '@iconify-prerendered/vue-flowbite';
import { Button } from '@/afcl';

defineProps<{
  confirmDisabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();
</script>
