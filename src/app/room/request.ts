import type { MessageAction } from '@trystero-p2p/core';

export interface RequestPayload {
  accountName: string;
  requesterId: string;
  before?: string;
  after?: string;
}

export interface RequestAction {
  action: MessageAction<RequestPayload> | null;
  
  init(action: MessageAction<RequestPayload>): void;
  
  send(payload: RequestPayload): void;
  
  onMessage(cb: (data: RequestPayload, context: { peerId: string; userId: string }) => void): void;
}

export function createRequestAction(): RequestAction {
  let action: MessageAction<RequestPayload> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<RequestPayload>) { action = a; },
    send(payload: RequestPayload) { action?.send(payload); },
    onMessage(cb: (data: RequestPayload, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}