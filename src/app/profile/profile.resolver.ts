import { Injectable } from '@angular/core';
import { Resolve, ActivatedRouteSnapshot } from '@angular/router';
import { ProviderService } from '../provider/provider.service';
import { getProviderByPrefix, getDefaultProvider, LocalhostProviderUrl, type Provider } from '../provider/provider.enum';
import { ProfileService } from './profile.service';
import { ErrorService } from '../error/error.service';
import { lastValueFrom } from 'rxjs';

export type ProfileData = {
  username: string;
  publicKey: string;
  provider?: string;
  accountName?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileResolver implements Resolve<ProfileData | null> {
  constructor(
    private providerService: ProviderService,
    private profileService: ProfileService,
    private errorService: ErrorService
  ) {}

  async resolve(route: ActivatedRouteSnapshot): Promise<ProfileData | null> {
    try {
      const accountName = route.paramMap.get('accountName');
      const providerParam = route.paramMap.get('provider');

      if (!accountName) {
        this.errorService.showError('No profile data found');
        return null;
      }

      return await this.loadFromAccountName(accountName, providerParam);
    } catch (e: any) {
      this.errorService.showError(e?.message ?? 'Error loading profile');
      return null;
    }
  }

  private async loadFromAccountName(accountName: string, providerParam: string | null): Promise<ProfileData | null> {
    // Use localhost provider when on localhost to avoid CORS issues
    const isLocalhost = location.hostname === 'localhost';
    const defaultProvider = isLocalhost ? { url: LocalhostProviderUrl, prefix: 'l', label: 'localhost' } : getDefaultProvider();
    const provider: Provider = providerParam ? getProviderByPrefix(providerParam)! : defaultProvider;

    try {
      const res: any = await lastValueFrom(this.providerService.lookupShortUrl(provider.url, accountName));
      if (res?.errorcode) {
        this.errorService.showError('Lookup failed');
        return null;
      }
      const longUrl = res?.longurl || '';
      const encoded = longUrl.split('/profile/')[1];
      if (!encoded) {
        this.errorService.showError('No profile data');
        return null;
      }
      const decoded = JSON.parse(atob(encoded));
      const data = { ...decoded, provider: provider.prefix, accountName };
      this.profileService.setProfileData(data);
      return data;
    } catch (e: any) {
      if (e?.message === 'Profile not found') {
        this.errorService.showError(`Profile "@${accountName}" not found`);
      } else if (e?.message?.includes('CORS blocked')) {
        this.errorService.showError(e.message);
      } else {
        this.errorService.showError(e?.message ?? 'Error loading profile');
      }
      return null;
    }
  }
}