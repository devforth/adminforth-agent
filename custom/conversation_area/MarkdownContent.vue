<template>
  <div ref="el" class="af-md" />
</template>

<script setup lang="ts">
// the Vue binding of the framework-free markdown view
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { createMarkdownView, type MarkdownView } from '../markdown/renderMarkdown';

const props = defineProps<{
  content: string;
  // false while the message streams: the syntax it left open is closed for display
  final: boolean;
}>();

const { t } = useI18n();
const el = ref<HTMLElement>();
let view: MarkdownView;

onMounted(() => {
  view = createMarkdownView(el.value!, { copy: t('Copy'), copied: t('Copied') });
  view.update(props.content, props.final);
});

watch(() => [props.content, props.final] as const, ([content, final]) => view.update(content, final));

onBeforeUnmount(() => view.destroy());
</script>
