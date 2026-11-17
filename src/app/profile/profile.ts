import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProviderTagMap } from '../provider/provider.enum';
import { ProviderService } from '../provider/provider.service';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile.html',
})
export class Profile {
  private providerService = inject(ProviderService);
  provider = signal<string | undefined>(undefined);
  profileData = signal<any>(null);
  error = signal<string | null>(null);

  constructor() {
    const hash = location.hash;
    const match = hash.match(/^(#v@|#l@|#@)([^&]*)/);
    if (!match) {
      this.error.set('Invalid profile URL');
      return;
    }
    const tag = match[1];
    const code = match[2];
    const providerUrl = Object.entries(ProviderTagMap).find(([, value]) => value === tag)?.[0] ?? 'https://is.gd';
    this.provider.set(providerUrl);
    const shortUrl = `${this.provider()}/${code}`;
    this.loadProfile(shortUrl);
  }

  async loadProfile(shortUrl: string) {
    try {
      const res: any = await lastValueFrom(this.providerService.lookupShortUrl(this.provider()!, shortUrl));
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
      this.profileData.set(decoded);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Error loading profile');
    }
  }
}
