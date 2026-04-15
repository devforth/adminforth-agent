import {
	createBundledHighlighter,
	type HighlighterGeneric,
	type LanguageInput,
	type ThemeInput
} from 'shiki/core';
import { createOnigurumaEngine } from 'shiki/engine/oniguruma';

export type IncremarkCodeTheme = 'dark' | 'light';

export const TOP_SHIKI_LANGS = [
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

type SupportedShikiLanguage = (typeof TOP_SHIKI_LANGS)[number];
type SupportedShikiTheme = 'github-dark' | 'github-light';
type ActiveShikiLanguage = SupportedShikiLanguage | typeof FALLBACK_LANGUAGE;

const SHIKI_THEME_BY_MODE = {
	dark: 'github-dark',
	light: 'github-light'
} as const satisfies Record<IncremarkCodeTheme, SupportedShikiTheme>;
const FALLBACK_LANGUAGE = 'text' as const;
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

interface HighlighterState {
	highlighter: HighlighterGeneric<SupportedShikiLanguage, SupportedShikiTheme>;
	loadedLanguages: Set<SupportedShikiLanguage>;
	loadedThemes: Set<SupportedShikiTheme>;
}

const highlightedHtmlCache = new Map<string, string>();
const unsupportedLanguageCache = new Set<string>();

let highlighterPromise: Promise<HighlighterState> | null = null;

export async function highlightCodeSnippetHtml(
	code: string,
	language: string,
	theme: IncremarkCodeTheme = 'dark'
): Promise<string> {
	return highlightCodeToHtml(code, language, theme);
}

export async function highlightRenderedIncremarkHtml(
	html: string,
	theme: IncremarkCodeTheme = 'dark'
): Promise<string> {
	if (typeof DOMParser === 'undefined' || !html.includes('incremark-code')) {
		return html;
	}
	const document = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
	const codeBlocks = Array.from(document.body.querySelectorAll('.incremark-code'));

	await Promise.all(codeBlocks.map(async (block) => {
		const preElement = block.querySelector('pre');
		const codeElement = preElement?.querySelector('code');
		if (!preElement || !codeElement) {
			return;
		}

		const sourceCode = codeElement.textContent ?? '';
		if (!sourceCode.trim()) {
			return;
		}

		const languageClass = Array.from(codeElement.classList).find((className) => className.startsWith('language-'));
		const language = languageClass ? languageClass.slice('language-'.length) : FALLBACK_LANGUAGE;
		const highlightedHtml = await highlightCodeToHtml(sourceCode, language, theme);
		const template = document.createElement('template');
		template.innerHTML = highlightedHtml.trim();

		const highlightedPre = template.content.firstElementChild;
		if (!highlightedPre) {
			return;
		}

		highlightedPre.classList.add('incremark-code-highlight');
		preElement.replaceWith(highlightedPre);
	}));
	return document.body.innerHTML;
}

async function highlightCodeToHtml(
	code: string,
	language: string,
	theme: IncremarkCodeTheme
): Promise<string> {
	const normalizedLanguage = normalizeLanguage(language);
	const shikiTheme = SHIKI_THEME_BY_MODE[theme];
	const cacheKey = `${shikiTheme}\u0000${normalizedLanguage}\u0000${code}`;
	const cachedHtml = highlightedHtmlCache.get(cacheKey);
	if (cachedHtml) {
		return cachedHtml;
	}

	const state = await getHighlighter();
	await ensureTheme(state, shikiTheme);
	const activeLanguage = await ensureLanguage(state, normalizedLanguage);
	const highlightedHtml = state.highlighter.codeToHtml(code, {
		lang: activeLanguage,
		theme: shikiTheme
	});

	highlightedHtmlCache.set(cacheKey, highlightedHtml);
	return highlightedHtml;
}

async function getHighlighter(): Promise<HighlighterState> {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			const highlighter = await createShikiHighlighter({
				themes: [],
				langs: []
			});

			return {
				highlighter,
				loadedLanguages: new Set(),
				loadedThemes: new Set()
			};
		})();
	}

	return highlighterPromise;
}

async function ensureTheme(state: HighlighterState, theme: SupportedShikiTheme): Promise<void> {
	if (state.loadedThemes.has(theme)) {
		return;
	}

	await state.highlighter.loadTheme(theme);
	state.loadedThemes.add(theme);
}

async function ensureLanguage(state: HighlighterState, language: string): Promise<ActiveShikiLanguage> {
	if (language === FALLBACK_LANGUAGE || unsupportedLanguageCache.has(language)) {
		return FALLBACK_LANGUAGE;
	}

	if (!isSupportedShikiLanguage(language)) {
		unsupportedLanguageCache.add(language);
		return FALLBACK_LANGUAGE;
	}

	if (state.loadedLanguages.has(language)) {
		return language;
	}

	await state.highlighter.loadLanguage(language);
	state.loadedLanguages.add(language);
	return language;
}

function normalizeLanguage(language: string): string {
	const normalized = language.trim().toLowerCase();
	if (!normalized) {
		return FALLBACK_LANGUAGE;
	}

	const aliasedLanguage = LANGUAGE_ALIASES[normalized as keyof typeof LANGUAGE_ALIASES];
	return aliasedLanguage ?? normalized;
}

function isSupportedShikiLanguage(language: string): language is SupportedShikiLanguage {
	return SUPPORTED_SHIKI_LANG_SET.has(language);
}