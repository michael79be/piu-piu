import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TuiButton, TuiDropdown, TuiDataList, TuiTextfield, TuiHint } from '@taiga-ui/core';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasCheck } from 'angular-line-awesome/icons';
import { ProfileData } from '../profile/profile.resolver';
import { ProfileService } from '../profile/profile.service';
import { ErrorService } from '../error/error.service';
import { RoomService } from '../room/room.service';
import { AuthService } from '../auth/auth.service';
import { PostService } from '../post/post.service';
import { MessageData } from '../models/post-data';
import { CryptoService } from '../crypto/crypto.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { VapidPublicKeyService } from '../crypto/vapid-public-key.service';
import { PostDialogService } from '../post/post-dialog/post-dialog.service';

type MenuItem = {
  label: string;
  command: () => void;
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, TuiButton, TuiHint, TuiDropdown, TuiDataList, TuiTextfield, LaIconComponent],
  templateUrl: './account.html',
  styleUrl: './account.scss'
})
export class Account implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private errorService = inject(ErrorService);
  private roomService = inject(RoomService);
  private authService = inject(AuthService);
  private profileService = inject(ProfileService);
  private postService = inject(PostService);
  private postDialogService = inject(PostDialogService);
  private cryptoService = inject(CryptoService);
  private rsaPublicKeyService = inject(RsaPublicKeyService);
  private vapidPublicKeyService = inject(VapidPublicKeyService);
  private library = inject(LaIconLibrary);

  profileData = signal<ProfileData | null>(null);
  accountName = signal<string | null>(null);
  showAccountMenu = signal(false);

  peers = this.roomService.peers;
  isConnected = this.roomService.isConnected;
  peerCount = this.roomService.peerCount;
  selfId = this.roomService.selfId;

  isSignedIn = this.authService.isSignedIn;
  storedSigner = this.authService.storedSigner;
  displayName = this.authService.displayName;

  pushSubscription = signal<PushSubscription | null>(null);
  pushSupported = signal(false);
  pushLoading = signal(false);

  avatarUrl = signal<string | null>(null);

  private handlePostsUpdated = (event: CustomEvent) => {
    const detail = event.detail;
    if (!detail?.accountName || detail.accountName === this.accountName()) {
      this.loadPosts();
    }
  };

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasCheck]);
  }

  private updateTitle(accountName: string | null): void {
    if (accountName) {
      document.title = `Piu-Piu :: @${accountName}`;
    } else {
      document.title = 'Piu-Piu';
    }
  }

  private async loadAvatar(): Promise<void> {
    const accountName = this.accountName();
    if (!accountName) return;

    // First check global peers for this account's avatar (from @settings in whoami)
    const peer = this.roomService.globalPeers().find(p => p.signerInfo?.account === accountName);
    if (peer?.signerInfo?.avatarUrl) {
      this.avatarUrl.set(peer.signerInfo.avatarUrl);
      return;
    }

    // Fallback to @settings (for own account)
    const settings = await this.postService.getSettings(accountName);
    if (settings?.settings.avatarUrl) {
      this.avatarUrl.set(settings.settings.avatarUrl);
    }
  }

  ngOnInit(): void {
    this.loadAccountFromRoute();

    // Subscribe to route param changes for navigation between account pages
    this.route.paramMap.pipe(filter(() => true)).subscribe(() => {
      this.loadAccountFromRoute();
    });

    // Join global room if already signed in (session restore)
    if (this.authService.isSignedIn()) {
      this.roomService.joinGlobalRoom().catch(err => console.error('Failed to join global room:', err));
    }

    // Listen for P2P post events
    window.addEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);

    // Check push notification support
    this.pushSupported.set('serviceWorker' in navigator && 'PushManager' in window);
    if (this.pushSupported()) {
      this.loadPushSubscription();
    }
  }

  private loadAccountFromRoute(): void {
    const routeAccountName = this.route.snapshot.paramMap.get('accountName');
    const providerParam = this.route.snapshot.paramMap.get('provider');
    
    // Get resolved profile data from route resolver
    const resolvedProfile = this.route.snapshot.data['profileData'] as ProfileData | undefined;
    if (resolvedProfile) {
      this.profileService.setProfileData(resolvedProfile);
      this.profileData.set(resolvedProfile);
    }
    const profile = this.profileData();
    
    // Construct full account name with provider suffix
    let accountName = routeAccountName ?? profile?.accountName ?? profile?.username ?? null;
    if (accountName && providerParam) {
      accountName = `${accountName}/${providerParam}`;
    }
    this.accountName.set(accountName);
    this.updateTitle(accountName);

    if (this.accountName()) {
      this.roomService.joinRoom(this.accountName()!).catch(err => console.error('Failed to join room:', err));
    }

    this.loadPosts();
    this.loadFollowStatus();
    this.loadAvatar();

    const signInParam = this.route.snapshot.queryParamMap.get('signIn');
    if (signInParam === 'true') {
      this.showAccountMenu.set(true);
      this.performSignIn();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
    this.updateTitle(null);
  }

  posts = signal<MessageData[]>([]);
  gravatarCache = new Map<string, string>();

  signerMatchesAccount = computed(() => {
    const signer = this.storedSigner();
    const accountName = this.accountName();
    return signer?.account === accountName;
  });

  canPost = computed(() => this.isSignedIn() && this.signerMatchesAccount());

  isFollowing = signal(false);
  followLoading = signal(false);

  accountMenu = computed<MenuItem[]>(() => {
    if (this.isSignedIn()) {
      const items: MenuItem[] = [
        { label: 'Profile', command: () => { } },
      ];

      if (this.pushSupported()) {
        items.push({
          label: this.pushSubscription() ? 'Disable Push Notifications' : 'Enable Push Notifications',
          command: () => this.togglePushNotifications()
        });
      }

      items.push({ label: 'Sign out', command: () => this.signOut() });
      return items;
    } else {
      return [
        { label: 'Sign in', command: () => this.signIn() },
        { label: 'Register', command: () => this.router.navigate(['/register']) }
      ];
    }
  });

  private async performSignIn(): Promise<void> {
    const accountName = this.accountName();
    if (null === accountName) {
      this.errorService.showError('No account name set');
      return;
    }
    const success = await this.authService.signIn(accountName);
    if (success) {
      this.roomService.joinGlobalRoom().catch(err => console.error('Failed to join global room:', err));
    }
    this.router.navigate([], { queryParams: { signIn: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async signIn(): Promise<void> {
    this.router.navigate(['/'], { queryParams: { signIn: true }, queryParamsHandling: 'merge' });
  }

  async loadPosts(): Promise<void> {
    const accountName = this.accountName();
    const profile = this.profileData();
    if (!accountName) {
      this.posts.set([]);
      return;
    }
    const verifiedPosts = await this.postService.getVerifiedPosts(accountName);
    this.posts.set(verifiedPosts);

    // Preload gravatar URLs for all unique sender accounts
    const uniqueAccounts = [...new Set(verifiedPosts.map(p => (p as MessageData).senderAccount))];
    for (const account of uniqueAccounts) {
      const settings = await this.postService.getSettings(account);
      if (settings?.settings.avatarUrl) {
        this.gravatarCache.set(account, settings.settings.avatarUrl);
      } else {
        this.gravatarCache.set(account, '');
      }
    }
  }

  private async loadFollowStatus(): Promise<void> {
    const viewerAccount = this.storedSigner()?.account;
    const viewerPublicKey = this.storedSigner()?.publicKey;
    const targetAccount = this.accountName();
    if (!viewerAccount || !targetAccount || viewerAccount === targetAccount || !viewerPublicKey) {
      this.isFollowing.set(false);
      return;
    }
    try {
      const following = await this.postService.isFollowing(viewerAccount, targetAccount, viewerPublicKey);
      this.isFollowing.set(following);
    } catch (e) {
      console.error('Failed to load follow status:', e);
      this.isFollowing.set(false);
    }
  }

  async toggleFollow(): Promise<void> {
    const signer = this.authService.storedSigner();
    const targetAccount = this.accountName();
    const targetProfile = this.profileData();
    if (!signer || !targetAccount || signer.account === targetAccount) return;
    if (!targetProfile?.profileUrl) {
      this.errorService.showError('Cannot follow: profile URL not available');
      return;
    }

    this.followLoading.set(true);
    try {
      if (this.isFollowing()) {
        const result = await this.postService.unfollow(signer, targetAccount);
        if (result) {
          this.isFollowing.set(false);
          this.errorService.showSuccess(`Unfollowed @${targetAccount}`);
        } else {
          this.errorService.showError('Failed to unfollow');
        }
      } else {
        const result = await this.postService.saveFollow(signer, targetAccount, targetProfile.profileUrl);
        if (result) {
          this.isFollowing.set(true);
          this.errorService.showSuccess(`You are now following @${targetAccount}`);
        } else {
          this.errorService.showError('Failed to follow');
        }
      }
    } catch (e) {
      console.error('Follow toggle failed:', e);
      this.errorService.showError('Failed to toggle follow');
    } finally {
      this.followLoading.set(false);
    }
  }

  onHome(): void {
    this.router.navigateByUrl('/feed');
  }

  openPostDialog(): void {
    const accountName = this.accountName();
    if (!accountName) return;

    this.postDialogService.open(this.signerMatchesAccount());
  }

  onAccount(): void {
  }

  signOut(): void {
    const accountName = this.accountName();
    if (accountName) {
      // Clear push subscription from IndexedDB
      this.postService.saveSubscription(accountName, null);
      this.pushSubscription.set(null);
      // Update whoami to remove subscription
      this.roomService.updateWhoamiSubscription('');
    }
    this.authService.signOut();
    this.roomService.leaveRoom();
    this.roomService.leaveGlobalRoom();
  }

  private async loadPushSubscription(): Promise<void> {
    const accountName = this.accountName();
    if (!accountName) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        // Active subscription exists in browser
        this.pushSubscription.set(subscription);
        // Also load encrypted version for whoami updates from IndexedDB
        const storedSub = await this.postService.getSubscription(accountName);
        if (storedSub) {
          this.pushSubscription.set(storedSub);
        }
      } else {
        // No active subscription - check if we have encrypted data in IndexedDB
        const storedSub = await this.postService.getSubscription(accountName);
        if (storedSub) {
          // Re-subscribe to restore the subscription (browser returns existing if valid)
          await this.resubscribe(accountName);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  private async resubscribe(accountName: string): Promise<void> {
    try {
      const vapidPublicKey = await this.vapidPublicKeyService.getPublicKey();
      const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
      const registration = await navigator.serviceWorker.ready;
      
      // Browser will return existing subscription if still valid (same endpoint, same VAPID key)
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      
      this.pushSubscription.set(subscription);
      // Re-encrypt and save new subscription to IndexedDB
      const rsaPublicKey = await this.rsaPublicKeyService.getPublicKey();
      const newEncrypted = await this.cryptoService.rsaEncrypt(JSON.stringify(subscription), rsaPublicKey);
      if (newEncrypted) {
        await this.postService.saveSubscription(accountName, subscription);
        this.roomService.updateWhoamiSubscription(newEncrypted);
      }
    } catch {
      // Failed to restore, clear invalid data
      await this.postService.saveSubscription(accountName, null);
    }
  }

  // private encryptedSubscription: string | null = null;

  async togglePushNotifications(): Promise<void> {
    if (!this.pushSupported()) {
      this.errorService.showError('Push notifications not supported');
      return;
    }

    const signer = this.authService.storedSigner();
    const accountName = signer?.account;
    if (!signer || !accountName) return;

    this.pushLoading.set(true);

    try {
      // Load current settings to preserve avatar
      const currentSettings = await this.postService.getSettings(accountName);
      const avatarUrl = currentSettings?.settings.avatarUrl ?? '';
      const avatarService = (currentSettings?.settings.avatarService ?? 'gravatar') as 'gravatar' | 'libravatar' | 'custom' | 'none';

      if (this.pushSubscription()) {
        // Unsubscribe
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        await this.postService.saveSubscription(accountName, null);
        this.pushSubscription.set(null);
        // Update whoami to remove subscription
        this.roomService.updateWhoamiSubscription('');
        // Update @settings with pushEnabled: false and broadcast
        const settingsOff = await this.postService.saveSettings(signer, avatarUrl, avatarService, false);
        if (settingsOff) await this.roomService.broadcastPost(settingsOff as unknown as MessageData);
        this.errorService.showSuccess('Push notifications disabled');
      } else {
        // Subscribe
        const registration = await navigator.serviceWorker.ready;
        const vapidPublicKey = await this.vapidPublicKeyService.getPublicKey();
        const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        // Fetch RSA public key and encrypt subscription
        const rsaPublicKey = await this.rsaPublicKeyService.getPublicKey();
        const subscriptionJson = JSON.stringify(subscription);
        const encrypted = await this.cryptoService.rsaEncrypt(subscriptionJson, rsaPublicKey);
        if (!encrypted) {
          throw new Error('Failed to encrypt subscription');
        }

        // Save subscription to IndexedDB
        await this.postService.saveSubscription(accountName, subscription);
        this.pushSubscription.set(subscription);

        // Update whoami in global room
        this.roomService.updateWhoamiSubscription(encrypted);

        // Update @settings with pushEnabled: true and broadcast
        const settingsOn = await this.postService.saveSettings(signer, avatarUrl, avatarService, true);
        if (settingsOn) await this.roomService.broadcastPost(settingsOn as unknown as MessageData);

        this.errorService.showSuccess('Push notifications enabled');
      }
    } catch (error) {
      console.error('Push toggle failed:', error);
      this.errorService.showError('Failed to toggle push notifications');
    } finally {
      this.pushLoading.set(false);
    }
  }

  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  }

  getGravatarUrl(senderAccount: string): string {
    return this.gravatarCache.get(senderAccount) ?? '';
  }

  getMessageData(post: MessageData): MessageData {
    return post;
  }
}