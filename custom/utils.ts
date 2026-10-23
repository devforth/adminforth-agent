import { IMessage, IPart } from "./types";

export function remToPx(rem: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return rem * rootFontSize;
}

export function pxToRem(px: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px / rootFontSize;
}

// #app and the header make room for the docked chat, both exist while ChatSurface is mounted in the header
export function getLayoutElements(): HTMLElement[] {
  return [document.getElementById('app')!, document.getElementById('af-header-nav')!];
}


export function getMessageParts(message: IMessage): IPart[] {
  return message.parts?.length
    ? message.parts
    : [{ text: '', type: 'reasoning', state: 'streaming' }];
}

function addNewLineBeforeTitles(text: string): string {
  return text.replace(/(\*\*[^*]+\*\*)/g, '\n\n$1');
}

export function extractTitleAndTextFromReasoning(reasoningText: string): { title: string | null; body: string } {
  const match = reasoningText.match(/^\*\*(.*?)\*\*(.*)$/s);

  if (!match) {
    return {
      title: null,
      body: addNewLineBeforeTitles(reasoningText)
    };
  }

  return {
    title: match[1].trim(),
    body: addNewLineBeforeTitles(match[2].trim())
  };
}