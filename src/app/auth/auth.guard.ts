import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { SESSION_KEY } from './auth.enum';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean {
    const storedSigner = sessionStorage.getItem(SESSION_KEY);
    if (!storedSigner) {
      this.router.navigate(['/']);
      return false;
    }

    try {
      const signer = JSON.parse(storedSigner);
      if (signer?.publicKey && signer.publicKey.length > 0) {
        return true;
      }
    } catch {
      // Invalid JSON in session
    }

    sessionStorage.removeItem(SESSION_KEY);
    this.router.navigate(['/']);
    return false;
  }
}