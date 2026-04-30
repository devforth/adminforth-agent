import { onMounted, onUnmounted, ref, type ShallowRef } from 'vue';

const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);

export function useChatSurfaceMobileSupport(chatSurface: Readonly<ShallowRef<HTMLElement | null>>) {
  const dvh = ref(Math.round(window.visualViewport?.height || window.innerHeight));
  const viewportOffsetTop = ref(Math.round(window.visualViewport?.offsetTop || 0));
  const lastTouchY = ref<number | null>(null);

  let surfaceElement: HTMLElement | null = null;

  onMounted(() => {
    surfaceElement = chatSurface.value;

    window.addEventListener('resize', updateViewportMetrics);
    window.visualViewport?.addEventListener('resize', updateViewportMetrics);
    window.visualViewport?.addEventListener('scroll', updateViewportMetrics);
    surfaceElement?.addEventListener('wheel', handleSurfaceWheel, { passive: false });
    surfaceElement?.addEventListener('touchstart', handleSurfaceTouchStart, { passive: true });
    surfaceElement?.addEventListener('touchmove', handleSurfaceTouchMove, { passive: false });
    surfaceElement?.addEventListener('touchend', resetTouchTracking);
    surfaceElement?.addEventListener('touchcancel', resetTouchTracking);
    updateViewportMetrics();
  });

  onUnmounted(() => {
    window.removeEventListener('resize', updateViewportMetrics);
    window.visualViewport?.removeEventListener('resize', updateViewportMetrics);
    window.visualViewport?.removeEventListener('scroll', updateViewportMetrics);
    surfaceElement?.removeEventListener('wheel', handleSurfaceWheel);
    surfaceElement?.removeEventListener('touchstart', handleSurfaceTouchStart);
    surfaceElement?.removeEventListener('touchmove', handleSurfaceTouchMove);
    surfaceElement?.removeEventListener('touchend', resetTouchTracking);
    surfaceElement?.removeEventListener('touchcancel', resetTouchTracking);
  });

  function updateViewportMetrics() {
    dvh.value = Math.round(window.visualViewport?.height || window.innerHeight);
    viewportOffsetTop.value = Math.round(window.visualViewport?.offsetTop || 0);
  }

  function getEventElement(target: EventTarget | null) {
    if (target instanceof Element) {
      return target as HTMLElement;
    }

    if (target instanceof Node) {
      return target.parentElement;
    }

    return null;
  }

  function isScrollableElement(element: HTMLElement) {
    const { overflowY } = window.getComputedStyle(element);
    return SCROLLABLE_OVERFLOW_VALUES.has(overflowY) && element.scrollHeight > element.clientHeight;
  }

  function canScrollInDirection(element: HTMLElement, deltaY: number) {
    if (deltaY < 0) {
      return element.scrollTop > 0;
    }

    if (deltaY > 0) {
      return element.scrollTop + element.clientHeight < element.scrollHeight;
    }

    return true;
  }

  function shouldTrapSurfaceScroll(target: EventTarget | null, deltaY: number) {
    let currentElement = getEventElement(target);

    while (currentElement && currentElement !== surfaceElement) {
      if (isScrollableElement(currentElement) && canScrollInDirection(currentElement, deltaY)) {
        return false;
      }

      currentElement = currentElement.parentElement;
    }

    return true;
  }

  function handleSurfaceWheel(event: WheelEvent) {
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return;
    }

    if (shouldTrapSurfaceScroll(event.target, event.deltaY)) {
      event.preventDefault();
    }
  }

  function handleSurfaceTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      return;
    }

    lastTouchY.value = event.touches[0].clientY;
  }

  function handleSurfaceTouchMove(event: TouchEvent) {
    if (event.touches.length !== 1) {
      return;
    }

    const currentTouchY = event.touches[0].clientY;
    const previousTouchY = lastTouchY.value ?? currentTouchY;
    const deltaY = previousTouchY - currentTouchY;

    lastTouchY.value = currentTouchY;

    if (shouldTrapSurfaceScroll(event.target, deltaY)) {
      event.preventDefault();
    }
  }

  function resetTouchTracking() {
    lastTouchY.value = null;
  }

  return {
    dvh,
    viewportOffsetTop,
  };
}