import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TuiButton } from '@taiga-ui/core';
import { Router } from '@angular/router';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser } from 'angular-line-awesome/icons';
import { ProviderTagMap } from '../provider/provider.enum';
import { ProviderService } from '../provider/provider.service';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, TuiButton, LaIconComponent],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class Profile {
  private providerService = inject(ProviderService);
  private router = inject(Router);
  private library = inject(LaIconLibrary);
  provider = signal<string | undefined>(undefined);
  profileData = signal<any>(null);
  error = signal<string | null>(null);

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser]);
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

  onHome() {
  }

  onPost() {
  }

  onAccount() {
  }

  accountHandle() {
    return this.profileData()?.username ?? 'user';
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
