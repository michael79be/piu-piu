import { Injectable } from '@angular/core';
import { ConfigService } from '../config/config.service';

@Injectable({ providedIn: 'root' })
export class RsaPublicKeyService {
  constructor(private configService: ConfigService) {}

  async getPublicKey(): Promise<string> {
    const key = this.configService.getRsaPublicKey();
    if (!key) {
      throw new Error('RSA public key not loaded');
    }
    return key;
  }
}