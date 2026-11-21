import { Component, computed, inject, input, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TuiButton, TuiDropdown, TuiDataList, TuiHint, TuiDialogService } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasRss, lasList, lasRss as lasRssIcon } from 'angular-line-awesome/icons';
import { AuthService } from '../auth/auth.service';
import { PostService, PostData } from '../post/post.service';
import { RoomService } from '../room/room.service';
import { ErrorService } from '../error/error.service';
import { CryptoService } from '../crypto/crypto.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { VapidPublicKeyService } from '../crypto/vapid-public-key.service';
import { PostDialogComponent } from '../post/post-dialog/post-dialog.component';

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
  private dialogService = inject(TuiDialogService);
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

  pushSubscription = signal<PushSubscription | null>(null);
  pushSupported = signal(false);
  pushLoading = signal(false);

  constructor() {
    this.library.addIcons([lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock, lasBell, lasBellSlash, lasSpinner, lasUserPlus, lasRss, lasList, lasRssIcon]);
  }

  goHome(): void {
    this.router.navigateByUrl('/');
  }

  onFeed(): void {
    this.router.navigateByUrl('/feed');
  }

  ngOnInit(): void {
    this.pushSupported.set('serviceWorker' in navigator && 'PushManager' in window);
    if (this.pushSupported()) {
      this.loadPushSubscription();
    }
  }

  ngOnDestroy(): void {}

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
    const accountName = this.storedSigner()?.account;
    if (!accountName) return;

    // If on another user's account page, redirect to own account first
    if (!this.signerMatchesAccount()) {
      this.router.navigateByUrl(`/@${accountName}`);
      // Wait for navigation then open dialog
      setTimeout(() => this.openPostDialogInternal(accountName), 0);
      return;
    }

    this.openPostDialogInternal(accountName);
  }

  private openPostDialogInternal(accountName: string): void {
    this.dialogService.open<PostData>(new PolymorpheusComponent(PostDialogComponent), {
      size: 'm',
      closable: true,
      dismissible: true,
      data: { accountName },
    }).subscribe(async (post) => {
      if (post) {
        await this.roomService.broadcastPost(post);
        window.dispatchEvent(new CustomEvent('piu-piu:load-posts', { detail: { accountName } }));
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
      const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
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

    const accountName = this.storedSigner()?.account;
    if (!accountName) return;

    this.pushLoading.set(true);

    try {
      if (this.pushSubscription()) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        await this.postService.saveSubscription(accountName, null);
        this.pushSubscription.set(null);
        this.roomService.updateWhoamiSubscription('');
        this.errorService.showSuccess('Push notifications disabled');
      } else {
        const registration = await navigator.serviceWorker.ready;
        const vapidPublicKey = await this.vapidPublicKeyService.getPublicKey();
        const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource;
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
}