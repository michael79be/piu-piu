import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiInput, TuiTextfield } from '@taiga-ui/core';
import { TuiSelect, TuiSwitch, TuiDataListWrapper, TuiChevron } from '@taiga-ui/kit';
import { POLYMORPHEUS_CONTEXT } from '@taiga-ui/polymorpheus';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasBell, lasEnvelope, lasSave, lasSpinner, lasTimes, lasUser, lasGlobe, lasBan } from 'angular-line-awesome/icons';
import { PostService } from '../post/post.service';
import { AuthService } from '../auth/auth.service';
import { ErrorService } from '../error/error.service';
import { RoomService } from '../room/room.service';
import { RsaPublicKeyService } from '../crypto/rsa-public-key.service';
import { VapidPublicKeyService } from '../crypto/vapid-public-key.service';
import { CryptoService } from '../crypto/crypto.service';
import { MessageData } from '../models/post-data';

const SUBSCRIPTION_STORAGE_KEY = '@subscription';

async function saveEncryptedSubscription(cryptoService: CryptoService, rsaPublicKeyService: RsaPublicKeyService, postService: PostService, accountName: string, subscription: PushSubscription | null): Promise<string | null> {
  const key = SUBSCRIPTION_STORAGE_KEY;
  const db = await postService.getDB(accountName);
  if (subscription) {
    const rsaPublicKey = await rsaPublicKeyService.getPublicKey();
    const encrypted = await cryptoService.rsaEncrypt(JSON.stringify(subscription), rsaPublicKey);
    if (encrypted) {
      await db.put('posts', encrypted, key);
      return encrypted;
    }
  } else {
    await db.delete('posts', key);
  }
  return null;
}

async function loadEncryptedSubscription(postService: PostService, accountName: string): Promise<string | null> {
  const key = SUBSCRIPTION_STORAGE_KEY;
  const db = await postService.getDB(accountName);
  const result = await db.get('posts', key);
  return result ?? null;
}

async function clearSubscription(postService: PostService, accountName: string): Promise<void> {
  const key = SUBSCRIPTION_STORAGE_KEY;
  const db = await postService.getDB(accountName);
  await db.delete('posts', key);
}

export type AvatarService = 'gravatar' | 'libravatar' | 'custom' | 'none';

const AVATAR_SERVICE_URLS: Record<Exclude<AvatarService, 'none' | 'custom'>, string> = {
  gravatar: 'https://0.gravatar.com/avatar/',
  libravatar: 'https://seccdn.libravatar.org/avatar/',
};

const AVATAR_SERVICE_LABELS: Record<AvatarService, string> = {
  gravatar: 'Gravatar',
  libravatar: 'Libravatar',
  custom: 'Custom URL',
  none: 'No avatar',
};

const AVATAR_SERVICE_ICONS: Record<AvatarService, string> = {
  gravatar: 'lasGlobe',
  libravatar: 'lasUser',
  custom: 'lasLink',
  none: 'lasBan',
};

@Component({
  selector: 'app-settings-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, TuiButton, TuiInput, TuiTextfield, TuiSelect, TuiSwitch, TuiDataListWrapper, TuiChevron, LaIconComponent],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss'
})
export class SettingsDialogComponent {
  private readonly context = inject(POLYMORPHEUS_CONTEXT);
  private readonly postService = inject(PostService);
  private readonly authService = inject(AuthService);
  private readonly errorService = inject(ErrorService);
  private readonly roomService = inject(RoomService);
  private readonly rsaPublicKeyService = inject(RsaPublicKeyService);
  private readonly vapidPublicKeyService = inject(VapidPublicKeyService);
  private readonly cryptoService = inject(CryptoService);
  private readonly library = inject(LaIconLibrary);

  readonly email = signal<string>('');
  readonly avatarService = signal<AvatarService>('gravatar');
  readonly pushEnabled = signal<boolean>(false);
  readonly loading = signal<boolean>(false);
  readonly pushLoading = signal<boolean>(false);
  readonly currentAvatarUrl = signal<string | null>(null);
  readonly currentAvatarService = signal<AvatarService>('gravatar');
  readonly customAvatarUrl = signal<string>('');

  readonly pushSupported = signal<boolean>(false);
  readonly avatarServiceOptions = ['gravatar', 'libravatar', 'custom', 'none'] as AvatarService[];

  readonly inputIcon = computed(() => {
    const service = this.avatarService() || 'none';
    if (service === 'custom') return 'lasLink';
    if (service === 'none') return 'lasBan';
    return 'lasEnvelope';
  });

  readonly inputLabel = computed(() => {
    const service = this.avatarService() || 'none';
    if (service === 'custom') return 'Custom URL';
    if (service === 'none') return 'No avatar';
    return 'Email';
  });

  readonly inputType = computed(() => {
    const service = this.avatarService() || 'none';
    return service === 'custom' ? 'url' : 'email';
  });

  readonly inputValue = computed(() => {
    const service = this.avatarService() || 'none';
    return service === 'custom' ? this.customAvatarUrl() : this.email();
  });

  readonly inputPlaceholder = computed(() => {
    const service = this.avatarService() || 'none';
    if (service === 'custom') return 'Enter avatar image URL';
    if (service === 'none') return 'No avatar';
    return 'Enter email for avatar';
  });

