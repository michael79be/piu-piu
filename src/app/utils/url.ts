export function rootUrl(): string {
      const baseHref = document.querySelector('base')?.getAttribute('href') ?? '/';
      const root = new URL(location.href);
      root.pathname = '';
      return `${root.toString()}${baseHref.startsWith('/') ? baseHref.slice(0, -1) : baseHref}`;
}
