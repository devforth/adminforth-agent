/**
 * This file is used to fix circular module initialization between ai and @ai-sdk/vue
 * These files are depending on each other, but vite put them in different chunks, so they are not initialized at the same time, which causes the circular module initialization issue
 * So I get rid of the @ai-sdk/vue only fixes are:
 * 1) Change vite config to put these files in the same chunk
 * 2) Get rid of the circular module initialization by moving the Chat class to this file
 * 
 * Maybe there is a better way to fix this issue
 * 
 * If you were updating "ai" package and plugin broke, probably you need to update this file as well
 * Or resolve the circular module initialization issue in a better way
 */

import type {
  ChatInit as BaseChatInit,
  ChatState,
  ChatStatus,
  UIMessage,
} from 'ai';
import {   AbstractChat, } from 'ai'
import { Ref, ref } from 'vue';

class VueChatState<
  UI_MESSAGE extends UIMessage,
> implements ChatState<UI_MESSAGE> {
  private messagesRef: Ref<UI_MESSAGE[]>;
  private statusRef = ref<ChatStatus>('ready');
  private errorRef = ref<Error | undefined>(undefined);

  constructor(messages?: UI_MESSAGE[]) {
    this.messagesRef = ref(messages ?? []) as Ref<UI_MESSAGE[]>;
  }

  get messages(): UI_MESSAGE[] {
    return this.messagesRef.value;
  }

  set messages(messages: UI_MESSAGE[]) {
    this.messagesRef.value = messages;
  }

  get status(): ChatStatus {
    return this.statusRef.value;
  }

  set status(status: ChatStatus) {
    this.statusRef.value = status;
  }

  get error(): Error | undefined {
    return this.errorRef.value;
  }

  set error(error: Error | undefined) {
    this.errorRef.value = error;
  }

  pushMessage = (message: UI_MESSAGE) => {
    this.messagesRef.value = [...this.messagesRef.value, message];
  };

  popMessage = () => {
    this.messagesRef.value = this.messagesRef.value.slice(0, -1);
  };

  replaceMessage = (index: number, message: UI_MESSAGE) => {
    this.messagesRef.value[index] = { ...message };
  };

  snapshot = <T>(value: T): T => value;
}

export class Chat<
  UI_MESSAGE extends UIMessage,
> extends AbstractChat<UI_MESSAGE> {
  constructor({ messages, ...init }: BaseChatInit<UI_MESSAGE>) {
    super({
      ...init,
      state: new VueChatState(messages),
    });
  }
}