import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiTextfield, TuiInput } from '@taiga-ui/core';
import { TuiCardLarge } from '@taiga-ui/layout';
import { TuiSelect, TuiChevron, TuiDataListWrapper } from '@taiga-ui/kit';
import { Providers, LocalhostProviderUrl, getAvailableProviders, getProviderByUrl, getDefaultProvider, getProviderByPrefix, type Provider } from '../provider/provider.enum';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, TuiButton, TuiCardLarge, TuiTextfield, TuiInput, TuiSelect, TuiChevron, TuiDataListWrapper],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class Home {
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  showSignInInput = signal(false);
  signInInput = signal('');
  isLocalhost = location.hostname === 'localhost';
  availableProviders = computed(() => getAvailableProviders(this.isLocalhost));
  providerUrls = computed(() => this.availableProviders().map(p => p.url));
  selectedProviderUrl = signal<string>(this.isLocalhost ? LocalhostProviderUrl : getDefaultProvider().url);

  constructor() {
    effect(() => {
      const signIn = this.route.snapshot.queryParamMap.get('signIn');
      if (signIn === 'true') {
        this.showSignInInput.set(true);
      }
    });
  }

  onSignIn(): void {
    this.showSignInInput.set(true);
  }

  onConfirmSignIn(): void {
    const input = this.signInInput().trim();
    if (input) {
      this.navigateToAccount(input, this.selectedProviderUrl());
      this.showSignInInput.set(false);
      this.signInInput.set('');
    }
  }

  onRegister(): void {
    this.router.navigate(['/register']);
  }

  private navigateToAccount(input: string, providerUrl: string): void {
    const accountName = this.extractAccountName(input);
    if (accountName) {
      const provider = getProviderByUrl(providerUrl);
      const prefix = provider?.prefix || '';
      const url = prefix ? `/@${accountName}/${prefix}` : `/@${accountName}`;
      this.router.navigateByUrl(`${url}?signIn=true`);
    }
  }

  private extractAccountName(input: string): string | null {
    if (input.startsWith('@')) {
      return input.substring(1);
    }
    if (input.includes('@')) {
      const parts = input.split('@');
      if (parts.length > 1) {
        return parts[1].split('/')[0].split('#')[0];
      }
    }
    return input;
  }

  protected isUrlInput = computed(() => {
    const input = this.signInInput().trim();
    return input.includes('@') || input.startsWith('http');
  });
}