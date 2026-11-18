import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TuiButton, TuiInput, TuiTextfield } from '@taiga-ui/core';
import { TuiCardLarge } from '@taiga-ui/layout';
import { TuiChevron, TuiDataListWrapper, TuiSelect } from '@taiga-ui/kit';
import { ProviderService } from '../provider/provider.service';
import { Providers, LocalhostProviderUrl, getAvailableProviders, getProviderByUrl, getDefaultProvider, type Provider } from '../provider/provider.enum';
import { ErrorService } from '../error/error.service';
import { lastValueFrom } from 'rxjs';
import { rootUrl } from '../utils/url';

@Component({
  selector: 'app-register',
  imports: [FormsModule, TuiButton, TuiCardLarge, TuiInput, TuiTextfield, TuiSelect, TuiChevron, TuiDataListWrapper],
  templateUrl: './register.html',
})
export class Register {
  private providerService = inject(ProviderService);
  private errorService = inject(ErrorService);
  private router = inject(Router);

  username = signal('');
  isLocalhost = location.hostname === 'localhost';
  availableProviders = computed(() => getAvailableProviders(this.isLocalhost));
  providerUrls = computed(() => this.availableProviders().map(p => p.url));
  selectedProviderUrl = signal<string>(this.isLocalhost ? LocalhostProviderUrl : getDefaultProvider().url);
  error = signal<string | null>(null);

  async register(): Promise<void> {
    this.error.set(null);
    const uname = this.username();
    if (!/^[A-Za-z0-9_]{5,30}$/.test(uname)) {
      this.error.set('Username must be 5-30 alphanumeric characters or underscores');
      return;
    }
    try {
      const encoder = new TextEncoder();
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Piu-Piu', id: location.hostname },
          user: {
            id: encoder.encode(this.username()),
            name: this.username(),
            displayName: this.username(),
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: { userVerification: 'preferred' },
          timeout: 60000,
        },
      }) as PublicKeyCredential;

      const pubKey = (cred.response as AuthenticatorAttestationResponse).getPublicKey();
      const providerUrl = this.selectedProviderUrl();
      const provider = getProviderByUrl(providerUrl);
      const providerPrefix = provider?.prefix || '';
      const publicKeyBase64 = pubKey ? btoa(String.fromCharCode(...new Uint8Array(pubKey))) : '';
      const profile = {
        username: this.username(),
        publicKey: publicKeyBase64,
        provider: providerPrefix,
      };
      const encoded = btoa(JSON.stringify(profile));
      const base = `${rootUrl()}profile/${encoded}`;

      const random = Math.random().toString(36).substring(2, 8);
      const customShort = `${this.username()}_${random}`;
      let res: any;
      try {
        res = await lastValueFrom(this.providerService.createShortUrl(providerUrl, base, customShort));
        if (res?.errorcode) {
          throw new Error('custom rejected');
        }
      } catch (_) {
        res = await lastValueFrom(this.providerService.createShortUrl(providerUrl, base));
      }

      this.errorService.showSuccess('Account created successfully');
      const shortUrl = res?.shorturl;
      if (shortUrl) {
        setTimeout(() => {
          let accountName: string | null = null;
          try {
            const url = new URL(shortUrl);
            accountName = url.pathname.split('/').filter(Boolean).pop() || null;
          } catch {
            accountName = shortUrl.split('/').pop() || null;
          }
          if (accountName) {
            const url = providerPrefix ? `/@${accountName}/${providerPrefix}` : `/@${accountName}`;
            this.router.navigateByUrl(`${url}?signIn=true`);
          }
        }, 2000);
      }
    } catch (e: any) {
      this.error.set(e?.message ?? 'Registration failed');
    }
  }
}