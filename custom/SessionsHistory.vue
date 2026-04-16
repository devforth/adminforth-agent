<template>
  <div class="absolute top-0 left-0 transition-transform 
    duration-200 ease-in-out border-y border-r dark:border-gray-600 z-20 
    bg-lightNavbar dark:bg-darkNavbar w-96 h-full flex flex-col items-center
    overflow-y-auto overflow-x-hidden
    "
  >
    <h3 :class="h3Style">{{ $t('Chat history') }}</h3>
    <Button @click="agentStore.createPreSession()" class="w-[360px] mx-4 my-2 mb-4 rounded-3xl text-gray-800 dark:text-gray-200">
      <IconPlusOutline class="w-5 h-5" />
      {{ $t('New chat') }}
    </Button>
    <div class="w-full border-b border-gray-200 dark:border-gray-700"/>

    <div v-for="session in agentStore.sessionList" :key="session.sessionId" 
      class="flex items-center justify-between w-full px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 ease-in-out text-gray-800 dark:text-gray-200"
      :class="{'bg-lightPrimary/20 hover:bg-lightPrimary/20 dark:bg-darkPrimary/20 dark:hover:bg-darkPrimary/20': agentStore.activeSessionId === session.sessionId}"
      @click="agentStore.setActiveSession(session.sessionId)"
    >
      {{ session.title || session.sessionId }}
      <div @click="agentStore.deleteSession(session.sessionId)" class=" w-7 h-7 p-1 hover:scale-110 hover:bg-gray-200 dark:hover:bg-gray-500 flex items-center justify-center rounded">
        <IconPlusOutline class="rotate-45 w-6 h-6"/>
      </div>
    </div>
  </div>
</template>


<script setup lang="ts">
import { Button } from '@/afcl'
import { IconPlusOutline } from '@iconify-prerendered/vue-flowbite';
import { useAgentStore } from './useAgentStore';

const agentStore = useAgentStore();

const h3Style = "text-gray-800 dark:text-gray-200 font-medium text-xl tracking-widest mt-4"

</script>