import {
	createBundledHighlighter,
	type HighlighterGeneric,
	type LanguageInput,
	type ThemeInput
} from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

const TOP_SHIKI_LANGS = [
	'typescript',
	'javascript',
	'python',
	'html',
	'css',
	'sql',
	'shellscript',
	'json',
	'yaml',
	'markdown',
	'java',
	'csharp',
	'cpp',
	'c',
	'php',
	'go',
	'rust',
	'powershell',
	'kotlin',
	'lua',
	'swift',
	'ruby',
	'dart',
	'scala',
	'perl',
	'r',
	'tsx',
	'jsx',
	'dockerfile',
	'vue'
] as const;

export type SupportedShikiLanguage = (typeof TOP_SHIKI_LANGS)[number];
type SupportedShikiTheme = 'github-dark' | 'github-light';

// one highlight carries both themes: the light colors inline, the dark ones as --shiki-dark, markdown.css switches them
const SHIKI_THEMES = {
	light: 'github-light',
	dark: 'github-dark'
} as const satisfies Record<string, SupportedShikiTheme>;
const SUPPORTED_SHIKI_LANG_SET = new Set<string>(TOP_SHIKI_LANGS);
const LANGUAGE_ALIASES = {
	bash: 'shellscript',
	'c#': 'csharp',
	cjs: 'javascript',
	'c++': 'cpp',
	cs: 'csharp',
	docker: 'dockerfile',
	golang: 'go',
	html: 'html',
	js: 'javascript',
	jsx: 'jsx',
	kt: 'kotlin',
	kts: 'kotlin',
	md: 'markdown',
	mjs: 'javascript',
	ps: 'powershell',
	ps1: 'powershell',
	py: 'python',
	rb: 'ruby',
	sh: 'shellscript',
	shell: 'shellscript',
	ts: 'typescript',
	tsx: 'tsx',
	yml: 'yaml',
	zsh: 'shellscript'
} as const satisfies Record<string, SupportedShikiLanguage>;

const SHIKI_THEME_LOADERS = {
	'github-dark': () => import('@shikijs/themes/github-dark'),
	'github-light': () => import('@shikijs/themes/github-light')
} as const satisfies Record<SupportedShikiTheme, ThemeInput>;

const SHIKI_LANGUAGE_LOADERS = {
	typescript: () => import('@shikijs/langs/typescript'),
	javascript: () => import('@shikijs/langs/javascript'),
	python: () => import('@shikijs/langs/python'),
	html: () => import('@shikijs/langs/html'),
	css: () => import('@shikijs/langs/css'),
	sql: () => import('@shikijs/langs/sql'),
	shellscript: () => import('@shikijs/langs/shellscript'),
	json: () => import('@shikijs/langs/json'),
	yaml: () => import('@shikijs/langs/yaml'),
	markdown: () => import('@shikijs/langs/markdown'),
	java: () => import('@shikijs/langs/java'),
	csharp: () => import('@shikijs/langs/csharp'),
	cpp: () => import('@shikijs/langs/cpp'),
	c: () => import('@shikijs/langs/c'),
	php: () => import('@shikijs/langs/php'),
	go: () => import('@shikijs/langs/go'),
	rust: () => import('@shikijs/langs/rust'),
	powershell: () => import('@shikijs/langs/powershell'),
	kotlin: () => import('@shikijs/langs/kotlin'),
	lua: () => import('@shikijs/langs/lua'),
	swift: () => import('@shikijs/langs/swift'),
	ruby: () => import('@shikijs/langs/ruby'),
	dart: () => import('@shikijs/langs/dart'),
	scala: () => import('@shikijs/langs/scala'),
	perl: () => import('@shikijs/langs/perl'),
	r: () => import('@shikijs/langs/r'),
	tsx: () => import('@shikijs/langs/tsx'),
	jsx: () => import('@shikijs/langs/jsx'),
	dockerfile: () => import('@shikijs/langs/dockerfile'),
	vue: () => import('@shikijs/langs/vue')
} as const satisfies Record<SupportedShikiLanguage, LanguageInput>;

const createShikiHighlighter = createBundledHighlighter({
	themes: SHIKI_THEME_LOADERS,
	langs: SHIKI_LANGUAGE_LOADERS,
	engine: () => createOnigurumaEngine(() => import('shiki/wasm'))
});

const MAX_HIGHLIGHT_CACHE_ENTRIES = 200;
const highlightedHtmlCache = new Map<string, string>();
const loadedLanguages = new Set<SupportedShikiLanguage>();
const languageLoads = new Map<SupportedShikiLanguage, Promise<void>>();

let highlighter: HighlighterGeneric<SupportedShikiLanguage, SupportedShikiTheme> | null = null;
let highlighterLoad: Promise<void> | null = null;

// the shiki language of a fence info string, null for a language the agent does not highlight
export function shikiLanguage(language: string): SupportedShikiLanguage | null {
	const normalized = language.trim().toLowerCase();
	const aliased = LANGUAGE_ALIASES[normalized as keyof typeof LANGUAGE_ALIASES] ?? normalized;
	return SUPPORTED_SHIKI_LANG_SET.has(aliased) ? aliased as SupportedShikiLanguage : null;
}

// highlighting itself is synchronous, only the highlighter and the grammars load once; until they have, it returns null
// and calls onReady when they are, so a streamed block is highlighted on every chunk without waiting
export function highlightCode(code: string, language: SupportedShikiLanguage, onReady: () => void): string | null {
	if (!highlighter || !loadedLanguages.has(language)) {
		loadLanguage(language).then(onReady, (error) => console.error('Failed to load the code highlighter', error));
		return null;
	}

	const cacheKey = `${language}\u0000${code}`;
	const cachedHtml = highlightedHtmlCache.get(cacheKey);
	if (cachedHtml !== undefined) {
		return cachedHtml;
	}

	const html = highlighter.codeToHtml(code, { lang: language, themes: SHIKI_THEMES });
	setHighlightedHtmlCache(cacheKey, html);
	return html;
}

async function loadLanguage(language: SupportedShikiLanguage): Promise<void> {
	highlighterLoad ??= createShikiHighlighter({ themes: Object.values(SHIKI_THEMES), langs: [] }).then((created) => {
		highlighter = created;
	});
	await highlighterLoad;

	if (!languageLoads.has(language)) {
		languageLoads.set(language, highlighter!.loadLanguage(language).then(() => {
			loadedLanguages.add(language);
		}));
	}
	await languageLoads.get(language);
}

function setHighlightedHtmlCache(cacheKey: string, highlightedHtml: string): void {
	highlightedHtmlCache.set(cacheKey, highlightedHtml);

	if (highlightedHtmlCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
		highlightedHtmlCache.delete(highlightedHtmlCache.keys().next().value!);
	}
}
