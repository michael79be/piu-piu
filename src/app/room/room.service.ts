import { Injectable, signal, computed, inject, NgZone } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import type { Room, PeerJoinContext, PeerLeaveContext } from '@trystero-p2p/core';
import { SESSION_KEY } from '../auth/auth.enum';
import { PostService, PostData } from '../post/post.service';
import { createWhoamiAction, type WhoamiAction } from './whoami';
import { createPostAction, type PostAction } from './post';
import { createRequestAction, type RequestAction } from './request';
import { createProvideAction, type ProvideAction } from './provide';

export interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  signerInfo?: SignerInfo;
}

export interface SignerInfo {
  username: string;
  account: string;
  publicKey: string;
  authenticatorData: string;
  clientData: string;
  signature: string;
  profileUrl: string;
}

export interface RequestPayload {
  accountName: string;
  requesterId: string;
  before?: string;
  after?: string;
}

export interface ProvidePayload {
  accountName: string;
  posts: PostData[];
}

const GLOBAL_ROOM_NAME = 'piu-piu';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private toastService = inject(TuiToastService);
  private postService = inject(PostService);
  private zone = inject(NgZone);

  private roomInstance = signal<Room | null>(null);
  private globalRoomInstance = signal<Room | null>(null);
  private globalWhoamiAction: WhoamiAction = createWhoamiAction();
  private postAction: PostAction = createPostAction();
  private requestAction: RequestAction = createRequestAction();
  private provideAction: ProvideAction = createProvideAction();

  peers = signal<Peer[]>([]);
  globalPeers = signal<Peer[]>([]);
  currentAccount = signal<string | null>(null);
  isConnected = signal(false);
  isGlobalConnected = signal(false);
  selfId = signal<string | null>(null);

  readonly peerCount = computed(() => this.peers().length);
  readonly globalPeerCount = computed(() => this.globalPeers().length);

  private pollingIntervals: ReturnType<typeof setInterval>[] = [];

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

      this.postAction.init(room.makeAction('post'));
      this.postAction.onMessage(async (data: PostData, context: { peerId: string; userId: string }) => {
        console.debug('[Room] post received from:', context.peerId, 'post:', data.uuid);
        await this.zone.run(() => this.handleIncomingPost(data));
      });

      this.requestAction.init(room.makeAction('request'));
      this.requestAction.onMessage(async (data: RequestPayload, context: { peerId: string; userId: string }) => {
        console.debug('[Room] request received from:', context.peerId, 'account:', data.accountName);
        await this.zone.run(() => this.handleRequest(data, context.peerId));
      });

      this.provideAction.init(room.makeAction('provide'));
      this.provideAction.onMessage(async (data: ProvidePayload, context: { peerId: string; userId: string }) => {
        console.debug('[Room] provide received from:', context.peerId, 'posts:', data.posts.length);
        await this.zone.run(() => this.handleProvide(data));
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
        this.requestPosts(accountName);
      });

      room.onPeerLeave((context: PeerLeaveContext) => {
        this.peers.update(current => current.filter(p => p.id !== context.peerId));
        console.debug('[Room] peer left:', context.peerId, 'userId:', context.userId);
      });

      await room.ready;

      await this.requestPosts(accountName);
      this.startPolling(accountName);

    } catch (error) {
      console.error('Failed to join room:', error);
      this.toastService.open('Failed to join room', { appearance: 'negative', autoClose: 5000 }).subscribe();
    }
  }

  async joinGlobalRoom(): Promise<void> {
    if (this.globalRoomInstance()) {
      return;
    }

    try {
      const { joinRoom } = await import('trystero');
      const room = joinRoom(
        { appId: 'piu-piu' },
        GLOBAL_ROOM_NAME
      );

      this.globalRoomInstance.set(room);
      this.isGlobalConnected.set(true);
      this.globalPeers.set([]);

      const selfInfo = await room.getSelf();
      console.debug('[Room] joined global room:', GLOBAL_ROOM_NAME, 'selfId:', selfInfo.userId);

      this.globalWhoamiAction.init(room.makeAction('whoami'));
      this.globalWhoamiAction.onMessage((data: SignerInfo, context: { peerId: string; userId: string }) => {
        console.debug('[Room] global whoami received from:', context.peerId, 'signer:', data.username);
        const peer = this.globalPeers().find(p => p.id === context.peerId);
        if (peer) {
          this.globalPeers.update(current =>
            current.map(p => p.id === context.peerId ? { ...p, signerInfo: data } : p)
          );
        } else {
          const newPeer: Peer = {
            id: context.peerId,
            name: data.username,
            joinedAt: Date.now(),
            signerInfo: data,
          };
          this.globalPeers.update(current => [...current, newPeer]);
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
        this.globalPeers.update(current => {
          if (current.find(p => p.id === peer.id)) return current;
          return [...current, peer];
        });
        console.debug('[Room] global peer joined:', context.peerId, 'userId:', context.userId);
        this.announceGlobalIfSignedIn(context.peerId);
      });

      room.onPeerLeave((context: PeerLeaveContext) => {
        this.globalPeers.update(current => current.filter(p => p.id !== context.peerId));
        console.debug('[Room] global peer left:', context.peerId, 'userId:', context.userId);
      });

      await room.ready;

      this.announceGlobalIfSignedIn();

    } catch (error) {
      console.error('Failed to join global room:', error);
    }
  }

  leaveGlobalRoom(): void {
    const room = this.globalRoomInstance();
    if (room) {
      room.leave();
      this.globalRoomInstance.set(null);
      this.globalWhoamiAction = createWhoamiAction();
    }
    this.isGlobalConnected.set(false);
    this.globalPeers.set([]);
  }

  private async requestPosts(accountName: string, options?: { before?: string; after?: string }): Promise<void> {
    const payload: RequestPayload = {
      accountName,
      requesterId: this.selfId() ?? '',
      before: options?.before,
      after: options?.after,
    };

    this.requestAction.send(payload);
    console.debug('[Room] Requested posts for:', accountName, 'before:', options?.before, 'after:', options?.after);
  }

  private async handleRequest(data: RequestPayload, peerId: string): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName || accountName !== data.accountName) return;

    let posts = await this.postService.getAllPosts(accountName);

    if (data.before) {
      const beforeIndex = posts.findIndex(p => p.uuid === data.before);
      if (beforeIndex >= 0) {
        posts = posts.slice(0, beforeIndex);
      }
    }

    if (data.after) {
      const afterIndex = posts.findIndex(p => p.uuid === data.after);
      if (afterIndex >= 0) {
        posts = posts.slice(afterIndex + 1);
      }
    }

    if (posts.length === 0) {
      console.debug('[Room] No posts to provide for:', accountName, 'before:', data.before, 'after:', data.after);
      return;
    }

    const provide = this.provideAction;
    if (!provide) return;

    const payload: ProvidePayload = {
      accountName,
      posts,
    };

    await provide.send(payload, { target: peerId });
    console.debug('[Room] Provided', posts.length, 'posts to:', peerId, 'before:', data.before, 'after:', data.after);
  }

  private async handleProvide(data: ProvidePayload): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName || accountName !== data.accountName) return;

    console.debug('[Room] Received', data.posts.length, 'posts from peer');
    for (const post of data.posts) {
      await this.handleIncomingPost(post);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  private async handleIncomingPost(post: PostData): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName) return;

    const publicKey = post.publicKey;
    if (!publicKey || publicKey.length === 0) {
      console.warn('[Room] No public key in post from:', post.senderAccount);
      return;
    }

    const isValid = await this.postService.verifyPost(post);
    if (!isValid) {
      console.warn('[Room] Invalid post signature from:', post.senderAccount);
      return;
    }

    const existing = await this.postService.getPost(accountName, post.uuid);
    if (existing) {
      console.debug('[Room] Post already exists:', post.uuid);
      return;
    }

    const db = await this.postService.getDB(accountName);
    await db.put('posts', JSON.stringify(post), post.uuid);
    console.debug('[Room] Stored verified post from:', post.senderAccount);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  private async startPolling(accountName: string): Promise<void> {
    this.stopPolling();

    const posts = await this.postService.getAllPosts(accountName);
    const latestUuid = posts.length > 0 ? posts[0].uuid : undefined;
    const oldestUuid = posts.length > 0 ? posts[posts.length - 1].uuid : undefined;

    // Poll for newer posts (after latest) every 10 seconds
    const afterInterval = setInterval(async () => {
      const currentPosts = await this.postService.getAllPosts(accountName);
      const latest = currentPosts.length > 0 ? currentPosts[0].uuid : undefined;
      if (latest) {
        this.requestPosts(accountName, { after: latest });
      }
    }, 10000);
    this.pollingIntervals.push(afterInterval);

    // Poll for older posts (before oldest) every 30 seconds
    const beforeInterval = setInterval(async () => {
      const currentPosts = await this.postService.getAllPosts(accountName);
      const oldest = currentPosts.length > 0 ? currentPosts[currentPosts.length - 1].uuid : undefined;
      if (oldest) {
        this.requestPosts(accountName, { before: oldest });
      }
    }, 30000);
    this.pollingIntervals.push(beforeInterval);

    // Initial request for older posts if we have any
    if (oldestUuid) {
      this.requestPosts(accountName, { before: oldestUuid });
    }
  }

  private stopPolling(): void {
    for (const interval of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals = [];
  }

  async broadcastPost(post: PostData): Promise<void> {
    this.postAction.send(post);
    console.debug('[Room] Broadcasted post:', post.uuid);
  }

  private announceGlobalIfSignedIn(peerId?: string): void {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    try {
      const signer = JSON.parse(stored) as SignerInfo;
      this.globalWhoamiAction.send(signer, peerId ? { target: peerId } : undefined);
    } catch {
      // Not signed in, don't announce
    }
  }

  leaveRoom(): void {
    this.stopPolling();
    const room = this.roomInstance();
    if (room) {
      room.leave();
      this.roomInstance.set(null);
      this.postAction = createPostAction();
      this.requestAction = createRequestAction();
      this.provideAction = createProvideAction();
    }
    this.isConnected.set(false);
    this.peers.set([]);
    this.currentAccount.set(null);
    this.selfId.set(null);
  }

  logout(): void {
    this.leaveRoom();
    this.leaveGlobalRoom();
  }
}