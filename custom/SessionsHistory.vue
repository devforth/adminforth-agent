<template>
  <div class="absolute top-0 left-0 transition-transform 
    duration-200 ease-in-out border-y border-r z-20 
    bg-white w-96 h-full flex flex-col items-center
    "
  >
    <h3 :class="h3Style">{{ $t('Chat history') }}</h3>
    <Button @click="defineEmites('newSession')" class="w-[360px] mx-4 my-2 mb-4 rounded-3xl">
      <IconPlusOutline class="w-5 h-5" />
      {{ $t('New chat') }}
    </Button>
    <div class="w-full border-b"/>
  </div>
</template>


<script setup lang="ts">
import { Button } from '@/afcl'
import { IconPlusOutline } from '@iconify-prerendered/vue-flowbite';

const h3Style = "text-gray-800 font-medium text-xl tracking-widest mt-4"

const defineEmites = defineEmits<{
  (e: 'openSession', sessionId: string): void,
  (e: 'deleteSession', sessionId: string): void,
  (e: 'newSession'): void,
}>()
</script>