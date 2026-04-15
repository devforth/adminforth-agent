import type { Root } from '@incremark/core';

type KatexRenderer = typeof import('katex')['default'];

interface NodeLike {
	type?: unknown;
	children?: unknown;
	[key: string]: unknown;
}

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const HTTP_URL_RE = /^https?:\/\//i;
const CLASS_TOKEN_INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const EDGE_HYPHENS_RE = /^-+|-+$/g;
const INCREMARK_BLOCK_MATH_PLACEHOLDER_RE = /<div class="incremark-block incremark-math incremark-math--pending" data-incremark-math="([\s\S]*?)" data-incremark-math-display="block"><pre><code>[\s\S]*?<\/code><\/pre><\/div>/g;
const INCREMARK_INLINE_MATH_PLACEHOLDER_RE = /<code class="incremark-inline-code incremark-inline-math incremark-inline-math--pending" data-incremark-math="([\s\S]*?)" data-incremark-math-display="inline">[\s\S]*?<\/code>/g;
const HTML_ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;
const SAFE_HTML_TAGS = new Set([
	'a',
	'article',
	'b',
	'blockquote',
	'br',
	'code',
	'del',
	'details',
	'div',
	'em',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'i',
	'img',
	'kbd',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'section',
	'span',
	'strong',
	'sub',
	'summary',
	'sup',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'u',
	'ul'
]);
const BLOCK_HTML_TAGS = new Set([
	'article',
	'blockquote',
	'details',
	'div',
	'figcaption',
	'figure',
	'footer',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'li',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'ul'
]);
const VOID_HTML_TAGS = new Set(['br', 'hr', 'img']);
const SAFE_HTML_ATTRIBUTES = new Set([
	'align',
	'alt',
	'class',
	'colspan',
	'height',
	'href',
	'id',
	'open',
	'rel',
	'rowspan',
	'src',
	'target',
	'title',
	'width'
]);
const HEADING_SIZES: Record<number, string> = {
	1: '1.5rem',
	2: '1.2rem',
	3: '1.1rem',
	4: '1.05rem',
	5: '1rem',
	6: '0.94rem'
};
const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	quot: '"'
};
const CODE_COPY_BUTTON_HTML =
	'<button type="button" class="incremark-code-copy" aria-label="Copy code" title="Copy code"></button>';

export function renderIncremarkAst(root: Root): string {
	return root.children.map((child) => renderBlock(child as NodeLike)).join('');
}

export async function renderKatexIncremarkHtml(html: string): Promise<string> {
	if (!html.includes('data-incremark-math=')) {
		return html;
	}

	try {
		const { default: katex } = await import('katex');
		const withRenderedBlockMath = html.replace(
			INCREMARK_BLOCK_MATH_PLACEHOLDER_RE,
			(_match, encodedFormula: string) => renderKatexFormulaHtml(katex, decodeHtmlEntities(encodedFormula), true)
		);

		return withRenderedBlockMath.replace(
			INCREMARK_INLINE_MATH_PLACEHOLDER_RE,
			(_match, encodedFormula: string) => renderKatexFormulaHtml(katex, decodeHtmlEntities(encodedFormula), false)
		);
	} catch {
		return html;
	}
}

