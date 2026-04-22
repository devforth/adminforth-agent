import { IMessage, IPart } from "./types";

export function remToPx(rem: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return rem * rootFontSize;
}

export function pxToRem(px: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px / rootFontSize;
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