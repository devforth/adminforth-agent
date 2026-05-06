<template>
  <p :class="`${TEXT_CLASSES}`" v-if="message === RESERVED_SYSTEM_MESSAGE_CONTENT.START_AUDIO_CHAT">
    <IconPhoneSolid class="inline-block w-4 h-4 mr-1" />
    {{$t('Audio chat started')}}
  </p>
  <p :class="`${TEXT_CLASSES}`" v-else-if="message === RESERVED_SYSTEM_MESSAGE_CONTENT.END_AUDIO_CHAT">
    <IconPhoneHangupSolid class="inline-block w-4 h-4 mr-1" />
    {{$t('Audio chat ended')}}
  </p>
  <p :class="`${TEXT_CLASSES}`" v-else-if="message === RESERVED_SYSTEM_MESSAGE_CONTENT.AGENT_RESPONSE_ABORTED">
    {{$t('Agent response aborted')}}
  </p>

</template>



<script setup lang="ts">
import { RESERVED_SYSTEM_MESSAGE_CONTENT } from '../composables/agentStore/constants';
import { IconPhoneSolid, IconPhoneHangupSolid } from '@iconify-prerendered/vue-flowbite';

const TEXT_CLASSES = 'text-center italic  text-lightListTableHeadingText dark:text-darkListTableHeadingText flex items-center justify-center';

const props = defineProps<{ 
  message: string
}>();

</script>