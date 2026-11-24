import { Injectable, signal, computed, inject, NgZone, OnDestroy } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import type { Room, PeerJoinContext, PeerLeaveContext } from '@trystero-p2p/core';
import { SESSION_KEY } from '../auth/auth.enum';
import { PostService } from '../post/post.service';
import { MessageData, FollowData } from '../models/post-data';
import { CryptoService } from '../crypto/crypto.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { AuthService } from '../auth/auth.service';
import { createWhoamiAction, type WhoamiAction } from './whoami';
import { createPostAction, type PostAction } from './post';
import { createRequestAction, type RequestAction } from './request';
import { createProvideAction, type ProvideAction } from './provide';
import { SignerInfo } from '../models/signer-info';
import { WhoamiPayload } from '../models/whoami';
import { ProfileService } from '../profile/profile.service';
import { getProviderByPrefix } from '../provider/provider.enum';

export interface Peer {
  id: string;
  name: string;
  joinedAt: number;
  signerInfo?: SignerInfo;
}

export interface RequestPayload {
  accountName: string;
  requesterId: string;
  before?: string;
  after?: string;
}

export interface ProvidePayload {
  accountName: string;
  posts: MessageData[];
}

const GLOBAL_ROOM_NAME = 'piu-piu';

@Injectable({ providedIn: 'root' })
export class RoomService implements OnDestroy {
  private toastService = inject(TuiToastService);
  private postService = inject(PostService);
  private cryptoService = inject(CryptoService);
  private rsaPublicKeyService = inject(RsaPublicKeyService);
  private authService = inject(AuthService);
  private zone = inject(NgZone);

  private profileService = inject(ProfileService);

  private roomInstance = signal<Room | null>(null);
  private globalRoomInstance = signal<Room | null>(null);
  private globalWhoamiAction: WhoamiAction = createWhoamiAction();
  private globalRequestAction: RequestAction = createRequestAction();
  private globalProvideAction: ProvideAction = createProvideAction();
  private postAction: PostAction = createPostAction();
  private requestAction: RequestAction = createRequestAction();
  private provideAction: ProvideAction = createProvideAction();

  // Separate locks for account room and global room
  private accountJoinLock = Promise.resolve();
  private globalJoinLock = Promise.resolve();

  peers = signal<Peer[]>([]);
  globalPeers = signal<Peer[]>([]);
  currentAccount = signal<string | null>(null);
  isConnected = signal(false);
  isGlobalConnected = signal(false);
  selfId = signal<string | null>(null);

  readonly peerCount = computed(() => this.peers().length);
  readonly globalPeerCount = computed(() => this.globalPeers().length);

  private pollingIntervals: ReturnType<typeof setInterval>[] = [];

  // Initialize from sessionStorage on service creation
  constructor() {
  }

  ngOnDestroy(): void {
    this.leaveRoom();
    this.leaveGlobalRoom();
  }

