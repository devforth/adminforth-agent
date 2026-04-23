<template>
  <span class="bounce-dot1 rounded-full w-2 h-2 bg-lightPrimary"></span>
  <span class="bounce-dot2 rounded-full w-2 h-2 bg-lightPrimary"></span>
  <span class="bounce-dot3 rounded-full w-2 h-2 bg-lightPrimary"></span>
</template>

<style scoped>
  .bounce-dot1 {
    animation: bounce 1.5s infinite;
    animation-delay: 0s;
  }

  .bounce-dot2 {
    animation: bounce 1.5s infinite;
    animation-delay: 0.1s;
  }

  .bounce-dot3 {
    animation: bounce 1.5s infinite;
    animation-delay: 0.2s;
  }

  @keyframes bounce {
    0%, 100% {
      transform: translateY(20%);
      opacity: 0.3;
      animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
    }
    50% {
      transform: none;
      opacity: 1;
      animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    }
  }
</style>