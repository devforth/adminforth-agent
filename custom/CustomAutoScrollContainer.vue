<template>
  <CustomScrollbar
    ref="containerRef"
    class="auto-scroll-container"
    :wrapperStyle = "{ 
      maxHeight: '100%',
      maxWidth: agentStore.isFullScreen ? agentStore.MAX_WIDTH+'rem' : '100%',
      width: '100%',
      marginLeft: 'auto',
      marginRight: 'auto'
    }"
  >
    <slot />
  </CustomScrollbar>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import CustomScrollbar from 'custom-vue-scrollbar';
import 'custom-vue-scrollbar/dist/style.css';
import { useScroll } from '@vueuse/core'
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();

const props = withDefaults(defineProps<{
  enabled?: boolean
  threshold?: number
  behavior?: ScrollBehavior
}>(), {
  enabled: true,
  threshold: 50,
  behavior: 'instant'
})

const containerRef = ref<HTMLDivElement | null>(null)
const isUserScrolledUp = ref(false)
const scrollElement = ref<HTMLElement | null>(null)
const { y } = useScroll(scrollElement)

watch(y, () => {
  handleScroll()
})

let lastScrollTop = 0
let lastScrollHeight = 0

function isNearBottom(): boolean {
  const container = containerRef.value?.scrollEl
  if (!container) return true
  
  const { scrollTop, scrollHeight, clientHeight } = container
  return scrollHeight - scrollTop - clientHeight <= props.threshold
}

function scrollToBottom(force = false): void {
  const container = containerRef.value?.scrollEl
  if (!container) return
  
  if (isUserScrolledUp.value && !force) return
  
  container.scrollTo({
    top: container.scrollHeight,
    behavior: props.behavior
  })
}


function hasScrollbar(): boolean {
  const container = containerRef.value?.scrollEl
  if (!container) return false
  return container.scrollHeight > container.clientHeight
}


function handleScroll(): void {
  const container = containerRef.value.scrollEl
  if (!container) return
  
  const { scrollTop, scrollHeight, clientHeight } = container
  
  if (scrollHeight <= clientHeight) {
    isUserScrolledUp.value = false
    lastScrollTop = 0
    lastScrollHeight = scrollHeight
    return
  }
  
  if (isNearBottom()) {
    isUserScrolledUp.value = false
  } else {
    const isScrollingUp = scrollTop < lastScrollTop
    const isContentUnchanged = scrollHeight === lastScrollHeight
    
    if (isScrollingUp && isContentUnchanged) {
      isUserScrolledUp.value = true
    }
  }
  
  lastScrollTop = scrollTop
  lastScrollHeight = scrollHeight
}

let observer: MutationObserver | null = null

onMounted(() => {
  if (!containerRef.value) return
  
  scrollElement.value = containerRef.value.scrollEl
  lastScrollTop = containerRef.value.scrollEl.scrollTop
  lastScrollHeight = containerRef.value.scrollEl.scrollHeight
  
  observer = new MutationObserver(() => {
    nextTick(() => {
      if (!containerRef.value?.scrollEl) return
      
      if (!hasScrollbar()) {
        isUserScrolledUp.value = false
      }
      
      lastScrollHeight = containerRef.value.scrollEl.scrollHeight
      
      if (props.enabled && !isUserScrolledUp.value) {
        scrollToBottom()
      }
    })
  })
  
  observer.observe(containerRef.value?.scrollEl, {
    childList: true,
    subtree: true,
    characterData: true
  })
})

onUnmounted(() => {
  observer?.disconnect()
})

defineExpose({
  scrollToBottom: () => scrollToBottom(true),
  isUserScrolledUp: () => isUserScrolledUp.value,
  container: containerRef
})
</script>
