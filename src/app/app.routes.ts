import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { ProfileResolver } from './profile/profile.resolver';

export function atMatch(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 0) return null;
  const first = segments[0].path;
  if (!first.startsWith('@')) return null;
  
  const accountName = first.substring(1);
  if (!accountName) return null;
  
  const posParams: { [key: string]: UrlSegment } = {
    accountName: new UrlSegment(accountName, {})
  };
  
  if (segments.length > 1) {
    posParams['provider'] = segments[1];
    return { consumed: segments.slice(0, 2), posParams };
  }
  
  return { consumed: [segments[0]], posParams };
}

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home').then(m => m.Home) },
  { path: 'register', loadComponent: () => import('./register/register').then(m => m.Register) },
  { matcher: atMatch, loadComponent: () => import('./account/account').then(m => m.Account), resolve: { profileData: ProfileResolver } },
];