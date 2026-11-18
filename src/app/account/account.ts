import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TuiButton, TuiDropdown, TuiDataList } from '@taiga-ui/core';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser } from 'angular-line-awesome/icons';
import { ProfileService, ProfileData } from '../profile/profile.service';
import { ErrorService } from '../error/error.service';
import { SESSION_KEY } from '../auth/auth.enum';

type MenuItem = {
  label: string;
  command: () => void;
}

type SignerInfo = ProfileData & {
  account: string;
  authenticatorData: number[];
  clientData: number[];
  signature: number[];
  profileUrl: string;
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, TuiButton, TuiDropdown, TuiDataList, LaIconComponent],
  templateUrl: './account.html',
  styleUrl: './account.scss'
})
export class Account implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private profileService = inject(ProfileService);
  private errorService = inject(ErrorService);
  private library = inject(LaIconLibrary);

  profileData = signal<ProfileData | null>(null);
  accountName = signal<string | null>(null);
  isSignedIn = signal<boolean>(false);
  signedUsername = signal<string>('guest');
  storedSigner = signal<SignerInfo | null>(null);
  showAccountMenu = signal(false);

  accountMenu = computed<MenuItem[]>(() => {
    if (this.isSignedIn()) {
      return [
        { label: 'Profile', command: () => { } },
        { label: 'Sign out', command: () => this.signOut() }
      ];
    } else {
      return [{ label: 'Sign in', command: () => this.signIn() }];
    }
  });

  canPost = computed(() => {
    if (!this.isSignedIn()) return false;
    const signer = this.storedSigner();
    const accountName = this.accountName();
    return signer?.account === accountName;
  });

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser]);
  }

  ngOnInit(): void {
    this.profileData.set(this.route.snapshot.data['profileData']);
    const routeAccountName = this.route.snapshot.paramMap.get('accountName');
    const profile = this.profileData();
    this.accountName.set(routeAccountName ?? profile?.accountName ?? profile?.username ?? null);

    // Trigger signIn AND open account menu if coming from Sign in button
    const signInParam = this.route.snapshot.queryParamMap.get('signIn');
    if (signInParam === 'true') {
      this.showAccountMenu.set(true);
      this.signIn();
    }

    const storedSigner = sessionStorage.getItem(SESSION_KEY);
    if (storedSigner) {
      const signer = JSON.parse(storedSigner) as SignerInfo;
      this.storedSigner.set(signer);
      this.checkSigner(signer, signer.account);
    }
  }

  onHome(): void {
  }

  onPost(): void {
  }

  onAccount(): void {
  }

  signOut(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.isSignedIn.set(false);
    this.signedUsername.set('guest');
    this.storedSigner.set(null);
  }

  async signIn(): Promise<void> {
    const accountName = this.accountName();
    if (null === accountName) {
      this.errorService.showError('No account name set');
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

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      let username = accountName;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle) ?? accountName;
      }

      const signerInfo = {
        username,
        account: accountName,
        publicKey: Array.from([]),
        authenticatorData: Array.from(authData),
        clientData: Array.from(clientData),
        signature: Array.from(signature),
        profileUrl: ''
      } as SignerInfo;

      if (await this.checkSigner(signerInfo, accountName)) {
        signerInfo.publicKey = this.profileData()?.publicKey ?? [];
        const encoded = btoa(JSON.stringify(signerInfo));
        const base = `${location.origin}${location.pathname}#${encoded}`;
        signerInfo.profileUrl = base;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(signerInfo));
        this.storedSigner.set(signerInfo);
        this.errorService.showSuccess('Signed in successfully');
      } else {
        this.errorService.showError('Checking signature failed');
      }
      // Remove signIn queryParam on both success and failure
      this.router.navigate([], { queryParams: { signIn: null }, queryParamsHandling: 'merge', replaceUrl: true });

    } catch (e: any) {
      this.errorService.showError(e?.message ?? 'Sign in failed');
      console.error('WebAuthn sign in error:', e);
      // Remove signIn queryParam on error
      this.router.navigate([], { queryParams: { signIn: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  private async checkSigner(signer: SignerInfo, accountName: string): Promise<boolean> {
    try {
      const data = this.profileData();
      if (!data || !data.publicKey) {
        this.isSignedIn.set(false);
        return false;
      }

      const accountMatch = signer.account === accountName;
      const hasSignatureAndClientData = signer.clientData.length > 0 && signer.signature.length > 0;
      const signatureValid = await this.verifyWebAuthnSignature(signer);

      console.debug({ accountMatch, hasSignatureAndClientData, signatureValid });

      const isValid = accountMatch && hasSignatureAndClientData && signatureValid;

      this.isSignedIn.set(isValid);

      return isValid;
    } catch (e: any) {
      this.errorService.showError(e?.message ?? 'Error checking signer');
      return false;
    }
  }

  private async verifyWebAuthnSignature(signer: SignerInfo): Promise<boolean> {
    try {
      const data = this.profileData();
      if (!data || !data.publicKey) {
        this.isSignedIn.set(false);
        return false;
      }

      const publicKeyBytes = new Uint8Array(data.publicKey);
      const keyFormat = publicKeyBytes.length === 65 ? 'raw' : 'spki';

      const cryptoKey = await window.crypto.subtle.importKey(
        keyFormat,
        publicKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );

      const clientDataBytes = new Uint8Array(signer.clientData);
      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientDataBytes)
      );

      const authDataBytes = new Uint8Array(signer.authenticatorData);
      const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
      signedData.set(authDataBytes, 0);
      signedData.set(clientDataHash, authDataBytes.length);

      const rawSignature = this.derToRawSignature(new Uint8Array(signer.signature));

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature as BufferSource,
        signedData
      );
    } catch (e) {
      console.error('WebAuthn signature verification failed:', e);
      return false;
    }
  }

  private derToRawSignature(der: Uint8Array): Uint8Array {
    let offset = 2;
    if (der[1] & 0x80) offset += der[1] & 0x7f;

    const rLen = der[offset + 1];
    const rBytes = der.slice(offset + 2, offset + 2 + rLen);
    offset += 2 + rLen;

    const sLen = der[offset + 1];
    const sBytes = der.slice(offset + 2, offset + 2 + sLen);

    const raw = new Uint8Array(64);
    raw.set(rBytes.slice(-32), 32 - Math.min(32, rBytes.length));
    raw.set(sBytes.slice(-32), 64 - Math.min(32, sBytes.length));

    return raw;
  }

  private padChallenge(data: Uint8Array, length: number): Uint8Array {
    const result = new Uint8Array(length);
    result.set(data.slice(0, length));
    return result;
  }
}