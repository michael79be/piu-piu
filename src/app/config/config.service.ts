import { Injectable } from '@angular/core';

export interface AppConfig {
  rsaPublicKey: string;
  vapidPublicKey: string;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private config: AppConfig | null = null;
  private loadingPromise: Promise<AppConfig> | null = null;

  async load(): Promise<AppConfig> {
    if (this.config) {
      return this.config;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.fetchConfig();
    try {
      this.config = await this.loadingPromise;
      return this.config;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async fetchConfig(): Promise<AppConfig> {
    const response = await fetch('/config.json');
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`);
    }
    return response.json() as Promise<AppConfig>;
  }

  getConfig(): AppConfig | null {
    return this.config;
  }

  getRsaPublicKey(): string | null {
    return this.config?.rsaPublicKey ?? null;
  }

  getVapidPublicKey(): string | null {
    return this.config?.vapidPublicKey ?? null;
  }

  clearCache(): void {
    this.config = null;
  }
}