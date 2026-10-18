<template>
  <div class="flex items-center gap-2">
    <Button
      variant="secondary"
      size="sm"
      iconOnly
      :title="$t('Cancel edit')"
      :aria-label="$t('Cancel edit')"
      @click="emit('cancel')"
    >
      <IconX />
    </Button>
    <Button
      size="sm"
      iconOnly
      :title="$t('Send edited message')"
      :aria-label="$t('Send edited message')"
      :disabled="confirmDisabled"
      @click="emit('confirm')"
    >
      <IconCheck />
    </Button>
  </div>
</template>

<script setup lang="ts">
import { IconCheck, IconX } from '@iconify-prerendered/vue-lucide';
import { Button } from '@/afcl';

defineProps<{
  confirmDisabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();
</script>
