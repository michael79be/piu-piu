import { Injectable, signal } from '@angular/core';

export type ProfileData = {
  username: string;
  publicKey: string; // base64
  provider?: string;
  accountName?: string;
  profileUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private profileData = signal<ProfileData | null>(null);

  getProfileData(): ProfileData | null {
    return this.profileData();
  }

  setProfileData(data: ProfileData): void {
    this.profileData.set(data);
  }

  clearProfileData(): void {
    this.profileData.set(null);
  }

  hasProfileData(): boolean {
    return this.profileData() !== null;
  }
}