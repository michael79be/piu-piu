import type { MessageAction } from '@trystero-p2p/core';
import { SettingsData, FollowersData, FollowData } from '../models/post-data';

export interface RecoverMetaPayload {
  account: string;
}

export interface RecoverMetaResponse {
  account: string;
  settings: SettingsData | null;
  follow: FollowData | null;
  followers: FollowersData | null;
}

export interface RecoverMetaAction {
  action: MessageAction<RecoverMetaPayload | RecoverMetaResponse> | null;
  init(action: MessageAction<RecoverMetaPayload | RecoverMetaResponse>): void;
  send(payload: RecoverMetaPayload | RecoverMetaResponse, options?: { target?: string }): void;
  onMessage(cb: (data: RecoverMetaPayload | RecoverMetaResponse, context: { peerId: string; userId: string }) => void): void;
}

export function createRecoverMetaAction(): RecoverMetaAction {
  let action: MessageAction<RecoverMetaPayload | RecoverMetaResponse> | null = null;
  return {
    get action() { return action; },
    init(a: MessageAction<RecoverMetaPayload | RecoverMetaResponse>) { action = a; },
    send(payload: RecoverMetaPayload | RecoverMetaResponse, options?: { target?: string }) { action?.send(payload, options); },
    onMessage(cb: (data: RecoverMetaPayload | RecoverMetaResponse, context: { peerId: string; userId: string }) => void) { action?.onMessage(cb); },
  };
}
