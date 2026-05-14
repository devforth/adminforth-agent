import { createIncremarkParser, type IncremarkParserOptions } from '@incremark/core';

import {
	highlightCodeSnippetHtml,
	type IncremarkCodeTheme
} from './incremarkCodeHighlight';
import { renderIncremarkAst, renderKatexIncremarkHtml } from './incremarkRenderer';

const INCREMARK_PARSER_OPTIONS = {
	gfm: true,
	math: { tex: true },
	containers: true,
	htmlTree: true
} satisfies IncremarkParserOptions;

const INCREMARK_CODE_BLOCK_PATTERN =
	/(<div class="incremark-block incremark-code"><div class="incremark-code-toolbar">[\s\S]*?<\/div>)<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre><\/div>/g;
const HTML_ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;

const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	quot: '"'
};

export async function renderIncremarkMarkdown(
	markdown: string,
	theme: IncremarkCodeTheme = 'dark'
): Promise<string> {
	const parser = createIncremarkParser(INCREMARK_PARSER_OPTIONS);

	if (markdown) {
		parser.append(markdown);
	}

	parser.finalize();

	const baseHtml = renderIncremarkAst(parser.getAst());
	const mathHtml = await renderKatexIncremarkHtml(baseHtml);
	return highlightRenderedIncremarkHtmlServer(mathHtml, theme);
}

async function highlightRenderedIncremarkHtmlServer(
	html: string,
	theme: IncremarkCodeTheme
): Promise<string> {
	if (!html.includes('incremark-code')) {
		return html;
	}

	return replaceAsync(html, INCREMARK_CODE_BLOCK_PATTERN, async (_match, prefix, language, code) => {
		const highlightedHtml = await highlightCodeSnippetHtml(
			decodeHtmlEntities(code),
			language ?? 'text',
			theme
		);

		return `${prefix}${addClassToPreTag(highlightedHtml, 'incremark-code-highlight')}</div>`;
	});
}

async function replaceAsync(
	value: string,
	pattern: RegExp,
	replacer: (...args: string[]) => Promise<string>
): Promise<string> {
	pattern.lastIndex = 0;
	const matches = Array.from(value.matchAll(pattern));
	if (matches.length === 0) {
		return value;
	}

	const replacements = await Promise.all(matches.map((match) => replacer(...match)));

	let cursor = 0;
	let result = '';

	for (const [index, match] of matches.entries()) {
		const fullMatch = match[0];
		const matchIndex = match.index ?? 0;
		result += value.slice(cursor, matchIndex);
		result += replacements[index];
		cursor = matchIndex + fullMatch.length;
	}

	result += value.slice(cursor);
	return result;
}

function addClassToPreTag(html: string, className: string): string {
	if (html.startsWith('<pre class="')) {
		return html.replace('<pre class="', `<pre class="${className} `);
	}

	if (html.startsWith('<pre ')) {
		return html.replace('<pre ', `<pre class="${className}" `);
	}

	return html.replace('<pre>', `<pre class="${className}">`);
}

function decodeHtmlEntities(value: string): string {
	return value.replace(HTML_ENTITY_RE, (match, entity) => {
		if (entity.startsWith('#x') || entity.startsWith('#X')) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
		}

		if (entity.startsWith('#')) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
		}

		return NAMED_HTML_ENTITIES[entity] ?? match;
	});
}