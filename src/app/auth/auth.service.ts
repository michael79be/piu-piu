import { Injectable, signal, computed, inject } from '@angular/core';
import { ProfileService, ProfileData } from '../profile/profile.service';
import { ErrorService } from '../error/error.service';
import { CryptoService, WebAuthnSignResult } from '../crypto/crypto.service';
import { SESSION_KEY } from '../auth/auth.enum';

export interface SignerInfo extends ProfileData {
  account: string;
  authenticatorData: number[];
  clientData: number[];
  signature: number[];
  profileUrl: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private profileService = inject(ProfileService);
  private errorService = inject(ErrorService);
  private cryptoService = inject(CryptoService);

  isSignedIn = signal<boolean>(false);
  storedSigner = signal<SignerInfo | null>(null);
  displayName = signal<string>('guest');

  readonly signerMatchesAccount = computed(() => {
    const signer = this.storedSigner();
    const profile = this.profileService.getProfileData();
    const accountName = profile?.accountName ?? profile?.username;
    return signer?.account === accountName;
  });

  constructor() {
    this.restoreSession();
  }

  private restoreSession(): void {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const signer = JSON.parse(stored) as SignerInfo;
        this.storedSigner.set(signer);
        this.isSignedIn.set(true);
        this.displayName.set(signer.username);
      } catch {
        this.clearSession();
      }
    }
  }

  async signIn(accountName: string): Promise<boolean> {
    if (!accountName) {
      this.errorService.showError('No account name set');
      return false;
    }

    const result = await this.cryptoService.webAuthnSign(accountName);
    if (!result) {
      this.errorService.showError('Sign in failed');
      return false;
    }

    const username = result.username ?? accountName;

    const signerInfo: SignerInfo = {
      username,
      account: accountName,
      publicKey: Array.from([]),
      authenticatorData: Array.from(result.authenticatorData),
      clientData: Array.from(result.clientData),
      signature: Array.from(result.signature),
      profileUrl: ''
    };

    if (await this.checkSigner(signerInfo)) {
      const profile = this.profileService.getProfileData();
      signerInfo.publicKey = profile?.publicKey ?? [];
      const encoded = btoa(JSON.stringify(signerInfo));
      const base = `${location.origin}${location.pathname}#${encoded}`;
      signerInfo.profileUrl = base;
      
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(signerInfo));
      this.storedSigner.set(signerInfo);
      this.isSignedIn.set(true);
      this.displayName.set(signerInfo.username);
      this.errorService.showSuccess('Signed in successfully');
      return true;
    } else {
      this.errorService.showError('Checking signature failed');
      return false;
    }
  }

  signOut(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.isSignedIn.set(false);
    this.storedSigner.set(null);
    this.displayName.set('guest');
  }

  private async checkSigner(signer: SignerInfo): Promise<boolean> {
    try {
      const data = this.profileService.getProfileData();
      if (!data || !data.publicKey) {
        this.isSignedIn.set(false);
        return false;
      }

      const hasSignatureAndClientData = signer.clientData.length > 0 && signer.signature.length > 0;
      const signatureValid = await this.cryptoService.verifyWebAuthnSignature(
        new Uint8Array(signer.authenticatorData),
        new Uint8Array(signer.clientData),
        new Uint8Array(signer.signature),
        data.publicKey
      );

      console.debug({ hasSignatureAndClientData, signatureValid });

      const isValid = hasSignatureAndClientData && signatureValid;
      this.isSignedIn.set(isValid);

      return isValid;
    } catch (e: any) {
      this.errorService.showError(e?.message ?? 'Error checking signer');
      return false;
    }
  }

  private clearSession(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.isSignedIn.set(false);
    this.storedSigner.set(null);
    this.displayName.set('guest');
  }
}