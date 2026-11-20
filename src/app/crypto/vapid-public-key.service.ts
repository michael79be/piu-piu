import { Injectable } from '@angular/core';
import { ConfigService } from '../config/config.service';

@Injectable({ providedIn: 'root' })
export class VapidPublicKeyService {
  constructor(private configService: ConfigService) {}

  async getPublicKey(): Promise<string> {
    const key = this.configService.getVapidPublicKey();
    if (!key) {
      throw new Error('VAPID public key not loaded');
    }
    return key;
  }
}