  async joinRoom(accountName: string): Promise<void> {
    // Wait for any ongoing account room join to complete
    await this.accountJoinLock;
    
    // Check again after lock
    if (this.roomInstance() && this.currentAccount() === accountName) {
      console.debug('🟢 [Room] Already in room:', accountName);
      return;
    }

    // Create new lock for this join operation
    this.accountJoinLock = (async () => {
      this.leaveRoom();

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
        console.info('🔵 [Room] Joined room:', accountName, 'selfId:', selfInfo.userId);

        this.postAction.init(room.makeAction('post'));
        this.postAction.onMessage(async (data: MessageData, context: { peerId: string; userId: string }) => {
          console.debug('🟢 [Room] Post received from:', context.peerId, 'post:', data.uuid);
          await this.zone.run(() => this.handleIncomingPost(data));
        });

        this.requestAction.init(room.makeAction('request'));
        this.requestAction.onMessage(async (data: RequestPayload, context: { peerId: string; userId: string }) => {
          console.debug('🟢 [Room] Request received from:', context.peerId, 'account:', data.accountName);
          await this.zone.run(() => this.handleRequest(data, context.peerId));
        });

        this.provideAction.init(room.makeAction('provide'));
        this.provideAction.onMessage(async (data: ProvidePayload, context: { peerId: string; userId: string }) => {
          console.debug('🟢 [Room] Provide received from:', context.peerId, 'posts:', data.posts.length);
          await this.zone.run(() => this.handleProvide(data));
        });

        room.onPeerJoin(async (context: PeerJoinContext) => {
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
          console.debug('🟢 [Room] Peer joined:', context.peerId, 'userId:', context.userId);
          this.requestPosts(accountName);
          const meta = await this.postService.getMeta(accountName);
        });

        room.onPeerLeave((context: PeerLeaveContext) => {
          this.peers.update(current => current.filter(p => p.id !== context.peerId));
          console.debug('🟢 [Room] Peer left:', context.peerId, 'userId:', context.userId);
        });

        await room.ready;

        await this.requestPosts(accountName);
        // Poll @ posts (settings, follow) on join
        const meta = await this.postService.getMeta(accountName);
        for (const m of meta) {
          await this.broadcastPost(m as unknown as MessageData);
        }
        this.startPolling(accountName);

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('already joined room')) {
          console.debug('🟢 [Room] Room already joined (race):', msg);
        } else {
          console.error('🔴 [Room] Failed to join room:', error);
          this.toastService.open('Failed to join room', { appearance: 'negative', autoClose: 5000 }).subscribe();
        }
      }
})();
     
    await this.accountJoinLock;
  }

  async joinGlobalRoom(): Promise<void> {
    // Wait for any ongoing global room join to complete
    await this.globalJoinLock;
    
    // Check again after lock
    if (this.globalRoomInstance() || this.isGlobalConnected()) {
      return;
    }

    this.globalJoinLock = (async () => {
      this.leaveGlobalRoom();

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
        console.info('🔵 [Room] Joined global room:', GLOBAL_ROOM_NAME, 'selfId:', selfInfo.userId);

        this.globalWhoamiAction.init(room.makeAction('whoami'));
        this.globalWhoamiAction.onMessage((data: WhoamiPayload, context: { peerId: string; userId: string }) => {
          console.debug('🟢 [Room] Global whoami received from:', context.peerId, 'account:', data.account);
          const peer = this.globalPeers().find(p => p.id === context.peerId);
          if (peer) {
            this.globalPeers.update(current =>
              current.map(p => p.id === context.peerId ? { ...p, signerInfo: { ...p.signerInfo!, username: data.username, account: data.account, providerSuffix: data.providerSuffix, subscription: data.subscription } } : p)
            );
          } else {
            const newPeer: Peer = {
              id: context.peerId,
              name: data.username,
              joinedAt: Date.now(),
              signerInfo: {
                username: data.username,
                account: data.account,
                providerSuffix: data.providerSuffix,
                subscription: data.subscription,
              } as any,
            };
            this.globalPeers.update(current => [...current, newPeer]);
          }
        });

        // Handle request in global room - respond if we own the account
        this.globalRequestAction = createRequestAction();
        this.globalRequestAction.init(room.makeAction('request'));
        this.globalRequestAction.onMessage(async (data: RequestPayload, context: { peerId: string; userId: string }) => {
          console.debug('🟢 [Room] Global request received from:', context.peerId, 'account:', data.accountName);
          await this.zone.run(() => this.handleRequest(data, context.peerId, true));
        });

        // Provide action for global room
        this.globalProvideAction = createProvideAction();
        this.globalProvideAction.init(room.makeAction('provide'));

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
          console.debug('🟢 [Room] Global peer joined:', context.peerId, 'userId:', context.userId);
          this.announceGlobalIfSignedIn(context.peerId);
        });

        room.onPeerLeave((context: PeerLeaveContext) => {
          this.globalPeers.update(current => current.filter(p => p.id !== context.peerId));
          console.debug('🟢 [Room] Global peer left:', context.peerId, 'userId:', context.userId);
        });

        await room.ready;

        this.announceGlobalIfSignedIn();

        // Update follow lastId from local databases after joining global room
        const signer = this.authService?.storedSigner?.();
        if (signer?.account) {
          await this.postService.getFollow(signer.account);
        }

      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('already joined room')) {
          console.debug('🟢 [Room] Global room already joined (race):', msg);
        } else {
          console.error('🔴 [Room] Failed to join global room:', error);
        }
      }
})();
     
    await this.globalJoinLock;
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
    console.debug('🟢 [Room] Requested posts for:', accountName, 'before:', options?.before, 'after:', options?.after);
  }

  private async handleRequest(data: RequestPayload, peerId: string, isGlobal = false): Promise<void> {
    const accountName = isGlobal ? data.accountName : this.currentAccount();
    if (!accountName || (!isGlobal && accountName !== data.accountName)) return;

    let posts = await this.postService.getAllPostsWithFullData(accountName);

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
      console.debug('🟢 [Room] No posts to provide for:', accountName, 'before:', data.before, 'after:', data.after);
      return;
    }

    const provide = isGlobal ? this.globalProvideAction : this.provideAction;
    if (!provide) return;

    const meta = await this.postService.getMeta(accountName);
    const signer = this.authService?.storedSigner?.();
    
    // Convert meta to MessageData format
    const metaPosts: MessageData[] = meta.map(m => ({
      uuid: 'avatarUrl' in m ? '@settings' : '@follow',
      sender: signer?.username ?? 'unknown',
      senderAccount: signer?.account ?? accountName,
      timestamp: Date.now(),
      content: 'avatarUrl' in m ? 'settings' : 'follow',
      publicKey: signer?.publicKey ?? '',
      signature: m.signature ?? '',
      authenticatorData: m.authenticatorData ?? '',
      clientData: m.clientData ?? '',
    }));

    const allPosts = [...posts, ...metaPosts];

    if (allPosts.length === 0) {
      console.debug('🟢 [Room] No posts to provide for:', accountName, 'before:', data.before, 'after:', data.after);
      return;
    }

    const payload: ProvidePayload = {
      accountName,
      posts: allPosts,
    };

    await provide.send(payload, { target: peerId });
    console.debug('🟢 [Room] Provided', allPosts.length, 'posts to:', peerId, 'before:', data.before, 'after:', data.after);
  }

  private async handleProvide(data: ProvidePayload): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName || accountName !== data.accountName) return;

    console.debug('🟢 [Room] Received', data.posts.length, 'posts from peer');
    for (const post of data.posts) {
      await this.handleIncomingPost(post);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  private async handleIncomingPost(post: MessageData): Promise<void> {
    const accountName = this.currentAccount();
    if (!accountName) return;

    const isMeta = post.uuid === '@settings' || post.uuid === '@follow';

    if (!isMeta) {
      const publicKey = post.publicKey;
      if (!publicKey || publicKey.length === 0) {
        console.warn('🟡 [Room] No public key in post from:', post.senderAccount);
        return;
      }

      const isValid = await this.postService.verifyPost(post);
      if (!isValid) {
        console.warn('🟡 [Room] Invalid post signature from:', post.senderAccount);
        return;
      }

      const existing = await this.postService.getPost(accountName, post.uuid);
      if (existing) {
        console.debug('🟢 [Room] Post already exists:', post.uuid);
        return;
      }
    }

    const db = await this.postService.getDB(accountName);
    await db.put('posts', JSON.stringify(post), post.uuid);
    console.debug('🟢 [Room] Stored verified', isMeta ? 'meta' : 'post', 'from:', post.senderAccount);
    
    // Update follow lastId if this is a regular post (not meta)
    if (!isMeta) {
      await this.postService.updateFollowLastId(accountName, post.senderAccount, post.uuid);
    }
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  private async startPolling(accountName: string): Promise<void> {
    this.stopPolling();

    const posts = await this.postService.getAllPostsWithFullData(accountName);
    const latestUuid = posts.length > 0 ? posts[0].uuid : undefined;
    const oldestUuid = posts.length > 0 ? posts[posts.length - 1].uuid : undefined;

    // Poll for newer posts (after latest) every 10 seconds
    const afterInterval = setInterval(async () => {
      const currentPosts = await this.postService.getAllPostsWithFullData(accountName);
      const latest = currentPosts.length > 0 ? currentPosts[0].uuid : undefined;
      if (latest) {
        this.requestPosts(accountName, { after: latest });
      }
    }, 10000);
    this.pollingIntervals.push(afterInterval);

    // Poll for older posts (before oldest) every 30 seconds
    const beforeInterval = setInterval(async () => {
      const currentPosts = await this.postService.getAllPostsWithFullData(accountName);
      const oldest = currentPosts.length > 0 ? currentPosts[currentPosts.length - 1].uuid : undefined;
      if (oldest) {
        this.requestPosts(accountName, { before: oldest });
      }
    }, 30000);
    this.pollingIntervals.push(beforeInterval);

    // Poll for @ posts (settings, follow) every 60 seconds and broadcast them
    const metaInterval = setInterval(async () => {
      const meta = await this.postService.getMeta(accountName);
      for (const m of meta) {
        await this.broadcastPost(m as unknown as MessageData);
      }
    }, 60000);
    this.pollingIntervals.push(metaInterval);

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

  async broadcastPost(post: MessageData): Promise<void> {
    this.postAction.send(post);
    console.debug('🟢 [Room] Broadcasted post:', post.uuid);
  }

  private async announceGlobalIfSignedIn(peerId?: string): Promise<void> {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    try {
      const signer = JSON.parse(stored) as SignerInfo;
      // Only include PushSubscription in whoami, not the encrypted account name fallback
      const subscription = signer.subscription ?? undefined;
      
      // Get provider suffix from profile
      const profile = this.profileService.getProfileData();
      const providerPrefix = profile?.provider ?? '';
      const providerSuffix = getProviderByPrefix(providerPrefix)?.prefix ?? '';
      
      // Get full follow data (signed)
      let follow: FollowData | undefined;
      if (signer.account) {
        const followData = await this.postService.getFollow(signer.account);
        if (followData) follow = followData;
      }

      const payload: WhoamiPayload = {
        username: signer.username,
        account: signer.account,
        providerSuffix,
        subscription,
        follow,
      };
      this.globalWhoamiAction.send(payload, peerId ? { target: peerId } : undefined);
    } catch {
      // Not signed in, don't announce
    }
  }

  async updateWhoamiSubscription(subscription: string): Promise<void> {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return;

    try {
      const signer = JSON.parse(stored) as SignerInfo;
      const profile = this.profileService.getProfileData();
      const providerPrefix = profile?.provider ?? '';
      const providerSuffix = getProviderByPrefix(providerPrefix)?.prefix ?? '';
      
      const payload: WhoamiPayload = {
        username: signer.username,
        account: signer.account,
        providerSuffix,
        subscription: subscription || undefined,
      };
      // Update sessionStorage only if setting a subscription (not clearing)
      if (subscription) {
        const signerWithSubscription: SignerInfo = {
          ...signer,
          subscription,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(signerWithSubscription));
      }
      this.globalWhoamiAction.send(payload);
    } catch {
      // Not signed in, don't announce
    }
  }

  leaveRoom(): void {
    this.stopPolling();
    
    // Leave current room
    const room = this.roomInstance();
    if (room) {
      room.leave();
      this.roomInstance.set(null);
    }
    
    // Reset actions
    this.postAction = createPostAction();
    this.requestAction = createRequestAction();
    this.provideAction = createProvideAction();
    
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