function renderBlock(node: NodeLike): string {
	switch (getType(node)) {
		case 'paragraph':
			return wrapBlock('p', 'incremark-paragraph', renderInlineChildren(getChildren(node)));
		case 'heading': {
			const depth = clampHeadingDepth(getNumber(node, 'depth'));
			const size = HEADING_SIZES[depth];
			return `<h${depth} class="incremark-block incremark-heading incremark-heading-${depth}" style="font-size: ${size};">${renderInlineChildren(getChildren(node))}</h${depth}>`;
		}
		case 'code':
			return renderCodeBlock(node);
		case 'blockquote':
			return wrapBlock('blockquote', 'incremark-blockquote', renderBlockChildren(getChildren(node)));
		case 'list':
			return renderList(node);
		case 'listItem':
			return renderListItem(node);
		case 'thematicBreak':
			return '<hr class="incremark-block incremark-thematic-break" />';
		case 'table':
			return renderTable(node);
		case 'math':
			return renderMathBlock(node);
		case 'htmlElement':
			return renderHtmlElement(node);
		case 'containerDirective':
		case 'leafDirective':
			return renderDirectiveBlock(node);
		case 'footnoteDefinition':
			return renderFootnoteDefinition(node);
		case 'definition':
			return '';
		case 'html':
			return renderCodeShell(`<pre><code>${escapeHtml(getString(node, 'value'))}</code></pre>`);
		default: {
			const children = getChildren(node);
			if (children.length > 0) {
				return renderBlockChildren(children);
			}

			const value = getString(node, 'value');
			return value ? wrapBlock('p', 'incremark-paragraph', escapeHtml(value)) : '';
		}
	}
}

function renderInline(node: NodeLike): string {
	switch (getType(node)) {
		case 'text':
			return escapeHtml(getString(node, 'value'));
		case 'strong':
			return `<strong>${renderInlineChildren(getChildren(node))}</strong>`;
		case 'emphasis':
			return `<em>${renderInlineChildren(getChildren(node))}</em>`;
		case 'delete':
			return `<del>${renderInlineChildren(getChildren(node))}</del>`;
		case 'inlineCode':
			return `<code class="incremark-inline-code">${escapeHtml(getString(node, 'value'))}</code>`;
		case 'link':
			return renderLink(node);
		case 'linkReference':
			return renderInlineChildren(getChildren(node)) || escapeHtml(getString(node, 'label') || getString(node, 'identifier'));
		case 'image':
			return renderImage(node);
		case 'imageReference':
			return escapeHtml(getString(node, 'alt'));
		case 'break':
			return '<br />';
		case 'inlineMath':
			return renderInlineMath(node);
		case 'footnoteReference':
			return `<sup class="incremark-footnote-reference">[${escapeHtml(getString(node, 'identifier'))}]</sup>`;
		case 'textDirective':
			return renderDirectiveInline(node);
		case 'htmlElement':
			return renderHtmlElement(node);
		case 'html':
			return escapeHtml(getString(node, 'value'));
		default: {
			const children = getChildren(node);
			if (children.length > 0) {
				return renderInlineChildren(children);
			}

			return escapeHtml(getString(node, 'value'));
		}
	}
}

function renderBlockChildren(children: NodeLike[]): string {
	return children.map((child) => renderBlock(child)).join('');
}

function renderInlineChildren(children: NodeLike[]): string {
	return children.map((child) => renderInline(child)).join('');
}

function renderCodeShell(preHtml: string, headerHtml = ''): string {
	return `<div class="incremark-block incremark-code"><div class="incremark-code-toolbar">${headerHtml}${CODE_COPY_BUTTON_HTML}</div>${preHtml}</div>`;
}

function renderCodeBlock(node: NodeLike): string {
	const lang = sanitizeClassToken(getString(node, 'lang'));
	const langLabel = lang ? `<div class="incremark-code-header">${escapeHtml(lang)}</div>` : '';
	const languageClass = lang ? ` class="language-${escapeAttribute(lang)}"` : '';
	const code = `<pre><code${languageClass}>${escapeHtml(getString(node, 'value'))}</code></pre>`;
	return renderCodeShell(code, langLabel);
}

function renderMathBlock(node: NodeLike): string {
	return renderKatexPlaceholder(getString(node, 'value'), true);
}

function renderInlineMath(node: NodeLike): string {
	return renderKatexPlaceholder(getString(node, 'value'), false);
}

function renderList(node: NodeLike): string {
	const ordered = getBoolean(node, 'ordered') === true;
	const tag = ordered ? 'ol' : 'ul';
	const classes = `incremark-block incremark-list incremark-list--${ordered ? 'ordered' : 'unordered'}`;
	const start = ordered ? getNumber(node, 'start') : undefined;
	const startAttr = ordered && typeof start === 'number' && start > 1 ? ` start="${start}"` : '';
	return `<${tag} class="${classes}"${startAttr}>${getChildren(node).map((child) => renderListItem(child)).join('')}</${tag}>`;
}

