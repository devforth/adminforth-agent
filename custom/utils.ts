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