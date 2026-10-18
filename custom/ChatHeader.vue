<template>
  <!-- in full screen the controls line up with the centered column of the conversation -->
  <div
    ref="headerRef"
    class="af-agent-header flex items-center gap-0.5 h-12 px-2 border-b border-lightNavbarBorder dark:border-darkNavbarBorder"
    :style="agentStore.isFullScreen ? { paddingInline: `max(0.5rem, calc((100% - ${agentStore.MAX_WIDTH}rem) / 2 + 0.5rem))` } : undefined"
  >
    <Button
      variant="ghost"
      iconOnly
      :class="agentStore.isSessionHistoryOpen && PRESSED_CLASSES"
      :aria-pressed="agentStore.isSessionHistoryOpen"
      :aria-label="$t('Chat history')"
      :title="$t('Chat history')"
      @click="agentStore.setSessionHistoryOpen(!agentStore.isSessionHistoryOpen)"
    >
      <IconHistory />
    </Button>
    <Button
      v-if="!coreStore.isMobile && !agentStore.isFullScreen"
      variant="ghost"
      iconOnly
      :class="agentStore.isTeleportedToBody && PRESSED_CLASSES"
      :aria-pressed="agentStore.isTeleportedToBody"
      :aria-label="$t('Dock to the side')"
      :title="$t('Dock to the side')"
      @click="agentStore.setIsTeleportedToBody(!agentStore.isTeleportedToBody)"
    >
      <IconPanelRight />
    </Button>
    <Button
      v-if="!coreStore.isMobile"
      variant="ghost"
      iconOnly
      :aria-label="agentStore.isFullScreen ? $t('Exit full screen') : $t('Full screen')"
      :title="agentStore.isFullScreen ? $t('Exit full screen') : $t('Full screen')"
      @click="agentStore.setFullScreen(!agentStore.isFullScreen)"
    >
      <IconMinimize2 v-if="agentStore.isFullScreen" />
      <IconMaximize2 v-else />
    </Button>
    <p class="flex-1 min-w-0 truncate px-1 text-[13px] font-semibold text-lightNavbarText dark:text-darkNavbarText">
      {{ isNewChat ? $t('New chat') : agentStore.currentSession.title }}
    </p>
    <Button
      variant="secondary"
      class="shrink-0"
      @click="agentStore.createPreSession(); agentStore.setSessionHistoryOpen(false); agentStore.focusTextInput();"
    >
      <IconPlus class="w-4 h-4" />
      {{ $t('New chat') }}
    </Button>
    <Button
      variant="ghost"
      iconOnly
      :aria-label="$t('Close')"
      :title="$t('Close')"
      @click="agentStore.setIsChatOpen(false)"
    >
      <IconX />
    </Button>
  </div>
</template>


<script setup>
  import { computed } from 'vue';
  import { IconHistory, IconMaximize2, IconMinimize2, IconPanelRight, IconPlus, IconX } from '@iconify-prerendered/vue-lucide';
  import { useAgentStore } from './composables/useAgentStore';
  import { useCoreStore } from '@/stores/core';
  import { Button } from '@/afcl';
  import { PRE_SESSION_ID } from './composables/agentStore/constants';

  // a toggle in the on state, same fill as the hover of a ghost button
  const PRESSED_CLASSES = 'bg-lightSecondaryDarken text-lightInputText dark:bg-darkSecondaryLighten dark:text-darkInputText';

  const agentStore = useAgentStore();
  const coreStore = useCoreStore();

  const isNewChat = computed(() => !agentStore.currentSession || agentStore.currentSession.sessionId === PRE_SESSION_ID);
</script>