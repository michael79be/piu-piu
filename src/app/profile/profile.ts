import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TuiButton, TuiDropdown, TuiDataList } from '@taiga-ui/core';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser } from 'angular-line-awesome/icons';
import { ProviderTagMap } from '../provider/provider.enum';
import { ProviderService } from '../provider/provider.service';
import { lastValueFrom } from 'rxjs';
import { SESSION_KEY } from '../auth/auth.enum';

type MenuItem = {
  label: string;
  command: () => void;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, TuiButton, TuiDropdown, TuiDataList, LaIconComponent],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class Profile {
  private providerService = inject(ProviderService);
  private library = inject(LaIconLibrary);

  provider = signal<string | undefined>(undefined);
  profileData = signal<any>(null);
  error = signal<string | null>(null);
  accountMenu = computed<MenuItem[]>(() => {
    if (this.isSignedIn()) {
      return [{ label: 'Profile', command: () => { } }, { label: 'Sign out', command: () => this.signOut() }];
    } else {
      return [{ label: 'Sign in', command: () => this.signIn() }];
    }
  });
  accountName = signal<string | null>(null);
  isSignedIn = signal<boolean>(false);
  signedUsername = signal<string>('guest');

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser]);

    this.loadProfileFromHash();

    const storedSigner = sessionStorage.getItem(SESSION_KEY);
    if (storedSigner) {
      const signer = JSON.parse(storedSigner);
      this.checkSigner(signer, '');
    }
  }

  private async loadProfileFromHash() {
    try {
      const hash = location.hash;
      if (!hash || !hash.startsWith('#')) {
        this.error.set('No profile hash found');
        return;
      }

      const accountName = hash.substring(1).split('@')[1] || '';

      const providerEntry = Object.entries(ProviderTagMap).find(([_, tag]) => hash.startsWith(tag));
      const providerUrl = providerEntry ? providerEntry[0] : null;

      if (!providerUrl) {
        this.error.set('Unknown provider prefix in hash');
        return;
      }

      const res: any = await lastValueFrom(this.providerService.lookupShortUrl(providerUrl, accountName));
      if (res?.errorcode) {
        this.error.set('Lookup failed');
        return;
      }
      const encoded = res?.longurl?.split('#')[1];
      if (!encoded) {
        this.error.set('No profile data');
        return;
      }
      const decoded = JSON.parse(atob(encoded));
      console.debug(decoded);
      this.profileData.set(decoded);
      this.accountName.set(accountName);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error loading profile');
    }
  }

  private async checkSigner(signer: any, accountName: string): Promise<boolean> {
    try {
      const data = this.profileData();
      if (!data || !data.publicKey) {
        this.isSignedIn.set(false);
        return false;
      }

      console.debug(data);
      console.debug(signer);

      const accountMatch = signer.account === accountName;

      const hasSignatureAndClientData = signer.clientData.length > 0 && signer.signature.length > 0;

      console.debug({accountMatch, hasSignatureAndClientData});

      const isValid = accountMatch && hasSignatureAndClientData;

      this.isSignedIn.set(isValid);

      return isValid;
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error checking signer');
      return false;
    }
  }

  onHome() {
  }

  onPost() {
  }

  onAccount() {
  }

  /**
   * Sign out - clear the sessionStorage signer and reload profile
   */
  signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    this.profileData.set(null);
    this.isSignedIn.set(false);
    this.signedUsername.set('guest');
  }

  async signIn() {
    const accountName = this.accountName();;
    if (null === accountName) {
      this.error.set('No account name set');
      return;
    }
    const accountNameBytes = new TextEncoder().encode(accountName);
    const challenge = this.padChallenge(accountNameBytes, 32);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as any;
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      const handle = (cred.response as AuthenticatorAssertionResponse).userHandle;
      let username = accountName;
      if (handle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(handle) ?? accountName;
      }

      console.debug(username);

      const signerInfo = {
        username,
        account: accountName,
        publicKey: [],
        clientData: Array.from(clientData),
        signature: Array.from(signature),
        profileUrl: ''
      };

      console.debug(signerInfo);

      if(await this.checkSigner(signerInfo, accountName)) {
        signerInfo.publicKey = this.profileData()?.publicKey;
        const encoded = btoa(JSON.stringify(signerInfo));
        const base = `${location.origin}${location.pathname}#${encoded}`;
        signerInfo.profileUrl = `${base}`;
        console.debug(signerInfo);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(signerInfo));
      } else {
        this.error.set('Checking signature failed');
      }

    } catch (e: any) {
      this.error.set(e?.message ?? 'Sign in failed');
      console.error('WebAuthn sign in error:', e);
    }
  }

  verifySigner(): boolean {
    const storedSigner = sessionStorage.getItem(SESSION_KEY);
    if (!storedSigner) {
      return false;
    }
    const signer = JSON.parse(storedSigner);
    const data = this.profileData();
    if (!data || !data.publicKey) {
      return false;
    }
    return data.publicKey === signer.publicKey;
  }

  private padChallenge(data: Uint8Array, length: number): Uint8Array {
    const result = new Uint8Array(length);
    result.set(data.slice(0, length));
    return result;
  }

  accountHandle() {
    return this.isSignedIn() ? this.signedUsername() : 'guest';
  }
}
