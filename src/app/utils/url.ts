export function rootUrl(): string {
  const baseHref = document.querySelector('base')?.getAttribute('href') ?? '/';
  const root = new URL(location.href);
  root.pathname = '';
  const base = baseHref.startsWith('/') ? baseHref.slice(0, -1) : baseHref;
  return `${root.toString()}${base}/`;
}
