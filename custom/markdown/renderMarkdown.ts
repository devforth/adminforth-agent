import DOMPurify from 'dompurify';
import { Idiomorph } from 'idiomorph';
import { Marked, type Tokens, type TokenizerAndRendererExtension } from 'marked';
import remend from 'remend';
import type { VisualizationSpec } from 'vega-embed';
import { vegaLiteConfig } from './vegaTheme';
import './markdown.css';

// Framework-free markdown of the chat: the whole message is parsed again on every change (marked takes well under a
// millisecond on a chat message), remend closes the syntax a stream left open, and idiomorph moves only the difference
// into the DOM, so finished blocks, a rendered chart and the text selection survive the next chunk.
// A binding of a UI framework creates the view on mount, passes every new text to update() and calls destroy().

export interface MarkdownLabels {
  copy: string;
  copied: string;
}

export interface MarkdownView {
  update(text: string, final: boolean): void;
  destroy(): void;
}

type KatexModule = typeof import('katex').default;
type HighlightModule = typeof import('./highlightCode');
type VegaResult = { finalize: () => void };

const COPIED_MS = 1500;
// a link or an image still streaming shows as its text until its URL is complete
const REMEND_OPTIONS = { linkMode: 'text-only', images: false } as const;
const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// $$…$$ or \[…\] on lines of their own
const BLOCK_MATH_RE = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/;
const BLOCK_MATH_START_RE = /^(?:\$\$|\\\[)/m;
// $$…$$ and \[…\] in a line are display math, \(…\) and $…$ inline; $…$ follows pandoc so prices like $5 and $10 stay text
const INLINE_MATH_RE = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d))/;
const INLINE_MATH_START_RE = /\$|\\[([]/;

let katex: KatexModule | null = null;
let katexLoad: Promise<void> | null = null;
let highlighter: HighlightModule | null = null;
let highlighterLoad: Promise<void> | null = null;

function escapeHtml(text: string): string {
  return text.replace(HTML_ESCAPE_RE, (char) => HTML_ESCAPES[char]);
}

function stringHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

// KaTeX and its stylesheet load on the first formula, until then the formula shows as its source
function loadKatex(): Promise<void> {
  katexLoad ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
    katex = module.default;
  });
  return katexLoad;
}

// shiki loads with the first code block, a message without code does not pay for it
function loadHighlighter(): Promise<void> {
  highlighterLoad ??= import('./highlightCode').then((module) => {
    highlighter = module;
  });
  return highlighterLoad;
}

function mathExtensions(renderTex: (tex: string, displayMode: boolean) => string): TokenizerAndRendererExtension[] {
  return [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src) => src.match(BLOCK_MATH_START_RE)?.index,
      tokenizer(src) {
        const match = BLOCK_MATH_RE.exec(src);
        if (match) {
          return { type: 'mathBlock', raw: match[0], text: (match[1] ?? match[2]).trim() };
        }
      },
      renderer: (token) => `<div class="af-md-math-block">${renderTex(token.text, true)}</div>`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: (src) => src.match(INLINE_MATH_START_RE)?.index,
      tokenizer(src) {
        const match = INLINE_MATH_RE.exec(src);
        if (match) {
          const display = match[1] !== undefined || match[2] !== undefined;
          return { type: 'mathInline', raw: match[0], text: (match[1] ?? match[2] ?? match[3] ?? match[4]).trim(), display };
        }
      },
      renderer: (token) => renderTex(token.text, token.display),
    },
  ];
}