function renderListItem(node: NodeLike): string {
	const children = getChildren(node);
	const checked = getBoolean(node, 'checked');

	if (typeof checked === 'boolean' && children[0] && getType(children[0]) === 'paragraph') {
		const [first, ...rest] = children;
		const firstContent = renderInlineChildren(getChildren(first));
		const restContent = rest.map((child) => renderBlock(child)).join('');
		return `<li class="incremark-list-item incremark-list-item--task"><label class="incremark-task-item"><input class="incremark-task-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} /><span class="incremark-task-content">${firstContent}</span></label>${restContent}</li>`;
	}

	const checkbox = typeof checked === 'boolean'
		? `<input class="incremark-task-checkbox" type="checkbox" disabled${checked ? ' checked' : ''} />`
		: '';
	return `<li class="incremark-list-item">${checkbox}${children.map((child) => renderBlock(child)).join('')}</li>`;
}

function renderTable(node: NodeLike): string {
	const rows = getChildren(node);
	if (rows.length === 0) {
		return '';
	}

	const align = Array.isArray(node.align) ? node.align : [];
	const [headerRow, ...bodyRows] = rows;
	const thead = `<thead>${renderTableRow(headerRow, true, align)}</thead>`;
	const tbody = bodyRows.length > 0
		? `<tbody>${bodyRows.map((row) => renderTableRow(row, false, align)).join('')}</tbody>`
		: '';

	return `<div class="incremark-block incremark-table-wrapper"><table class="incremark-table">${thead}${tbody}</table></div>`;
}

function renderTableRow(row: NodeLike, header: boolean, align: unknown[]): string {
	const cells = getChildren(row);
	const tag = header ? 'th' : 'td';
	const className = header ? 'incremark-table-header' : 'incremark-table-cell';
	const renderedCells = cells.map((cell, index) => {
		const alignment = typeof align[index] === 'string' ? String(align[index]) : '';
		const style = alignment ? ` style="text-align: ${escapeAttribute(alignment)};"` : '';
		return `<${tag} class="${className}"${style}>${renderInlineChildren(getChildren(cell))}</${tag}>`;
	}).join('');

	return `<tr>${renderedCells}</tr>`;
}

function renderLink(node: NodeLike): string {
	const href = sanitizeUrl(getString(node, 'url'));
	const content = renderInlineChildren(getChildren(node)) || escapeHtml(getString(node, 'url'));
	if (!href) {
		return content;
	}

	const title = getString(node, 'title');
	const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
	const relAttr = isExternalHttpUrl(href) ? ' rel="noreferrer"' : '';
	return `<a class="incremark-link" href="${escapeAttribute(href)}"${titleAttr}${relAttr}>${content}</a>`;
}

function renderImage(node: NodeLike): string {
	const src = sanitizeUrl(getString(node, 'url'));
	if (!src) {
		return escapeHtml(getString(node, 'alt'));
	}

	const alt = escapeAttribute(getString(node, 'alt'));
	const title = getString(node, 'title');
	const titleAttr = title ? ` title="${escapeAttribute(title)}"` : '';
	return `<img class="incremark-image" src="${escapeAttribute(src)}" alt="${alt}"${titleAttr} />`;
}

function renderDirectiveBlock(node: NodeLike): string {
	const name = sanitizeClassToken(getString(node, 'name')) || 'directive';
	const content = renderBlockChildren(getChildren(node));
	const attrs = renderHtmlAttributes(getAttributes(node, 'attributes'), [
		'incremark-block',
		'incremark-container',
		`incremark-container--${name}`
	]);
	return `<section${attrs}>${content}</section>`;
}

