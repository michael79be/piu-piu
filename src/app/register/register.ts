import { Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiDropdown, TuiInput, TuiTextfield } from '@taiga-ui/core';

import { TuiCardLarge } from '@taiga-ui/layout';
import { TuiChevron, TuiDataListWrapper, TuiSelect } from '@taiga-ui/kit';
import { ProviderService } from '../provider/provider.service';
import { ProviderTagMap, LocalhostProviderUrl } from '../provider/provider.enum';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-register',
  imports: [FormsModule, TuiButton, TuiCardLarge, TuiTextfield, TuiSelect, TuiChevron, TuiDataListWrapper, TuiDropdown, TuiInput],
  templateUrl: './register.html',
})
export class Register {
  private providerService = inject(ProviderService);

  username = signal('');
  provider = signal(Object.keys(ProviderTagMap)[0]);
  providers = signal<string[]>(Object.keys(ProviderTagMap).filter(url => url !== LocalhostProviderUrl));
  profileUrl = signal<string | null>(null);
  error = signal<string | null>(null);

  constructor() {
    if (location.hostname === 'localhost') {
      this.providers.update(list => [...list, LocalhostProviderUrl]);
    }
  }

  async register() {
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
      const profile = {
        username: this.username(),
        publicKey: pubKey ? Array.from(new Uint8Array(pubKey)) : null,
      };
      const encoded = btoa(JSON.stringify(profile));
      const base = `${location.origin}${location.pathname}#${encoded}`;

      const random = Math.random().toString(36).substring(2, 8);
      const customShort = `${this.username()}_${random}`;
      let res: any;
      try {
        res = await lastValueFrom(this.providerService.createShortUrl(this.provider(), base, customShort));
        if (res?.errorcode) {
          throw new Error('custom rejected');
        }
      } catch (_) {
        res = await lastValueFrom(this.providerService.createShortUrl(this.provider(), base));
      }

      this.profileUrl.set(res?.shorturl);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Registration failed');
    }
  }
}
