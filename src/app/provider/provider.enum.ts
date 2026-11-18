export type Provider = {
  url: string;
  prefix: string;
  label: string;
};

export const Providers: Provider[] = [
  { url: 'https://is.gd', prefix: '', label: 'is.gd' },
  { url: 'https://v.gd', prefix: 'v', label: 'v.gd' },
  { url: 'http://localhost:3000', prefix: 'l', label: 'localhost' },
];

export const LocalhostProviderUrl = 'http://localhost:3000';

export function getProviderByUrl(url: string): Provider | undefined {
  return Providers.find(p => p.url === url);
}

export function getProviderByPrefix(prefix: string): Provider | undefined {
  return Providers.find(p => p.prefix === prefix);
}

export function getDefaultProvider(): Provider {
  return Providers[0];
}

export function getAvailableProviders(isLocalhost: boolean): Provider[] {
  if (isLocalhost) {
    return Providers;
  }
  return Providers.filter(p => p.url !== LocalhostProviderUrl);
}

export type ProviderResult = {
  short_url: string;
  errorcode?: string;
};

export type ProviderLookupResult = {
  longurl: string;
  errorcode?: string;
};