export function createMarkdownView(el: HTMLElement, labels: MarkdownLabels): MarkdownView {
  let text = '';
  let final = false;
  let rendered = false;
  let frameId: number | null = null;
  // the spec of every chart in the last render, by the hash idiomorph compares
  const vegaSpecs = new Map<string, string>();
  const charts = new Map<HTMLElement, { key: string; result: VegaResult | null }>();

  const scheduleRender = () => {
    frameId ??= requestAnimationFrame(render);
  };

  const renderTex = (tex: string, displayMode: boolean) => {
    if (!katex) {
      loadKatex().then(scheduleRender, (error) => console.error('Failed to load KaTeX', error));
      return `<code class="af-md-math-source">${escapeHtml(tex)}</code>`;
    }
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
  };

  const renderCode = ({ text: code, lang }: Tokens.Code) => {
    const info = (lang ?? '').trim().split(/\s/, 1)[0];
    if (info.toLowerCase() === 'vega-lite') {
      const key = stringHash(code);
      vegaSpecs.set(key, code);
      return `<div class="af-md-vega" data-af-md-vega="${key}"></div>`;
    }

    let highlighted: string | null = null;
    if (highlighter) {
      const language = highlighter.shikiLanguage(info);
      highlighted = language && highlighter.highlightCode(code, language, scheduleRender);
    } else {
      loadHighlighter().then(scheduleRender, (error) => console.error('Failed to load the code highlighter', error));
    }
    return `<div class="af-md-code">`
      + `<div class="af-md-code-toolbar"><span class="af-md-code-language">${escapeHtml(info || 'text')}</span>`
      + `<button type="button" class="af-md-code-copy" data-af-md-copy>${escapeHtml(labels.copy)}</button></div>`
      + `<div class="af-md-code-body">${highlighted || `<pre class="af-md-code-plain"><code>${escapeHtml(code)}</code></pre>`}</div>`
      + `</div>`;
  };

  const marked = new Marked({
    gfm: true,
    renderer: { code: renderCode },
    extensions: mathExtensions(renderTex),
  });

  // a rendered chart and a copy button showing "Copied" keep their DOM, the new markup has neither
  const beforeNodeMorphed = (oldNode: Node, newNode: Node) => !(
    oldNode instanceof HTMLElement && newNode instanceof HTMLElement && (
      (oldNode.dataset.afMdVega !== undefined && oldNode.dataset.afMdVega === newNode.dataset.afMdVega)
      || oldNode.dataset.copied !== undefined
    )
  );

  function render() {
    frameId = null;
    rendered = true;
    vegaSpecs.clear();
    const html = marked.parse(final ? text : remend(text, REMEND_OPTIONS), { async: false });
    Idiomorph.morph(el, DOMPurify.sanitize(html), { morphStyle: 'innerHTML', callbacks: { beforeNodeMorphed } });
    syncCharts();
  }

  // charts render once their spec is complete JSON, a spec still streaming stays an empty box
  function syncCharts() {
    for (const [container, chart] of charts) {
      if (!container.isConnected) {
        chart.result?.finalize();
        charts.delete(container);
      }
    }
    for (const container of el.querySelectorAll<HTMLElement>('[data-af-md-vega]')) {
      const key = container.dataset.afMdVega!;
      const chart = charts.get(container);
      if (chart?.key === key) {
        continue;
      }
      chart?.result?.finalize();
      charts.delete(container);
      let spec: Record<string, unknown>;
      try {
        spec = JSON.parse(vegaSpecs.get(key)!);
      } catch {
        continue;
      }
      charts.set(container, { key, result: null });
      void embedChart(container, key, spec);
    }
  }

  async function embedChart(container: HTMLElement, key: string, spec: Record<string, unknown>) {
    const { default: embed } = await import('vega-embed');
    try {
      // a spec without a width fills the message
      const fullSpec = { width: 'container', autosize: { type: 'fit-x', contains: 'padding' }, ...spec } as VisualizationSpec;
      const result = await embed(container, fullSpec, {
        actions: false,
        renderer: 'svg',
        // read on every render, a theme switch renders the chart again with the tokens of the new theme
        config: vegaLiteConfig(container),
        tooltip: { theme: 'af' },
      });
      if (charts.get(container)?.key === key) {
        charts.get(container)!.result = result;
      } else {
        result.finalize();
      }
    } catch (error) {
      console.error('Failed to render Vega-Lite block', error);
    }
  }

  const themeObserver = new MutationObserver(() => {
    for (const [container, chart] of charts) {
      chart.result?.finalize();
      charts.delete(container);
      container.replaceChildren();
    }
    syncCharts();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  function onClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-af-md-copy]');
    if (!button) {
      return;
    }
    const code = button.closest('.af-md-code')!.querySelector('pre')!.textContent!;
    void navigator.clipboard.writeText(code).then(() => {
      button.dataset.copied = '';
      button.textContent = labels.copied;
      setTimeout(() => {
        delete button.dataset.copied;
        button.textContent = labels.copy;
      }, COPIED_MS);
    });
  }
  el.addEventListener('click', onClick);

  return {
    update(nextText, nextFinal) {
      text = nextText;
      final = nextFinal;
      // the first render is synchronous, so a message from the history has its height when it mounts
      if (rendered) {
        scheduleRender();
      } else {
        render();
      }
    },
    destroy() {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      themeObserver.disconnect();
      el.removeEventListener('click', onClick);
      for (const chart of charts.values()) {
        chart.result?.finalize();
      }
      charts.clear();
    },
  };
}
