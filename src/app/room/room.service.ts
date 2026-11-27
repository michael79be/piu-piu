import { Injectable, signal, computed, inject, NgZone, OnDestroy } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';
import type { Room, PeerJoinContext, PeerLeaveContext } from '@trystero-p2p/core';
import { SESSION_KEY } from '../auth/auth.enum';
import { PostService } from '../post/post.service';
import { MessageData, FollowData, FollowersData } from '../models/post-data';
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
      // Re-request posts on reload/re-entry since peers may not have been connected before
      const localPosts = await this.postService.getAllPostsWithFullData(accountName);
      const latestUuid = localPosts.length > 0 ? localPosts[0].uuid : undefined;
      await this.requestPosts(accountName, { after: latestUuid });
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
        console.info('⬇️ [Room] Joined room:', accountName, 'selfId:', selfInfo.userId);

        this.postAction.init(room.makeAction('post'));
        this.postAction.onMessage(async (data: MessageData, context: { peerId: string; userId: string }) => {
          console.debug('⬇️ [Room] Post received from:', context.peerId, 'post:', data.uuid);
          await this.zone.run(() => this.handleIncomingPost(data));
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
          console.debug('⬇️ [Room] Peer joined:', context.peerId, 'userId:', context.userId);
          const meta = await this.postService.getMeta(accountName);
        });

        room.onPeerLeave((context: PeerLeaveContext) => {
          this.peers.update(current => current.filter(p => p.id !== context.peerId));
          console.debug('⬆️ [Room] Peer left:', context.peerId, 'userId:', context.userId);
        });

        await room.ready;

        // Broadcast request for this account's posts in global room
        // Use latest local post as 'after' filter for incremental sync
        const localPosts = await this.postService.getAllPostsWithFullData(accountName);
        const latestUuid = localPosts.length > 0 ? localPosts[0].uuid : undefined;
        await this.requestPosts(accountName, { after: latestUuid });
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
        console.info('⬇️ [Room] Joined global room:', GLOBAL_ROOM_NAME, 'selfId:', selfInfo.userId);

        this.globalWhoamiAction.init(room.makeAction('whoami'));
        this.globalWhoamiAction.onMessage(async (data: WhoamiPayload, context: { peerId: string; userId: string }) => {
          console.debug('⬇️ [Room] Global whoami received from:', context.peerId, 'account:', data.account);
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

          // Sync own @followers from received whoamis
          const me = this.authService.storedSigner();
          if (me && data.followers) {
            const isFollowingMe = !!data.followers.followers && me.account in data.followers.followers;
            await this.postService.updateFollowers(me.account, data.account, data.followers.followers?.[data.account], isFollowingMe);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName: me.account } }));
            }
          }
        });

        // Handle request in global room - respond if we own the account
        this.globalRequestAction = createRequestAction();
        this.globalRequestAction.init(room.makeAction('request'));
        this.globalRequestAction.onMessage(async (data: RequestPayload, context: { peerId: string; userId: string }) => {
          console.info('⬇️ [Room] Global request received from:', context.peerId, 'account:', data.accountName);
          await this.zone.run(() => this.handleRequest(data, context.peerId));
        });

        // Provide action for global room
        this.globalProvideAction = createProvideAction();
        this.globalProvideAction.init(room.makeAction('provide'));
        this.globalProvideAction.onMessage(async (data: ProvidePayload, context: { peerId: string; userId: string }) => {
          console.debug('⬇️ [Room] Global provide received from:', context.peerId, 'account:', data.accountName, 'posts:', data.posts.length);
          const targetAccount = data.accountName;
          for (const post of data.posts) {
            await this.zone.run(() => this.handleIncomingPost(post, targetAccount));
          }
        });

        room.onPeerJoin(async (context: PeerJoinContext) => {
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
          console.debug('⬇️ [Room] Global peer joined:', context.peerId, 'userId:', context.userId);
          this.announceGlobalIfSignedIn(context.peerId);

          // If viewing an account page, request its posts from the new peer
          const currentAcct = this.currentAccount();
          if (currentAcct) {
            const localPosts = await this.postService.getAllPostsWithFullData(currentAcct);
            const latestUuid = localPosts.length > 0 ? localPosts[0].uuid : undefined;
            await this.requestPosts(currentAcct, { after: latestUuid });
          }
        });

        room.onPeerLeave((context: PeerLeaveContext) => {
          this.globalPeers.update(current => current.filter(p => p.id !== context.peerId));
          console.debug('⬆️ [Room] Global peer left:', context.peerId, 'userId:', context.userId);
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

  private async handleRequest(data: RequestPayload, peerId: string): Promise<void> {
    const accountName = data.accountName;
    if (!accountName) return;

    // Filter regular posts by uuid range, but always include meta posts (@settings, @follow)
    const posts = await this.postService.getAllPostsWithFullData(accountName, false);
    console.info('⬇️ [Room] Global request check for:', accountName, 'found posts:', posts.length);

    let filteredPosts = posts;
    if (data.before) {
      const beforeIndex = filteredPosts.findIndex(p => p.uuid === data.before);
      if (beforeIndex >= 0) {
        filteredPosts = filteredPosts.slice(0, beforeIndex);
      }
    }

    if (data.after) {
      const afterIndex = filteredPosts.findIndex(p => p.uuid === data.after);
      if (afterIndex >= 0) {
        filteredPosts = filteredPosts.slice(afterIndex + 1);
      }
    }

    if (!this.globalProvideAction) return;

    // Always include meta posts (not filtered by uuid range)
    const meta = await this.postService.getMeta(accountName);
    const signer = this.authService?.storedSigner?.();
    
    const metaPosts: MessageData[] = meta.map(m => {
      const isSettings = 'avatarUrl' in m;
      const isFollowers = 'followers' in m;
      const post: MessageData = {
        uuid: isSettings ? '@settings' : isFollowers ? '@followers' : '@follow',
        sender: signer?.username ?? 'unknown',
        senderAccount: signer?.account ?? accountName,
        timestamp: Date.now(),
        content: isSettings ? 'settings' : isFollowers ? 'followers' : 'follow',
        publicKey: signer?.publicKey ?? '',
        signature: m.signature ?? '',
        authenticatorData: m.authenticatorData ?? '',
        clientData: m.clientData ?? '',
      };
      if (!isSettings && 'follows' in m) {
        (post as any).follows = (m as any).follows;
      }
      if (isFollowers && 'followers' in m) {
        (post as any).followers = (m as any).followers;
      }
      return post;
    });

    const allPosts = [...filteredPosts, ...metaPosts];

    if (allPosts.length === 0) {
      console.debug('⬆️ [Room] No posts to provide for @', accountName);
      return;
    }

    const payload: ProvidePayload = {
      accountName,
      posts: allPosts,
    };

    await this.globalProvideAction.send(payload, { target: peerId });
    console.debug('⬆️ [Room] Provided', allPosts.length, 'posts of @', accountName, 'to:', peerId);
  }

  async requestPosts(accountName: string, options?: { before?: string; after?: string }): Promise<void> {
    if (!this.globalRequestAction) return;
    const payload: RequestPayload = {
      accountName,
      requesterId: this.selfId() ?? '',
      before: options?.before,
      after: options?.after,
    };
    this.globalRequestAction.send(payload);
    console.debug('⬆️ [Room] Broadcasted request for @', accountName, 'in global room', 'after:', options?.after);
  }

  private async handleIncomingPost(post: MessageData | string, targetAccount?: string): Promise<void> {
    const accountName = targetAccount ?? this.currentAccount();
    if (!accountName) return;

    // Ensure post is an object (handle potential double-encoded strings)
    let postObj: MessageData;
    if (typeof post === 'string') {
      try {
        postObj = JSON.parse(post);
      } catch {
        console.warn('🟡 [Room] Failed to parse post string:', post);
        return;
      }
    } else {
      postObj = post;
    }

    const isMeta = postObj.uuid === '@settings' || postObj.uuid === '@follow' || postObj.uuid === '@followers';

    if (isMeta && postObj.uuid === '@follow' && !('follows' in postObj)) {
      return;
    }

    // Don't overwrite the signed-in user's own meta posts during sync unless local is missing/invalid
    const signer = this.authService.storedSigner();
    if (isMeta && signer?.account && accountName === signer.account && postObj.senderAccount === accountName) {
      const existing = await this.postService.getPost(accountName, postObj.uuid);
      if (existing) {
        const valid = postObj.uuid === '@settings'
          ? ('settings' in existing && typeof existing.settings === 'object')
          : postObj.uuid === '@follow'
            ? ('follows' in existing && Array.isArray((existing as any).follows) && (existing as any).follows.length > 0)
            : ('followers' in existing && typeof existing.followers === 'object');
        if (valid) return;
      }
    }

    // @followers must only be stored under the account it belongs to (senderAccount)
    if (postObj.uuid === '@followers' && postObj.senderAccount !== accountName) {
      return;
    }

    if (!isMeta) {
      const publicKey = postObj.publicKey;
      if (!publicKey || publicKey.length === 0) {
        console.warn('🟡 [Room] No public key in post from:', postObj.senderAccount);
        return;
      }

      const isValid = await this.postService.verifyPost(postObj);
      if (!isValid) {
        console.warn('🟡 [Room] Invalid post signature from:', postObj.senderAccount);
        return;
      }

      const existing = await this.postService.getPost(accountName, postObj.uuid);
      if (existing) {
        return;
      }
    }

    const db = await this.postService.getDB(accountName);
    // Don't store meta posts from other accounts under our own DB key
    if (isMeta && postObj.senderAccount !== accountName) {
      // Still processed followers logic above, but skip storage
    } else {
      await db.put('posts', JSON.stringify(postObj), postObj.uuid);
      console.debug('⬇️ [Room] Stored verified', isMeta ? 'meta' : 'post', 'from:', postObj.senderAccount, 'for @', accountName);
    }
    // Update follow lastId if this is a regular post (not meta)
    if (!isMeta) {
      try {
        await this.postService.updateFollowLastId(accountName, postObj.senderAccount, postObj.uuid);
      } catch {
        // Ignore - follow lastId update must not block post reload
      }
    }
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
    }
  }

  private async startPolling(accountName: string): Promise<void> {
    this.stopPolling();

    // Poll for @ posts (settings, follow) every 60 seconds and broadcast them
    const metaInterval = setInterval(async () => {
      const meta = await this.postService.getMeta(accountName);
      for (const m of meta) {
        await this.broadcastPost(m as unknown as MessageData);
      }
    }, 60000);
    this.pollingIntervals.push(metaInterval);
  }

private stopPolling(): void {
    for (const interval of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals = [];
  }

  async broadcastPost(post: MessageData): Promise<void> {
    this.postAction.send(post);
    console.debug('⬆️ [Room] Broadcasted post:', post.uuid);
  }

  public async announceGlobalIfSignedIn(peerId?: string): Promise<void> {
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

      // Get own followers data (from local DB)
      let followers: FollowersData | undefined;
      if (signer.account) {
        const f = await this.postService.getFollowers(signer.account);
        followers = f ?? undefined;
      }

      const payload: WhoamiPayload = {
        username: signer.username,
        account: signer.account,
        providerSuffix,
        subscription,
        follow,
        followers,
      };
      this.globalWhoamiAction.send(payload, peerId ? { target: peerId } : undefined);

      // Broadcast request for followed accounts so new peer can sync with us
      if (follow?.follows && follow.follows.length > 0) {
        for (const f of follow.follows) {
          const localPosts = await this.postService.getAllPostsWithFullData(f.accountName);
          const latestUuid = localPosts.length > 0 ? localPosts[0].uuid : undefined;
          await this.requestPosts(f.accountName, { after: latestUuid });
        }
      }
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
      // Add followers data from local DB
      if (signer.account) {
        const followers = await this.postService.getFollowers(signer.account);
        if (followers) (payload as any).followers = followers;
      }
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