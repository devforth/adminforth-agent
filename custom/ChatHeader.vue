<template>
  <div 
    ref="headerRef"
    class="flex items-center justify-between h-14 border-b border-gray-200 dark:border-gray-700"         
  >
    <div 
      class="flex items-center"
    >
      <IconBarsOutline 
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 "
        :class="agentStore.isSessionHistoryOpen ? 
          'bg-lightNavbarIcons/20 text-lightNavbarIcons/80 dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80' : 
          ''" 
        @click="agentStore.setSessionHistoryOpen(!agentStore.isSessionHistoryOpen)" 
      />
      <IconOpenSidebarSolid 
        v-if="!agentStore.isTeleportedToBody && !coreStore.isMobile && !agentStore.isFullScreen"
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setIsTeleportedToBody(true)" 
      />
      <IconCloseSidebarSolid 
        v-else-if="!coreStore.isMobile && !agentStore.isFullScreen"
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 bg-lightNavbarIcons/20 
          dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80 hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setIsTeleportedToBody(false)" 
      />
      <IconArrowsPointingOut 
        v-if="!agentStore.isFullScreen && !coreStore.isMobile"
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setFullScreen(true)" 
      />
      <IconArrowsPointingIn 
        v-else-if="!coreStore.isMobile"
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 "
        :class="agentStore.isFullScreen ? 
          'bg-lightNavbarIcons/20 text-lightNavbarIcons/80 dark:bg-darkNavbarIcons/20 dark:text-darkNavbarIcons/80' : 
          ''" 
        @click="agentStore.setFullScreen(false)" 
      />
    </div>
    <div class="flex items-center justify-center">
      <Button 
        @click="agentStore.createPreSession(); agentStore.setSessionHistoryOpen(false); agentStore.focusTextInput();" 
        class="!py-1 !px-2 rounded-3xl text-gray-800 dark:text-gray-200 max-w-64 mr-2"
      >
        <IconPlusOutline class="w-5 h-5" />
        {{ $t('New chat') }}
      </Button>
      <IconCloseOutline 
        class="m-2 w-8 h-8 p-1 cursor-pointer hover:scale-110 rounded transition-colors duration-200
          text-lightNavbarIcons hover:text-lightNavbarIcons/80 hover:bg-lightNavbarIcons/20 
          dark:text-darkNavbarIcons hover:text-darkNavbarIcons/80 hover:bg-darkNavbarIcons/20 " 
        @click="agentStore.setFullScreen(false); agentStore.setIsChatOpen(false)" 
      />
    </div>
  </div>
</template>


<script setup>
  import { IconArrowsPointingOut, IconArrowsPointingIn } from '@iconify-prerendered/vue-heroicons';
  import { IconCloseOutline, IconBarsOutline, IconCloseSidebarSolid, IconOpenSidebarSolid, IconPlusOutline } from '@iconify-prerendered/vue-flowbite';
  import { useAgentStore } from './composables/useAgentStore';
  import { useCoreStore } from '@/stores/core';
  import { Button } from '@/afcl';

  const agentStore = useAgentStore();
  const coreStore = useCoreStore();
</script>