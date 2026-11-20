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

export interface ProvidePayload {
  accountName: string;
  posts: PostData[];
}

export interface ProvideAction {
  action: MessageAction<ProvidePayload> | null;
  
  init(action: MessageAction<ProvidePayload>): void;
  
  send(payload: ProvidePayload, options?: { target: string }): Promise<void>;
  
  onMessage(cb: (data: ProvidePayload, context: { peerId: string; userId: string }) => void): void;
}

export function createProvideAction(): ProvideAction {
  let action: MessageAction<ProvidePayload> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<ProvidePayload>) { action = a; },
    send(payload: ProvidePayload, options?: { target: string }) { return action?.send(payload, options) ?? Promise.resolve(); },
    onMessage(cb: (data: ProvidePayload, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}