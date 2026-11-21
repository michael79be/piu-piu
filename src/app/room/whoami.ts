import type { MessageAction } from '@trystero-p2p/core';
import { WhoamiPayload } from '../models/whoami';

export interface WhoamiAction {
  action: MessageAction<WhoamiPayload> | null;
  
  init(action: MessageAction<WhoamiPayload>): void;
  
  send(payload: WhoamiPayload, options?: { target?: string }): void;
  
  onMessage(cb: (data: WhoamiPayload, context: { peerId: string; userId: string }) => void): void;
}

export function createWhoamiAction(): WhoamiAction {
  let action: MessageAction<WhoamiPayload> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<WhoamiPayload>) { action = a; },
    send(payload: WhoamiPayload, options?: { target?: string }) { action?.send(payload, options); },
    onMessage(cb: (data: WhoamiPayload, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}