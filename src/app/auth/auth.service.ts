import { Injectable, signal, computed, inject } from '@angular/core';
import { ProfileService } from '../profile/profile.service';
import { PostService } from '../post/post.service';
import { ErrorService } from '../error/error.service';
import { CryptoService } from '../crypto/crypto.service';
import { SESSION_KEY } from '../auth/auth.enum';
import { ProfileData } from '../models/profile-data';
import { SettingsData } from '../models/settings-data';
import { SignerInfo } from '../models/signer-info';
import { getProviderByUrl } from '../provider/provider.enum';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private profileService = inject(ProfileService);
  private postService = inject(PostService);
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

    const profile = this.profileService.getProfileData();
    const providerUrl = profile?.provider ?? '';
    const providerPrefix = getProviderByUrl(providerUrl)?.prefix ?? '';

    const signerInfo: SignerInfo = {
      username,
      account: accountName,
      publicKey: '',
      authenticatorData: result.authenticatorData,
      clientData: result.clientData,
      signature: result.signature,
      providerPrefix,
    };

    if (await this.checkSigner(signerInfo)) {
      signerInfo.publicKey = profile?.publicKey ?? '';
      
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
        signer.authenticatorData,
        signer.clientData,
        signer.signature,
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