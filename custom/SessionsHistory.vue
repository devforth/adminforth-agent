<template>
  <div class="absolute top-0 left-0 transition-transform 
    duration-200 ease-in-out border-y border-r dark:border-gray-600 z-20 
    bg-lightNavbar dark:bg-darkNavbar w-96 h-full flex flex-col items-center
    overflow-y-auto overflow-x-hidden overscroll-contain
    "
  >
    <h3 :class="h3Style">{{ $t('Chat history') }}</h3>
    <div class="w-full flex items-center justify-center">
    </div>
    <div class="w-full border-b border-gray-200 dark:border-gray-700"/>
    <div class="absolute w-full h-full flex flex-col items-center justify-center bg-gray-100/50 dark:bg-gray-700/50 z-10" v-if="agentStore.isResponseInProgress">
      <Spinner class="w-8 h-8" v-if="agentStore.isResponseInProgress" />
      <p class="mt-2 text-gray-800 dark:text-gray-200">{{ $t('Generation in progress...') }}</p>
    </div>
    <div v-for="group in groupedSessions" :key="group.dayKey" class="w-full py-2">
      <div class="px-4 pb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
        {{ group.label }}
      </div>

      <button
        v-for="session in group.sessions"
        :key="session.sessionId"
        class=" flex items-center justify-between w-full px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 ease-in-out text-gray-800 dark:text-gray-200"
        :class="{
          'bg-lightPrimary/20 hover:bg-lightPrimary/20 dark:bg-darkPrimary/20 dark:hover:bg-darkPrimary/20': agentStore.activeSessionId === session.sessionId, 
          'cursor-default opacity-50 pointer-events-none': agentStore.isResponseInProgress,
         }"
        @click="agentStore.setActiveSession(session.sessionId); agentStore.setSessionHistoryOpen(false);"
        :disabled="agentStore.isResponseInProgress"
      >
        <p class="truncate">{{ session.title || session.sessionId }}</p>
        <div @click.stop="agentStore.deleteSession(session.sessionId)" class="w-7 h-7 p-1 hover:scale-110 hover:bg-gray-200 dark:hover:bg-gray-500 flex items-center justify-center rounded">
          <IconPlusOutline class="rotate-45 w-6 h-6"/>
        </div>
      </button>
    </div>
    <p
      v-if="!groupedSessions || groupedSessions.length === 0"
      class="w-full h-full flex items-center justify-center text-gray-800 dark:text-gray-200"
    >
      {{ $t('There are no previous chat sessions') }}
    </p>
  </div>
</template>


<script setup lang="ts">
import { Button, Spinner } from '@/afcl'
import { computed } from 'vue';
import { IconPlusOutline } from '@iconify-prerendered/vue-flowbite';
import type { ISessionsListItem } from './types';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();

const h3Style = "text-gray-800 dark:text-gray-200 font-medium text-xl tracking-widest my-2"
const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayLabelWithYearFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const groupedSessions = computed(() => {
  const groups = new Map<string, { dayKey: string; label: string; sessions: ISessionsListItem[] }>();

  for (const session of agentStore.sessionList) {
    const date = new Date(session.timestamp);
    const dayKey = getLocalDayKey(date);
    const label = date.getFullYear() === new Date().getFullYear()
      ? dayLabelFormatter.format(date)
      : dayLabelWithYearFormatter.format(date);

    if (!groups.has(dayKey)) {
      groups.set(dayKey, {
        dayKey,
        label,
        sessions: [],
      });
    }

    groups.get(dayKey)!.sessions.push(session);
  }

  return Array.from(groups.values());
});


function getLocalDayKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

</script>