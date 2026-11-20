import type { MessageAction } from '@trystero-p2p/core';

export interface PostData {
  uuid: string;
  sender: string;
  senderAccount: string;
  timestamp: number;
  content: string;
  publicKey: string;
  signature: string;
  authenticatorData: string;
  clientData: string;
}

export interface PostAction {
  action: MessageAction<PostData> | null;
  
  init(action: MessageAction<PostData>): void;
  
  send(post: PostData): void;
  
  onMessage(cb: (data: PostData, context: { peerId: string; userId: string }) => void): void;
}

export function createPostAction(): PostAction {
  let action: MessageAction<PostData> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<PostData>) { action = a; },
    send(post: PostData) { action?.send(post); },
    onMessage(cb: (data: PostData, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}