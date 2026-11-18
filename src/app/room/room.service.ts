import { Injectable, signal, computed, inject } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import type { Room, PeerJoinContext, PeerLeaveContext, UserInfo, RequestActionConfig, RequestOptions, DataPayload, RequestAction, MessageAction } from '@trystero-p2p/core';
import { SESSION_KEY } from '../auth/auth.enum';

export interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  signerInfo?: SignerInfo;
}

export interface SignerInfo {
  username: string;
  account: string;
  publicKey: number[];
  authenticatorData: number[];
  clientData: number[];
  signature: number[];
  profileUrl: string;
}

export interface WhoamiPayload {
  signerInfo: SignerInfo;
}

@Injectable({ providedIn: 'root' })
export class RoomService {
  private toastService = inject(TuiToastService);

  private roomInstance = signal<Room | null>(null);
  private whoamiAction = signal<MessageAction<SignerInfo> | null>(null);

  peers = signal<Peer[]>([]);
  currentAccount = signal<string | null>(null);
  isConnected = signal(false);
  selfId = signal<string | null>(null);

  readonly peerCount = computed(() => this.peers().length);

  async joinRoom(accountName: string): Promise<void> {
    if (this.roomInstance()) {
      this.leaveRoom();
    }

    try {
      const { joinRoom } = await import('trystero');
      const room = joinRoom(
        { appId: 'piu-piu' },
        accountName
      );

      this.roomInstance.set(room);
      this.isConnected.set(true);
      this.currentAccount.set(accountName);
      this.peers.set([]);

      const selfInfo = await room.getSelf();
      this.selfId.set(selfInfo.userId);
      console.debug('[Room] joined room:', accountName, 'selfId:', selfInfo.userId);

      const whoamiAction = room.makeAction('whoami') as MessageAction<SignerInfo>;
      this.whoamiAction.set(whoamiAction);

      whoamiAction.onMessage((data: SignerInfo, context: { peerId: string; userId: string }) => {
        console.debug('[Room] whoami received from:', context.peerId, 'signer:', data.username);
        const peer = this.peers().find(p => p.id === context.peerId);
        if (peer) {
          this.peers.update(current =>
            current.map(p => p.id === context.peerId ? { ...p, signerInfo: data } : p)
          );
        }
      });

      room.onPeerJoin((context: PeerJoinContext) => {
        const users = room.getUsers();
        const userInfo = users[context.userId];
        const peer: Peer = {
          id: context.peerId,
          name: userInfo?.peerIds?.[0] ?? context.userId,
          joinedAt: Date.now(),
        };
        this.peers.update(current => {
          if (current.find(p => p.id === peer.id)) return current;
          return [...current, peer];
        });
        console.debug('[Room] peer joined:', context.peerId, 'userId:', context.userId);
        this.announceIfSignedIn(context.peerId);
      });

      room.onPeerLeave((context: PeerLeaveContext) => {
        this.peers.update(current => current.filter(p => p.id !== context.peerId));
        console.debug('[Room] peer left:', context.peerId, 'userId:', context.userId);
      });

      await room.ready;

      this.announceIfSignedIn();

    } catch (error) {
      console.error('Failed to join room:', error);
      this.toastService.open('Failed to join room', { appearance: 'negative', autoClose: 5000 }).subscribe();
    }
  }

  private announceIfSignedIn(peerId?: string): void {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    try {
      const signer = JSON.parse(stored) as SignerInfo;
      const whoamiAction = this.whoamiAction();
      if (!whoamiAction) return;

      whoamiAction.send(signer, peerId ? {target: peerId} : undefined);
    } catch {
      // Not signed in, don't announce
    }
  }

  leaveRoom(): void {
    const room = this.roomInstance();
    if (room) {
      room.leave();
      this.roomInstance.set(null);
      this.whoamiAction.set(null);
    }
    this.isConnected.set(false);
    this.peers.set([]);
    this.currentAccount.set(null);
    this.selfId.set(null);
  }
}