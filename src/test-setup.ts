import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, 'crypto', {
  writable: true,
  value: {
    subtle: {
      digest: vi.fn(),
      importKey: vi.fn(),
      verify: vi.fn(),
    },
    getRandomValues: (arr: any) => crypto.getRandomValues(arr),
  },
});