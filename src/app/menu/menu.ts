import { Component, computed, inject, input, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TuiButton, TuiDropdown, TuiDataList, TuiHint } from '@taiga-ui/core';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasRss, lasList, lasCog, lasRss as lasRssIcon } from 'angular-line-awesome/icons';
import { AuthService } from '../auth/auth.service';
import { PostService } from '../post/post.service';
import { MessageData } from '../models/post-data';
import { RoomService } from '../room/room.service';
import { ErrorService } from '../error/error.service';
import { CryptoService } from '../crypto/crypto.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { VapidPublicKeyService } from '../crypto/vapid-public-key.service';
import { SignerInfo } from '../models/signer-info';
import { PostDialogService } from '../post/post-dialog/post-dialog.service';
import { SettingsDialogService } from '../settings/settings-dialog.service';

type MenuItem = {
  label: string;
  command: () => void;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule, TuiButton, TuiHint, TuiDropdown, TuiDataList, LaIconComponent],
  templateUrl: './menu.html',
  styleUrl: './menu.scss'
})
export class Menu implements OnInit, OnDestroy {
  private router = inject(Router);
  private postDialogService = inject(PostDialogService);
  private settingsDialogService = inject(SettingsDialogService);
  private authService = inject(AuthService);
  private postService = inject(PostService);
  private roomService = inject(RoomService);
  private errorService = inject(ErrorService);
  private cryptoService = inject(CryptoService);
  private rsaPublicKeyService = inject(RsaPublicKeyService);
  private vapidPublicKeyService = inject(VapidPublicKeyService);
  private library = inject(LaIconLibrary);

  canPost = input<boolean>(false);
  signerMatchesAccount = input<boolean>(false);

  showAccountMenu = signal(false);

isSignedIn = this.authService.isSignedIn;
  storedSigner = this.authService.storedSigner;
  displayName = this.authService.displayName;
  accountName = computed(() => this.storedSigner()?.account ?? '');
  accountDisplay = computed(() => this.isSignedIn() ? `@${this.accountName()}` : 'guest');

  currentRoute = signal<string>('/');
  private route = inject(ActivatedRoute);

  pushSubscription = signal<PushSubscription | null>(null);
  pushSupported = signal(false);
  pushLoading = signal(false);

  avatarUrl = signal<string | null>(null);

