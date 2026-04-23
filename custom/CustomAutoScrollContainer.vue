<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import vueCustomScrollbar from 'vue-custom-scrollbar'

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

let lastScrollTop = 0
let lastScrollHeight = 0

function isNearBottom(): boolean {
  const container = containerRef.value
  if (!container) return true
  
  const { scrollTop, scrollHeight, clientHeight } = container
  return scrollHeight - scrollTop - clientHeight <= props.threshold
}

function scrollToBottom(force = false): void {
  const container = containerRef.value
  if (!container) return
  
  if (isUserScrolledUp.value && !force) return
  
  container.scrollTo({
    top: container.scrollHeight,
    behavior: props.behavior
  })
}


function hasScrollbar(): boolean {
  const container = containerRef.value
  if (!container) return false
  return container.scrollHeight > container.clientHeight
}


function handleScroll(): void {
  const container = containerRef.value
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
  
  lastScrollTop = containerRef.value.scrollTop
  lastScrollHeight = containerRef.value.scrollHeight
  
  observer = new MutationObserver(() => {
    nextTick(() => {
      if (!containerRef.value) return
      
      if (!hasScrollbar()) {
        isUserScrolledUp.value = false
      }
      
      lastScrollHeight = containerRef.value.scrollHeight
      
      if (props.enabled && !isUserScrolledUp.value) {
        scrollToBottom()
      }
    })
  })
  
  observer.observe(containerRef.value, {
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

<template>
  <div
    ref="containerRef"
    class="auto-scroll-container h-full"
    @scroll="handleScroll"
  >
    <slot />
  </div>
</template>