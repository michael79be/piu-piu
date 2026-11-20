import type { MessageAction } from '@trystero-p2p/core';

export interface SignerInfo {
  username: string;
  account: string;
  publicKey: string;
  authenticatorData: string;
  clientData: string;
  signature: string;
  profileUrl: string;
}

export interface WhoamiPayload {
  signerInfo: SignerInfo;
}

export interface WhoamiAction {
  action: MessageAction<WhoamiPayload> | null;
  
  init(action: MessageAction<WhoamiPayload>): void;
  
  send(signerInfo: SignerInfo, options?: { target?: string }): void;
  
  onMessage(cb: (data: SignerInfo, context: { peerId: string; userId: string }) => void): void;
}

export function createWhoamiAction(): WhoamiAction {
  let action: MessageAction<WhoamiPayload> | null = null;
  
  return {
    get action() { return action; },
    init(a: MessageAction<WhoamiPayload>) { action = a; },
    send(signerInfo: SignerInfo, options?: { target?: string }) { action?.send({ signerInfo }, options); },
    onMessage(cb: (data: SignerInfo, context: { peerId: string; userId: string }) => void) { action?.onMessage((d, c) => cb(d.signerInfo, c)); },
  };
}