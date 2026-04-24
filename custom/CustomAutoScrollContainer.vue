<template>
  <CustomScrollbar
    ref="containerRef"
    class="auto-scroll-container mask-y"
    :wrapperStyle = "wrapperStyle"
    :contentStyle = "contentStyle"
    @scroll="handleScroll"
  >
    <slot />
  </CustomScrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import CustomScrollbar from 'custom-vue-scrollbar';
import 'custom-vue-scrollbar/dist/style.css';
import { useAgentStore } from './composables/useAgentStore';

const agentStore = useAgentStore();

const props = withDefaults(defineProps<{
  enabled?: boolean
  threshold?: number
  behavior?: ScrollBehavior
  wrapperStyle?: Record<string, string>
  contentStyle?: Record<string, string>
}>(), {
  enabled: true,
  threshold: 50,
  behavior: 'instant'
})

const containerRef = ref<HTMLDivElement | null>(null)
const isUserScrolledUp = ref(false)
const scrollElement = ref<HTMLElement | null>(null)

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
    const isScrollingDown = scrollTop > lastScrollTop
    const isContentUnchanged = scrollHeight === lastScrollHeight
    if ((isScrollingUp || isScrollingDown) && isContentUnchanged) {
      isUserScrolledUp.value = true
    } else if (!isNearBottom()) {
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
  container: containerRef,
  handleScroll
})
</script>

<style>
  .mask-y {
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 20px,
      black calc(100% - 20px),
      transparent
    );
  }
</style>