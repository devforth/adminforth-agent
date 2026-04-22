<template>
  <template v-if="ToolOrReasoningParts.length > 0">
    <ol class="relative border-s border-default">                  
        <li class="mb-6 ms-2" v-for="(part, index) in ToolOrReasoningParts" :key="index">            
            <ReasoningRenderer v-if="part.type === 'reasoning'" :part="part" />
            <!-- <ToolRenderer v-else-if="part.type === 'data-tool-call'" :part="part" /> -->
        </li>
    </ol>
  </template>
</template>



<script setup lang="ts">
  import type { IMessage, IPart } from '../types';
  import { onMounted, ref, computed } from 'vue';
  import ReasoningRenderer from './ReasoningRenderer.vue';
  import ToolRenderer from './ToolRenderer.vue';
  import { IconWrenchSolid } from '@iconify-prerendered/vue-heroicons';

  const props = defineProps<{
    message: IMessage
  }>()
  const ToolOrReasoningParts = computed(() => {
    return props.message.parts.filter((part: IPart) => part.type === 'data-tool-call' || part.type === 'reasoning');
  });


</script>