<template>
  <template v-for="group in props.toolGroup" :key="group.title">
    <div v-if="group.groupedTools.length > 1" class="mb-4 flex flex-col">
      <div class="flex items-center gap-2 p-2 m-2 cursor-pointer hover:opacity-75 break-all font-mono text-sm leading-5" @click="toggleGroup(group.title)">
        - {{ group.title }} {{ 'x' + group.groupedTools.length }} 
        <IconAngleDownOutline 
          class="transition-transform duration-200 hover:scale-105 hover:opacity-75"
          :class="expandedGroups.includes(group.title) ? 'rotate-180' : 'rotate-0'"
        />
      </div>
      <transition name="expand">
        <div v-show="expandedGroups.includes(group.title)" class="flex flex-col"> 
        <ToolRenderer v-for="part in group.groupedTools" :key="part.text + part.type" :data="part" />
        </div>
      </transition>
    </div>
    <ToolRenderer v-else :data="group.groupedTools[0]" />
  </template> 

</template>

<script setup lang="ts">
import { Tool } from 'langchain';
import ToolRenderer from './ToolRenderer.vue';
import type { IPart } from './types';
import { ref } from 'vue';
import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';

const props = defineProps<{
  toolGroup: {
    title: string;
    groupedTools: IPart[];
  }[]
}>();

const expandedGroups = ref<string[]>([]);

function toggleGroup(groupTitle: string) {
  if (expandedGroups.value.includes(groupTitle)) {
    expandedGroups.value = expandedGroups.value.filter((title: string) => title !== groupTitle);
  } else {
    expandedGroups.value.push(groupTitle);
  }
}

</script>

<style scoped>

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 288px;
}

</style>