const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)]\(([^)]+)\)/g;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)]\(([^)]+)\)/g;
const HTML_TAG_RE = /<[^>]+>/g;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const BRACKETED_META_RE = /\[(?:ref|link|url|source|sources?|debug|meta|data):[^\]]*]/gi;
const MD_HEADING_LINE_RE = /^\s{0,3}#{1,6}\s+/gm;
const MD_BLOCKQUOTE_RE = /^\s{0,3}>\s?/gm;
const MD_HR_RE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm;
const MD_LIST_MARKER_RE = /^\s{0,3}(?:[-*+]|\d+\.)\s+/gm;
const MD_EMPHASIS_RE = /(\*\*|__)(.*?)\1/g;
const MD_ITALIC_RE = /(^|[^\\])(?:\*|_)([^\s].*?)(?:\*|_)/g;

export function sanitizeSpeechText(input: string): string {
  return input
    .replace(CODE_FENCE_RE, " ")
    .replace(MARKDOWN_IMAGE_RE, "$1")
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(URL_RE, " ")
    .replace(MD_HEADING_LINE_RE, "")
    .replace(MD_BLOCKQUOTE_RE, "")
    .replace(MD_HR_RE, " ")
    .replace(MD_LIST_MARKER_RE, "")
    .replace(MD_EMPHASIS_RE, "$2")
    .replace(MD_ITALIC_RE, "$1$2")
    .replace(HTML_TAG_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(BRACKETED_META_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}
