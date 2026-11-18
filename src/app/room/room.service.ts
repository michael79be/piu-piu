import { Injectable, signal, computed, inject } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import type { Room, PeerJoinContext, PeerLeaveContext, UserInfo, RequestActionConfig, RequestOptions, DataPayload, RequestAction, MessageAction } from '@trystero-p2p/core';
import { SESSION_KEY } from '../auth/auth.enum';
import { PostService, PostData } from '../post/post.service';

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

export interface WhoamiPayload {
  signerInfo: SignerInfo;
}

export interface RequestPayload {
  accountName: string;
  requesterId: string;
}

export interface ProvidePayload {
  accountName: string;
  posts: PostData[];
}

@Injectable({ providedIn: 'root' })
export class RoomService {
  private toastService = inject(TuiToastService);
  private postService = inject(PostService);

  private roomInstance = signal<Room | null>(null);
  private whoamiAction = signal<MessageAction<SignerInfo> | null>(null);
  private postAction = signal<MessageAction<PostData> | null>(null);
  private requestAction = signal<MessageAction<RequestPayload> | null>(null);
  private provideAction = signal<MessageAction<ProvidePayload> | null>(null);

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

      const postAction = room.makeAction('post') as unknown as MessageAction<PostData>;
      this.postAction.set(postAction);

      postAction.onMessage(async (data: PostData, context: { peerId: string; userId: string }) => {
        console.debug('[Room] post received from:', context.peerId, 'post:', data.uuid);
        await this.handleIncomingPost(data);
      });

      const requestAction = room.makeAction('request') as unknown as MessageAction<RequestPayload>;
      this.requestAction.set(requestAction);

      requestAction.onMessage(async (data: RequestPayload, context: { peerId: string; userId: string }) => {
        console.debug('[Room] request received from:', context.peerId, 'account:', data.accountName);
        await this.handleRequest(data, context.peerId);
      });

      const provideAction = room.makeAction('provide') as unknown as MessageAction<ProvidePayload>;
      this.provideAction.set(provideAction);

      provideAction.onMessage(async (data: ProvidePayload, context: { peerId: string; userId: string }) => {
        console.debug('[Room] provide received from:', context.peerId, 'posts:', data.posts.length);
        await this.handleProvide(data);
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
        // Request posts from the new peer
        this.requestPosts(this.currentAccount()!);
      });

      room.onPeerLeave((context: PeerLeaveContext) => {
        this.peers.update(current => current.filter(p => p.id !== context.peerId));
        console.debug('[Room] peer left:', context.peerId, 'userId:', context.userId);
      });

      await room.ready;

      this.announceIfSignedIn();

      // Request posts from peers after joining
      await this.requestPosts(accountName);

    } catch (error) {
      console.error('Failed to join room:', error);
      this.toastService.open('Failed to join room', { appearance: 'negative', autoClose: 5000 }).subscribe();
    }
  }

  private async requestPosts(accountName: string): Promise<void> {
    const requestAction = this.requestAction();
    if (!requestAction) return;

    const payload: RequestPayload = {
      accountName,
      requesterId: this.selfId() ?? '',
    };

    requestAction.send(payload);
    console.debug('[Room] Requested posts for:', accountName);
  }

  private async handleRequest(data: RequestPayload, peerId: string): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName || accountName !== data.accountName) return;

    // Get all posts for this account
    const posts = await this.postService.getAllPosts(accountName);
    if (posts.length === 0) {
      console.debug('[Room] No posts to provide for:', accountName);
      return;
    }

    const provideAction = this.provideAction();
    if (!provideAction) return;

    const payload: ProvidePayload = {
      accountName,
      posts,
    };

    // Send directly to the requester
    provideAction.send(payload, { target: peerId });
    console.debug('[Room] Provided', posts.length, 'posts to:', peerId);
  }

  private async handleProvide(data: ProvidePayload): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName || accountName !== data.accountName) return;

    console.debug('[Room] Received', data.posts.length, 'posts from peer');
    for (const post of data.posts) {
      await this.handleIncomingPost(post);
    }
  }

  private async handleIncomingPost(post: PostData): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName) return;

    // Get the sender's public key from the post itself
    const publicKey = post.publicKey;
    if (!publicKey || publicKey.length === 0) {
      console.warn('[Room] No public key in post from:', post.senderAccount);
      return;
    }

    // Verify the post signature (same as account page)
    const isValid = await this.postService.verifyPost(post);
    if (!isValid) {
      console.warn('[Room] Invalid post signature from:', post.senderAccount);
      return;
    }

    // Check if post already exists
    const existing = await this.postService.getPost(accountName, post.uuid);
    if (existing) {
      console.debug('[Room] Post already exists:', post.uuid);
      return;
    }

    // Store the verified post
    const db = await this.postService.getDB(accountName);
    await db.put('posts', JSON.stringify(post), post.uuid);
    console.debug('[Room] Stored verified post from:', post.senderAccount);
    // Dispatch custom event for UI refresh
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  async broadcastPost(post: PostData): Promise<void> {
    const postAction = this.postAction();
    if (!postAction) {
      console.warn('[Room] No post action available');
      return;
    }

    postAction.send(post);
    console.debug('[Room] Broadcasted post:', post.uuid);
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
      this.postAction.set(null);
    }
    this.isConnected.set(false);
    this.peers.set([]);
    this.currentAccount.set(null);
    this.selfId.set(null);
  }
}