function renderDirectiveInline(node: NodeLike): string {
	const name = sanitizeClassToken(getString(node, 'name')) || 'directive';
	const content = renderInlineChildren(getChildren(node));
	const attrs = renderHtmlAttributes(getAttributes(node, 'attributes'), [
		'incremark-inline-directive',
		`incremark-inline-directive--${name}`
	]);
	return `<span${attrs}>${content}</span>`;
}

function renderHtmlElement(node: NodeLike): string {
	const tagName = getString(node, 'tagName').toLowerCase();
	if (!SAFE_HTML_TAGS.has(tagName)) {
		return renderBlockChildren(getChildren(node));
	}

	const extraClasses = [
		'incremark-html-element',
		`incremark-html-element--${sanitizeClassToken(tagName)}`
	];

	if (tagName === 'img') {
		extraClasses.push('incremark-image');
	}

	if (BLOCK_HTML_TAGS.has(tagName)) {
		extraClasses.unshift('incremark-block');
	}

	const attrs = renderHtmlAttributes(getAttributes(node, 'attrs'), extraClasses);
	if (VOID_HTML_TAGS.has(tagName)) {
		return `<${tagName}${attrs} />`;
	}

	const content = BLOCK_HTML_TAGS.has(tagName)
		? renderMixedChildren(getChildren(node))
		: renderInlineChildren(getChildren(node));
	return `<${tagName}${attrs}>${content}</${tagName}>`;
}

function renderFootnoteDefinition(node: NodeLike): string {
	const identifier = sanitizeClassToken(getString(node, 'identifier'));
	const idAttr = identifier ? ` id="footnote-${escapeAttribute(identifier)}"` : '';
	return `<div class="incremark-block incremark-footnote-definition"${idAttr}>${renderBlockChildren(getChildren(node))}</div>`;
}

function renderMixedChildren(children: NodeLike[]): string {
	return children.map((child) => renderAny(child)).join('');
}

function renderAny(node: NodeLike): string {
	const type = getType(node);
	if (type === 'textDirective') {
		return renderDirectiveInline(node);
	}

	if (type === 'htmlElement') {
		const tagName = getString(node, 'tagName').toLowerCase();
		return BLOCK_HTML_TAGS.has(tagName) ? renderBlock(node) : renderInline(node);
	}

	if (isInlineType(type)) {
		return renderInline(node);
	}

	return renderBlock(node);
}

function wrapBlock(tag: string, className: string, content: string): string {
	return `<${tag} class="incremark-block ${className}">${content}</${tag}>`;
}

function renderKatexPlaceholder(formula: string, displayMode: boolean): string {
	const trimmedFormula = formula.trim();
	if (!trimmedFormula) {
		return displayMode ? '' : '<span class="incremark-inline-math"></span>';
	}

	if (displayMode) {
		return `<div class="incremark-block incremark-math incremark-math--pending" data-incremark-math="${escapeAttribute(trimmedFormula)}" data-incremark-math-display="block"><pre><code>${escapeHtml(trimmedFormula)}</code></pre></div>`;
	}

	return `<code class="incremark-inline-code incremark-inline-math incremark-inline-math--pending" data-incremark-math="${escapeAttribute(trimmedFormula)}" data-incremark-math-display="inline">${escapeHtml(trimmedFormula)}</code>`;
}

function renderKatexFormulaHtml(katex: KatexRenderer, formula: string, displayMode: boolean): string {
	const trimmedFormula = formula.trim();
	if (!trimmedFormula) {
		return displayMode ? '' : '<span class="incremark-inline-math"></span>';
	}

	try {
		const renderedFormula = katex.renderToString(trimmedFormula, {
			displayMode,
			output: 'htmlAndMathml',
			throwOnError: false,
			trust: false
		});

		if (displayMode) {
			return `<div class="incremark-block incremark-math incremark-math--rendered">${renderedFormula}</div>`;
		}

		return `<span class="incremark-inline-math incremark-inline-math--rendered">${renderedFormula}</span>`;
	} catch {
		return renderKatexFallbackHtml(trimmedFormula, displayMode);
	}
}

