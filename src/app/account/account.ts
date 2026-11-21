import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TuiButton, TuiDropdown, TuiDataList, TuiTextfield, TuiDialogService, TuiHint } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash } from 'angular-line-awesome/icons';
import { ProfileData } from '../profile/profile.service';
import { ErrorService } from '../error/error.service';
import { RoomService } from '../room/room.service';
import { AuthService } from '../auth/auth.service';
import { PostService, PostData } from '../post/post.service';
import { PostDialogComponent } from '../post/post-dialog/post-dialog.component';
import { CryptoService } from '../crypto/crypto.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { VapidPublicKeyService } from '../crypto/vapid-public-key.service';

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
  private postService = inject(PostService);
  private dialogService = inject(TuiDialogService);
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

  private handlePostsUpdated = (event: CustomEvent) => {
    const detail = event.detail;
    if (!detail?.accountName || detail.accountName === this.accountName()) {
      this.loadPosts();
    }
  };

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash]);
  }

  ngOnInit(): void {
    this.profileData.set(this.route.snapshot.data['profileData']);
    const routeAccountName = this.route.snapshot.paramMap.get('accountName');
    const profile = this.profileData();
    this.accountName.set(routeAccountName ?? profile?.accountName ?? profile?.username ?? null);

    if (this.accountName()) {
      this.roomService.joinRoom(this.accountName()!);
    }

    this.loadPosts();

    // Join global room if already signed in (session restore)
    if (this.authService.isSignedIn()) {
      this.roomService.joinGlobalRoom().catch(err => console.error('Failed to join global room:', err));
    }

    const signInParam = this.route.snapshot.queryParamMap.get('signIn');
    if (signInParam === 'true') {
      this.showAccountMenu.set(true);
      this.performSignIn();
    }

    // Listen for P2P post events
    window.addEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);

    // Check push notification support
    this.pushSupported.set('serviceWorker' in navigator && 'PushManager' in window);
    if (this.pushSupported()) {
      this.loadPushSubscription();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
  }

  posts = signal<PostData[]>([]);

  signerMatchesAccount = computed(() => {
    const signer = this.storedSigner();
    const accountName = this.accountName();
    return signer?.account === accountName;
  });

  canPost = computed(() => this.isSignedIn() && this.signerMatchesAccount());

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
    console.log('[Account.loadPosts] accountName:', accountName);
    console.log('[Account.loadPosts] profile:', profile);
    if (!accountName) {
      console.log('[Account.loadPosts] missing accountName');
      this.posts.set([]);
      return;
    }
    const verifiedPosts = await this.postService.getVerifiedPosts(accountName);
    console.log('[Account.loadPosts] verifiedPosts count:', verifiedPosts.length);
    this.posts.set(verifiedPosts);
  }

  onHome(): void {
    this.router.navigateByUrl('/');
  }

  openPostDialog(): void {
    const accountName = this.accountName();
    if (!accountName) return;

    this.dialogService.open<PostData>(new PolymorpheusComponent(PostDialogComponent), {
      size: 'm',
      closable: true,
      dismissible: true,
      data: { accountName },
    }).subscribe(async (post) => {
      if (post) {
        await this.roomService.broadcastPost(post);
        this.loadPosts();
      }
    });
  }

  onAccount(): void {
  }

  signOut(): void {
    const accountName = this.accountName();
    if (accountName) {
      // Clear push subscription
      localStorage.removeItem(`${accountName}-subscription`);
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
        // Also load encrypted version for whoami updates
        const stored = localStorage.getItem(`${accountName}-subscription`);
        if (stored) {
          this.encryptedSubscription = stored;
        }
      } else {
        // No active subscription - check if we have encrypted data
        const stored = localStorage.getItem(`${accountName}-subscription`);
        if (stored) {
          this.encryptedSubscription = stored;
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
      // Re-encrypt and save new subscription
      const rsaPublicKey = await this.rsaPublicKeyService.getPublicKey();
      const newEncrypted = await this.cryptoService.rsaEncrypt(JSON.stringify(subscription), rsaPublicKey);
      if (newEncrypted) {
        localStorage.setItem(`${accountName}-subscription`, newEncrypted);
        this.encryptedSubscription = newEncrypted;
        this.roomService.updateWhoamiSubscription(newEncrypted);
      }
    } catch {
      // Failed to restore, clear invalid data
      localStorage.removeItem(`${accountName}-subscription`);
      this.encryptedSubscription = null;
    }
  }

  private encryptedSubscription: string | null = null;

  async togglePushNotifications(): Promise<void> {
    if (!this.pushSupported()) {
      this.errorService.showError('Push notifications not supported');
      return;
    }

    const accountName = this.accountName();
    if (!accountName) return;

    this.pushLoading.set(true);

    try {
      if (this.pushSubscription()) {
        // Unsubscribe
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        localStorage.removeItem(`${accountName}-subscription`);
        this.pushSubscription.set(null);
        this.encryptedSubscription = null;
        // Update whoami to remove subscription
        this.roomService.updateWhoamiSubscription('');
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

        // Save encrypted subscription to localStorage
        localStorage.setItem(`${accountName}-subscription`, encrypted);
        this.encryptedSubscription = encrypted;
        this.pushSubscription.set(subscription);

        // Update whoami in global room
        this.roomService.updateWhoamiSubscription(encrypted);

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
}