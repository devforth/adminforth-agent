<template>
  <CustomScrollbar
    ref="containerRef"
    class="auto-scroll-container mask-y"
    :wrapperStyle = "wrapperStyle" 
    :contentStyle = "contentStyle"
    :autoHide = "scrollBarAutoHide"
    @scroll="handleScroll"
  >
    <slot />
  </CustomScrollbar>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import CustomScrollbar from 'custom-vue-scrollbar';
import 'custom-vue-scrollbar/dist/style.css';


const props = withDefaults(defineProps<{
  enabled?: boolean
  threshold?: number
  behavior?: ScrollBehavior
  wrapperStyle?: Record<string, string>
  contentStyle?: Record<string, string>
  scrollBarAutoHide?: boolean
  debugMode?: boolean
  scrollToBottomOnMount?: boolean
}>(), {
  enabled: true,
  threshold: 50,
  behavior: 'instant',
  scrollBarAutoHide: true,
  debugMode: false,
  scrollToBottomOnMount: true
})

const containerRef = ref<HTMLDivElement | null>(null)
const isUserScrolledUp = ref(false)
const scrollElement = ref<HTMLElement | null>(null)

let lastScrollTop = 0
let lastScrollHeight = 0
let observer: MutationObserver | null = null

const INITIAL_SCROLL_DEBOUNCE = 200
let initialScrollDone = false
let initialScrollTimer: ReturnType<typeof setTimeout> | null = null

function scheduleInitialScrollEnd(): void {
  if (initialScrollTimer) clearTimeout(initialScrollTimer)
  initialScrollTimer = setTimeout(() => {
    initialScrollDone = true
    initialScrollTimer = null
  }, INITIAL_SCROLL_DEBOUNCE)
}

const scrollParams = ref({
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0
});

defineExpose({
  scrollToBottom: () => scrollToBottom(true),
  isUserScrolledUp: () => isUserScrolledUp.value,
  container: containerRef,
  handleScroll,
  scrollParams
})

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
      scrollParams.value.scrollTop = containerRef.value.scrollEl.scrollTop
      scrollParams.value.scrollHeight = containerRef.value.scrollEl.scrollHeight
      scrollParams.value.clientHeight = containerRef.value.scrollEl.clientHeight
      if (props.enabled && !isUserScrolledUp.value) {
        scrollToBottom()
      } else if (props.scrollToBottomOnMount && !initialScrollDone) {
        // Delayed content is still settling in the initial scroll phase: keep
        // pinning to the bottom and restart the quiet-period debounce.
        scrollToBottom(true)
        scheduleInitialScrollEnd()
      }
    })
  })

  observer.observe(containerRef.value?.scrollEl, {
    childList: true,
    subtree: true,
    characterData: true
  })

  if (props.scrollToBottomOnMount) {
    nextTick(() => scrollToBottom(true))
    scheduleInitialScrollEnd()
  }
})

onUnmounted(() => {
  observer?.disconnect()
  if (initialScrollTimer) clearTimeout(initialScrollTimer)
})

function isNearBottom(customThreshold?: number): boolean {
  const container = containerRef.value?.scrollEl
  if (!container) return true
  
  const { scrollTop, scrollHeight, clientHeight } = container
  scrollParams.value.scrollTop = scrollTop
  scrollParams.value.scrollHeight = scrollHeight
  scrollParams.value.clientHeight = clientHeight
  const threshold = customThreshold ?? props.threshold
  return scrollHeight - scrollTop - clientHeight <= threshold
}

function scrollToBottom(force = false): void {
  if (props.debugMode) console.log('scrollToBottom called with force:', force)
  const container = containerRef.value?.scrollEl
  if (!container) return
  
  if (isUserScrolledUp.value && !force) return
  if (props.debugMode) console.log('Scrolling to bottom...:', container.scrollHeight)
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


function handleScroll(detectScrollDown = true, customThreshold?: number): void {
  const container = containerRef.value.scrollEl
  if (!container) return
  
  const { scrollTop, scrollHeight, clientHeight } = container
  if (scrollHeight <= clientHeight) {
    isUserScrolledUp.value = false
    lastScrollTop = 0
    lastScrollHeight = scrollHeight
    return
  }
  if (isNearBottom(customThreshold)) {
    isUserScrolledUp.value = false
  } else {
    const isScrollingUp = scrollTop < lastScrollTop
    const isScrollingDown = detectScrollDown ? scrollTop > lastScrollTop : false
    const isContentUnchanged = scrollHeight === lastScrollHeight
    if ((isScrollingUp || isScrollingDown) && isContentUnchanged) {
      isUserScrolledUp.value = true
    }
  }
  lastScrollTop = scrollTop
  lastScrollHeight = scrollHeight
}

</script>

<style>
  .mask-y {
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black 1.25rem,
      black calc(100% - 1.25rem),
      transparent
    );
  }

  .scrollbar__thumb {
    border-radius: 0.25rem;
  }
</style>