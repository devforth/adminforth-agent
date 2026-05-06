<template> 
  <div 
    class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
    :class="{
      'recordingAnimation1' : showAnimation,
      'h-2': !isRecording,
      'h-1': isRecording,
    }"  
  />
  <div 
    class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
    :class="{
      'recordingAnimation2' : showAnimation,
      'h-4': !isRecording,
      'h-1': isRecording,
    }"  
  />
  <div 
    class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
    :class="{
      'recordingAnimation3' : showAnimation,
      'h-3': !isRecording,
      'h-1': isRecording,
    }"  
  />
  <div 
    class=" bg-white w-[0.2rem] rounded-sm transition-all duration-300 ease-in-out"
    :class="{
      'recordingAnimation4' : showAnimation,
      'h-2': !isRecording,
      'h-1': isRecording,
    }"  
  />
  <template v-if="isRecording">
    <div 
      class=" bg-white w-[0.2rem] rounded-sm h-1 transition-all duration-300 ease-in-out"
      :class="{
        'recordingAnimation5' : showAnimation,
      }"  
    />
    <p class="text-white ml-2">End</p>
  </template>
</template>



<script setup lang="ts">

const props = defineProps<{
  showAnimation: boolean;
  isRecording: boolean;
}>();

</script>

<style scoped lang="scss">
  .recordingAnimation1 {
    animation: recordingAnimation 1s infinite;
    height: 0.3rem;
  }

  .recordingAnimation2 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.2s;
    height: 0.5rem;
  }

  .recordingAnimation3 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.4s;
    height: 0.4rem;
  }
  
  .recordingAnimation4 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.6s;
    height: 0.5rem;
  }

  .recordingAnimation5 {
    animation: recordingAnimation 1s infinite;
    animation-delay: 0.8s;
    height: 0.3rem;
  }

  @keyframes recordingAnimation {
    0% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(2);
    }
    100% {
      transform: scaleY(1);
    }
  }
</style>