  constructor() {
    this.library.addIcons([lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasRss, lasList, lasCog, lasRssIcon]);
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => {
      this.currentRoute.set(this.router.url);
    });
  }

  goHome(): void {
    const accountName = this.storedSigner()?.account;
    if (accountName && this.isSignedIn()) {
      this.router.navigateByUrl(`/@${accountName}`);
    } else {
      this.router.navigateByUrl('/feed');
    }
  }

  onFeed(): void {
    this.router.navigateByUrl('/feed');
  }

  ngOnInit(): void {
    this.pushSupported.set('serviceWorker' in navigator && 'PushManager' in window);
    if (this.pushSupported()) {
      this.loadPushSubscription();
    }
    this.loadAvatar();
  }

  ngOnDestroy(): void {}

  private async loadAvatar(): Promise<void> {
    const accountName = this.storedSigner()?.account;
    if (!accountName) return;

    const settings = await this.postService.getSettings(accountName);
    if (settings?.settings.avatarUrl) {
      this.avatarUrl.set(settings.settings.avatarUrl);
    }
  }

  accountMenu = computed<MenuItem[]>(() => {
    if (this.isSignedIn()) {
      const accountName = this.storedSigner()?.account;
      const items: MenuItem[] = [
        { label: 'Profile', command: () => accountName && this.router.navigateByUrl(`/@${accountName}`) },
        { label: 'Settings', command: () => this.openSettingsDialog() },
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
    const accountName = this.storedSigner()?.account;
    if (!accountName) {
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

  async openPostDialog(): Promise<void> {
    await this.postDialogService.open(this.signerMatchesAccount());
  }

  openSettingsDialog(): void {
    this.settingsDialogService.open().then(async (result) => {
      if (result) {
        // Reload avatar and push status after dialog closes
        this.loadAvatar();
        const accountName = this.storedSigner()?.account;
        if (accountName) {
          const settings = await this.postService.getSettings(accountName);
          if (settings) {
            const subscription = await this.postService.getSubscription(accountName);
            this.pushSubscription.set(settings.settings.pushEnabled && subscription ? subscription : null);
          }
        }
      }
    });
  }

  signOut(): void {
    const accountName = this.storedSigner()?.account;
    if (accountName) {
      this.postService.saveSubscription(accountName, null);
      this.pushSubscription.set(null);
      this.roomService.updateWhoamiSubscription('');
    }
    this.authService.signOut();
    this.roomService.leaveRoom();
    this.roomService.leaveGlobalRoom();
    this.router.navigateByUrl('/');
  }

  private async loadPushSubscription(): Promise<void> {
    const accountName = this.storedSigner()?.account;
    if (!accountName) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        this.pushSubscription.set(subscription);
        const storedSub = await this.postService.getSubscription(accountName);
        if (storedSub) {
          this.pushSubscription.set(storedSub);
        }
      } else {
        const storedSub = await this.postService.getSubscription(accountName);
        if (storedSub) {
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
      const applicationServerKey = this.b64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
      const registration = await navigator.serviceWorker.ready;
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      
      this.pushSubscription.set(subscription);
      const rsaPublicKey = await this.rsaPublicKeyService.getPublicKey();
      const newEncrypted = await this.cryptoService.rsaEncrypt(JSON.stringify(subscription), rsaPublicKey);
      if (newEncrypted) {
        await this.postService.saveSubscription(accountName, subscription);
        this.roomService.updateWhoamiSubscription(newEncrypted);
      }
    } catch {
      await this.postService.saveSubscription(accountName, null);
    }
  }

  async togglePushNotifications(): Promise<void> {
    if (!this.pushSupported()) {
      this.errorService.showError('Push notifications not supported');
      return;
    }

    const signer = this.storedSigner();
    const accountName = signer?.account;
    if (!signer || !accountName) return;

    this.pushLoading.set(true);

    try {
      // Load current settings to preserve avatar
      const currentSettings = await this.postService.getSettings(accountName);
      const avatarUrl = currentSettings?.settings.avatarUrl ?? '';
      const avatarService = currentSettings?.settings.avatarService ?? 'gravatar';

      if (this.pushSubscription()) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        await this.postService.saveSubscription(accountName, null);
        this.pushSubscription.set(null);
        this.roomService.updateWhoamiSubscription('');
        // Update @settings with pushEnabled: false and broadcast
        const settingsOff = await this.postService.saveSettings(signer, avatarUrl, avatarService, false);
        if (settingsOff) await this.roomService.broadcastPost(settingsOff as unknown as MessageData);
        this.errorService.showSuccess('Push notifications disabled');
      } else {
        const registration = await navigator.serviceWorker.ready;
        const vapidPublicKey = await this.vapidPublicKeyService.getPublicKey();
        const applicationServerKey = this.b64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        const rsaPublicKey = await this.rsaPublicKeyService.getPublicKey();
        const subscriptionJson = JSON.stringify(subscription);
        const encrypted = await this.cryptoService.rsaEncrypt(subscriptionJson, rsaPublicKey);
        if (!encrypted) {
          throw new Error('Failed to encrypt subscription');
        }

        await this.postService.saveSubscription(accountName, subscription);
        this.pushSubscription.set(subscription);
        this.roomService.updateWhoamiSubscription(encrypted);

        // Update @settings with pushEnabled: true and broadcast
        const settingsOn = await this.postService.saveSettings(signer, avatarUrl, avatarService, true);
        if (settingsOn) await this.roomService.broadcastPost(settingsOn as unknown as MessageData);

        this.errorService.showSuccess('Push notifications enabled');
      }
    } catch (error: unknown) {
      console.error('Push toggle failed:', error);
      this.errorService.showError('Failed to toggle push notifications');
    } finally {
      this.pushLoading.set(false);
    }
  }

  private b64ToUint8Array(b64: string): Uint8Array {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const b = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) {
      out[i] = raw.charCodeAt(i);
    }
    return out;
  }
}