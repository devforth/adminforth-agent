<template>
  <div class="flex flex-col justify-center mr-6 md:mr-12">
    <h2 class="flex items-start justify-start leading-none text-gray-800 dark:text-gray-50 text-3xl font-semibold">
      {{ $t('Chat Surfaces') }}
    </h2>
    <p class="text-sm mt-3">
      {{ $t('Connect external chat accounts to your AdminForth user') }}
    </p>

    <div class="mt-6 flex flex-wrap gap-4">
      <div
        v-for="surface in surfaces"
        :key="surface.name"
        class="flex flex-col w-full lg:w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm"
      >
        <div class="flex items-center justify-between gap-3 mb-4">
          <div class="min-w-0">
            <p class="font-semibold text-gray-900 dark:text-white truncate">
              {{ formatSurfaceName(surface.name) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ surface.externalUserId || $t('Not connected') }}
            </p>
          </div>
          <span
            class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
            :class="surface.externalUserId
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'"
          >
            {{ surface.externalUserId ? $t('Active') : $t('Inactive') }}
          </span>
        </div>

        <div class="grid gap-2 mt-auto" :class="surface.externalUserId ? 'grid-cols-2' : 'grid-cols-1'">
          <Button
            class="w-full"
            :disabled="isSurfaceBusy(surface.name)"
            :loader="connectingSurfaceName === surface.name"
            @click="connectSurface(surface.name)"
          >
            {{ surface.externalUserId ? $t('Reconnect') : $t('Connect') }}
          </Button>
          <Button
            v-if="surface.externalUserId"
            class="w-full"
            :disabled="isSurfaceBusy(surface.name)"
            :loader="disconnectingSurfaceName === surface.name"
            @click="disconnectSurface(surface.name)"
          >
            {{ $t('Disconnect') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button } from '@/afcl';
import { callAdminForthApi } from '@/utils';

type ChatSurface = {
  name: string;
  externalUserId: string | null;
};

const surfaces = ref<ChatSurface[]>([]);
const connectingSurfaceName = ref<string | null>(null);
const disconnectingSurfaceName = ref<string | null>(null);

onMounted(loadSurfaces);

async function loadSurfaces() {
  const response = await callAdminForthApi({
    method: 'POST',
    path: '/agent/surfaces/connectable',
    body: {},
  });

  surfaces.value = response.surfaces;
}

async function connectSurface(surfaceName: string) {
  connectingSurfaceName.value = surfaceName;

  try {
    const response = await callAdminForthApi({
      method: 'POST',
      path: `/agent/surface/${surfaceName}/connect-action`,
      body: {},
    });

    if (response.action.type === 'url') {
      window.open(response.action.url, '_blank', 'noopener,noreferrer');
    }
  } finally {
    connectingSurfaceName.value = null;
  }
}

async function disconnectSurface(surfaceName: string) {
  disconnectingSurfaceName.value = surfaceName;

  try {
    await callAdminForthApi({
      method: 'POST',
      path: `/agent/surface/${surfaceName}/disconnect`,
      body: {},
    });
    await loadSurfaces();
  } finally {
    disconnectingSurfaceName.value = null;
  }
}

function isSurfaceBusy(surfaceName: string) {
  return connectingSurfaceName.value === surfaceName || disconnectingSurfaceName.value === surfaceName;
}

function formatSurfaceName(surfaceName: string) {
  return surfaceName.charAt(0).toUpperCase() + surfaceName.slice(1);
}
</script>
