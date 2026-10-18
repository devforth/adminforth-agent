<template>
  <div
    class="af-agent-history absolute top-0 left-0 z-20 flex h-full w-96 max-w-full flex-col overflow-y-auto overflow-x-hidden
      border-r border-lightNavbarBorder bg-lightNavbar transition-transform duration-200 ease-in-out
      dark:border-darkNavbarBorder dark:bg-darkNavbar"
  >
    <h3 class="px-4 pt-4 pb-2 text-sm font-semibold text-lightNavbarText dark:text-darkNavbarText">{{ $t('Chat history') }}</h3>
    <div v-for="group in groupedSessions" :key="group.dayKey" class="px-2 py-2">
      <div class="px-2.5 pb-1 text-xs font-medium text-lightInputIconColor dark:text-darkInputIconColor">
        {{ group.label }}
      </div>
      <!-- enter and esc are handled on the wrapper so they fire once: Input spreads attrs on both its root and the input -->
      <div
        v-for="session in group.sessions"
        :key="session.sessionId"
        class="af-agent-history-row group flex items-center gap-0.5 rounded-default text-sm transition-colors"
        :class="agentStore.activeSessionId === session.sessionId
          ? 'font-medium bg-lightVerticalTabsBackgroundActive text-lightVerticalTabsTextActive dark:bg-darkVerticalTabsBackgroundActive dark:text-darkVerticalTabsTextActive'
          : 'text-lightVerticalTabsText hover:bg-lightVerticalTabsBackgroundHover hover:text-lightVerticalTabsTextHover dark:text-darkVerticalTabsText dark:hover:bg-darkVerticalTabsBackgroundHover dark:hover:text-darkVerticalTabsTextHover'"
        @keydown.enter.prevent="renamingSessionId === session.sessionId && commitRename(session)"
        @keydown.esc.prevent="renamingSessionId = null"
      >
        <Input
          v-if="renamingSessionId === session.sessionId"
          ref="renameInput"
          v-model="renameTitle"
          type="text"
          class="min-w-0 flex-1"
          fullWidth
          maxlength="100"
          :aria-label="$t('Chat name')"
          @blur="commitRename(session)"
        />
        <template v-else>
          <button
            type="button"
            class="min-w-0 flex-1 truncate rounded-default px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-[3px] focus-visible:ring-lightFocusRing dark:focus-visible:ring-darkFocusRing"
            @click="agentStore.setActiveSession(session.sessionId); agentStore.setSessionHistoryOpen(false);"
          >
            {{ session.title || session.sessionId }}
          </button>
          <Button
            v-if="session.sessionId !== PRE_SESSION_ID"
            variant="ghost"
            size="sm"
            iconOnly
            :class="ROW_ACTION_CLASSES"
            :aria-label="$t('Rename chat')"
            :title="$t('Rename chat')"
            @click="startRename(session)"
          >
            <IconPencil />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            :class="ROW_ACTION_CLASSES"
            :aria-label="$t('Delete chat')"
            :title="$t('Delete chat')"
            @click="agentStore.deleteSession(session.sessionId)"
          >
            <IconTrash2 />
          </Button>
        </template>
      </div>
    </div>
    <p
      v-if="!groupedSessions || groupedSessions.length === 0"
      class="flex flex-1 items-center justify-center px-4 text-sm text-lightInputIconColor dark:text-darkInputIconColor"
    >
      {{ $t('There are no previous chat sessions') }}
    </p>
  </div>
</template>


<script setup lang="ts">
import { Button, Input } from '@/afcl'
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { IconPencil, IconTrash2 } from '@iconify-prerendered/vue-lucide';
import type { ISessionsListItem } from './types';
import { useAgentStore } from './composables/useAgentStore';
import { PRE_SESSION_ID } from './composables/agentStore/constants';

// row actions show on hover or keyboard focus of the row, and always on touch screens which have no hover
const ROW_ACTION_CLASSES = 'hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex';

const agentStore = useAgentStore();
const renamingSessionId = ref<string | null>(null);
const renameTitle = ref('');
// the input is rendered inside v-for, so the template ref is an array with the one open input
const renameInputs = useTemplateRef<Array<{ focus: () => void }>>('renameInput');

async function startRename(session: ISessionsListItem) {
  renamingSessionId.value = session.sessionId;
  renameTitle.value = session.title;
  await nextTick();
  renameInputs.value![0].focus();
}

// called by both enter and the blur that follows when the input goes away, only the first one saves
async function commitRename(session: ISessionsListItem) {
  if (renamingSessionId.value !== session.sessionId) {
    return;
  }
  renamingSessionId.value = null;
  const title = renameTitle.value.trim();
  if (title && title !== session.title) {
    await agentStore.renameSession(session.sessionId, title);
  }
}

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