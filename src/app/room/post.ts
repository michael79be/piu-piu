import type { MessageAction } from '@trystero-p2p/core';
import { MessageData } from '../models/post-data';

export interface PostAction {
  action: MessageAction<MessageData> | null;
  
  init(action: MessageAction<MessageData>): void;
  
  send(post: MessageData): void;
  
  onMessage(cb: (data: MessageData, context: { peerId: string; userId: string }) => void): void;
}

export function createPostAction(): PostAction {
  let action: MessageAction<MessageData> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<MessageData>) { action = a; },
    send(post: MessageData) { action?.send(post); },
    onMessage(cb: (data: MessageData, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}