function renderKatexFallbackHtml(formula: string, displayMode: boolean): string {
	if (displayMode) {
		return `<div class="incremark-block incremark-math incremark-math--fallback"><pre><code>${escapeHtml(formula)}</code></pre></div>`;
	}

	return `<code class="incremark-inline-code incremark-inline-math incremark-inline-math--fallback">${escapeHtml(formula)}</code>`;
}

function renderHtmlAttributes(attributes: Record<string, string>, extraClasses: string[]): string {
	const rendered: string[] = [];
	const classNames = [...extraClasses];

	for (const [name, rawValue] of Object.entries(attributes)) {
		const normalizedName = name.toLowerCase();
		if (normalizedName.startsWith('on')) {
			continue;
		}

		if (normalizedName === 'class') {
			if (rawValue.trim()) {
				classNames.push(rawValue.trim());
			}
			continue;
		}

		if (normalizedName === 'style') {
			continue;
		}

		if (!SAFE_HTML_ATTRIBUTES.has(normalizedName) && !normalizedName.startsWith('aria-') && !normalizedName.startsWith('data-')) {
			continue;
		}

		if (normalizedName === 'href' || normalizedName === 'src') {
			const safeUrl = sanitizeUrl(rawValue);
			if (!safeUrl) {
				continue;
			}
			rendered.push(` ${normalizedName}="${escapeAttribute(safeUrl)}"`);
			continue;
		}

		if (normalizedName === 'open') {
			if (rawValue !== 'false') {
				rendered.push(' open');
			}
			continue;
		}

		rendered.push(` ${normalizedName}="${escapeAttribute(rawValue)}"`);
	}

	if (classNames.length > 0) {
		rendered.unshift(` class="${escapeAttribute(classNames.join(' '))}"`);
	}

	return rendered.join('');
}

function getAttributes(node: NodeLike, key: string): Record<string, string> {
	const value = node[key];
	if (!value || typeof value !== 'object') {
		return {};
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).flatMap(([name, attrValue]) => {
			if (typeof attrValue !== 'string') {
				return [];
			}

			return [[name, attrValue]];
		})
	);
}

function getChildren(node: NodeLike): NodeLike[] {
	return Array.isArray(node.children) ? (node.children as NodeLike[]) : [];
}

function getType(node: NodeLike): string {
	return typeof node.type === 'string' ? node.type : '';
}

function getString(node: NodeLike, key: string): string {
	const value = node[key];
	return typeof value === 'string' ? value : '';
}

function getBoolean(node: NodeLike, key: string): boolean | undefined {
	const value = node[key];
	return typeof value === 'boolean' ? value : undefined;
}

function getNumber(node: NodeLike, key: string): number | undefined {
	const value = node[key];
	return typeof value === 'number' ? value : undefined;
}

function clampHeadingDepth(depth: number | undefined): 1 | 2 | 3 | 4 | 5 | 6 {
	if (!depth || depth < 1) {
		return 1;
	}

	if (depth > 6) {
		return 6;
	}

	return depth as 1 | 2 | 3 | 4 | 5 | 6;
}

function sanitizeUrl(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
		return trimmed;
	}

	try {
		const parsed = new URL(trimmed);
		return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
	} catch {
		return null;
	}
}

function isExternalHttpUrl(url: string): boolean {
	return HTTP_URL_RE.test(url);
}

function isInlineType(type: string): boolean {
	return type === 'break'
		|| type === 'delete'
		|| type === 'emphasis'
		|| type === 'footnoteReference'
		|| type === 'html'
		|| type === 'image'
		|| type === 'imageReference'
		|| type === 'inlineCode'
		|| type === 'inlineMath'
		|| type === 'link'
		|| type === 'linkReference'
		|| type === 'strong'
		|| type === 'text';
}

function sanitizeClassToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(CLASS_TOKEN_INVALID_CHARS_RE, '-')
		.replace(EDGE_HYPHENS_RE, '');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value);
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