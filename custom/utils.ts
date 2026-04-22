import { IMessage } from "./types";

export function remToPx(rem: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return rem * rootFontSize;
}

export function pxToRem(px: number): number {
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return px / rootFontSize;
}


export function getMessageParts(message: IMessage) {
  return message.parts?.length
    ? message.parts
    : [{ text: '', type: 'reasoning', state: 'streaming' }];
}

export function extractTitleAndTextFromReasoning(reasoningText: string): { title: string | null; body: string } {
  const match = reasoningText.match(/^\*\*(.*?)\*\*(.*)$/s);

  if (!match) {
    return {
      title: null,
      body: reasoningText
    };
  }

  return {
    title: match[1].trim(),
    body: match[2].trim()
  };
}