  readonly previewUrl = computed(() => {
    const email = this.email().trim().toLowerCase();
    const service = this.avatarService() || 'none';
    if (service === 'custom') {
      const customUrl = this.customAvatarUrl().trim();
      return customUrl ? customUrl : null;
    }
    if (service === 'none') return null;
    const encoder = new TextEncoder();
    const hash = Array.from(new Uint8Array(encoder.encode(email)), b => b.toString(16).padStart(2, '0')).join('');
    const baseUrl = AVATAR_SERVICE_URLS[service];
    return baseUrl ? `${baseUrl}${hash}?d=404` : '';
  });

  readonly currentAvatarUrlPreview = computed(() => {
    return this.currentAvatarUrl();
  });

  constructor() {
    this.library.addIcons([lasBell, lasEnvelope, lasSave, lasSpinner, lasTimes, lasUser, lasGlobe, lasBan]);
    this.pushSupported.set('serviceWorker' in navigator && 'PushManager' in window);
    this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    const accountName = this.authService.storedSigner()?.account;
    if (!accountName) return;

    const settings = await this.postService.getSettings(accountName);
    if (settings) {
      this.pushEnabled.set(settings.settings.pushEnabled);
      if (settings.settings.avatarUrl) {
        this.currentAvatarUrl.set(settings.settings.avatarUrl);
        this.currentAvatarService.set(settings.settings.avatarService);
        this.avatarService.set(settings.settings.avatarService);
        if (settings.settings.avatarService === 'custom') {
          this.customAvatarUrl.set(settings.settings.avatarUrl);
        }
      }
      if (settings.settings.avatarService) {
        this.avatarService.set(settings.settings.avatarService);
      }
    }

    // Load push subscription status from IndexedDB
    const subscription = await this.postService.getSubscription(accountName);
    if (subscription) {
      this.pushEnabled.set(true);
    }
  }

  async onPushToggleChange(enabled: boolean): Promise<void> {
    if (!this.pushSupported()) {
      this.errorService.showError('Push notifications not supported');
      this.pushEnabled.set(false);
      return;
    }

    const accountName = this.authService.storedSigner()?.account;
    if (!accountName) {
      this.pushEnabled.set(false);
      return;
    }

    this.pushLoading.set(true);

    try {
      if (enabled) {
        // Subscribe - this will trigger browser permission prompt
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

        await saveEncryptedSubscription(this.cryptoService, this.rsaPublicKeyService, this.postService, accountName, subscription);
        await this.postService.saveSubscription(accountName, subscription);
        this.pushEnabled.set(true);
        this.roomService.updateWhoamiSubscription(encrypted);
        this.errorService.showSuccess('Push notifications enabled');
      } else {
        // Unsubscribe
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        await clearSubscription(this.postService, accountName);
        await this.postService.saveSubscription(accountName, null);
        this.pushEnabled.set(false);
        this.roomService.updateWhoamiSubscription('');
        this.errorService.showSuccess('Push notifications disabled');
      }
    } catch (error) {
      console.error('Push toggle failed:', error);
      this.errorService.showError('Failed to toggle push notifications');
      this.pushEnabled.set(false);
    } finally {
      this.pushLoading.set(false);
    }
  }

  async onSave(): Promise<void> {
    const signer = this.authService.storedSigner();
    if (!signer) return;

    this.loading.set(true);

    const service = this.avatarService() || 'none';
    const email = this.email().trim().toLowerCase();
    let avatarUrl = this.currentAvatarUrl();
    let avatarService = this.currentAvatarService();

    if (service === 'custom') {
      const customUrl = this.customAvatarUrl().trim();
      if (customUrl) {
        avatarUrl = customUrl;
        avatarService = 'custom';
      }
    } else if (email && service !== 'none') {
      const encoder = new TextEncoder();
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(email));
      const bytes = new Uint8Array(hashBuffer);
      const hash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      const baseUrl = AVATAR_SERVICE_URLS[service];
      avatarUrl = baseUrl ? `${baseUrl}${hash}?d=404` : '';
      avatarService = service;
    } else if (service === 'none' || !service) {
      // User explicitly chose no avatar - clear it
      avatarUrl = '';
      avatarService = 'none';
    }
    // If email is empty and service is not 'none', keep existing avatarUrl and avatarService

    const saveAvatarService = (service === 'none' || !service) ? 'gravatar' : (avatarService as 'gravatar' | 'libravatar');
    const settings = await this.postService.saveSettings(signer, avatarUrl ?? '', saveAvatarService, this.pushEnabled());
    this.loading.set(false);

    if (settings) {
      // Broadcast settings to peers
      await this.roomService.broadcastPost(settings as unknown as MessageData);
      this.errorService.showError('Settings saved');
      this.context['completeWith']({ avatarUrl: settings.settings.avatarUrl, avatarService: settings.settings.avatarService, pushEnabled: settings.settings.pushEnabled });
    } else {
      this.errorService.showError('Failed to save settings');
    }
  }

  onCancel(): void {
    this.context['$implicit'].complete();
  }

  onInputChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const service = this.avatarService() || 'none';
    if (service === 'custom') {
      this.customAvatarUrl.set(value);
    } else {
      this.email.set(value);
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