<template >
  <template v-if="toolGroup.length > 0">
    <span class="bg-lightNavbar absolute flex items-center justify-center w-5 h-5 bg-brand-softer rounded-full -start-[0.68rem] ring-4 ring-lightNavbar ring-default">
      <div class="w-5 h-5 rounded-full flex items-center justify-center">
        <IconWrenchSolid class="w-4 h-4" />
      </div>
    </span>
    <h3 
      class="flex items-center mb-1 text-sm my-2 ml-3 gap-1"      
    >
      <span class="font-semibold select-none ">Call tools</span>
    </h3>

    <div class="flex flex-wrap">
    <template v-for="group in props.toolGroup" :key="group.title">
      <template v-if="group.groupedTools.length > 1">
        <div
          class="max-w-64 w-auto flex items-center gap-2 px-2 m-2 py-1  
            break-all font-mono text-sm leading-5 select-none 
            text-lightListTableHeadingText dark:text-darkListTableHeadingText
            items-center justify-center border rounded-xl
          " 
          :class="!expandedGroups.includes(group.title) ? 'border rounded-xl' : ''"
          @click="toggleGroup(group.title)"
        >
          <IconCheckOutline  class="w-6 h-6 p-1"/> 
          {{ group.title }} {{ 'x' + group.groupedTools.length }} 
          <!-- <IconAngleDownOutline 
            class="transition-transform duration-200 hover:scale-105 hover:opacity-75"
            :class="expandedGroups.includes(group.title) ? 'rotate-180' : 'rotate-0'"
          /> -->
        </div>
        <!-- <transition name="expand">
          <div v-show="expandedGroups.includes(group.title)" class="flex flex-wrap gap-1">  -->
            <!-- <ToolRenderer v-if="expandedGroups.includes(group.title)" v-for="part in group.groupedTools" :key="part.toolInfo.toolCallId" :data="part"/> -->
          <!-- </div>
        </transition> -->
      </template>
      <ToolRenderer v-else-if="group.groupedTools.length > 0" :data="group.groupedTools[0]" />
    </template> 
    </div>
  </template>
</template>

<script setup lang="ts">
import ToolRenderer from './ToolRenderer.vue';
import type { IToolGroup } from '../types';
import { ref } from 'vue';
import { IconAngleDownOutline } from '@iconify-prerendered/vue-flowbite';
import { IconWrenchSolid } from '@iconify-prerendered/vue-heroicons';


const props = defineProps<{
  toolGroup: IToolGroup[]
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