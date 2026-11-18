import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SESSION_KEY } from './auth.enum';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean {
    const storedSigner = sessionStorage.getItem(SESSION_KEY);
    if (!storedSigner) {
      // No signer in sessionStorage, not authenticated
      this.router.navigate(['/']);
      return false;
    }

    const signer = JSON.parse(storedSigner);
    const profileData = sessionStorage.getItem('piu_piu_profile');

    if (!profileData) {
      // Profile data not in sessionStorage
      this.router.navigate(['/']);
      return false;
    }

    const profile = JSON.parse(profileData);

    // Compare publicKey to verify this is the currently signed-in user
    if (profile?.publicKey === signer?.publicKey) {
      // Signer matches profile - user is authenticated
      return true;
    }

    // Signer doesn't match profile - clear invalid session and redirect
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('piu_piu_profile');
    this.router.navigate(['/']);
    return false;
  }
}