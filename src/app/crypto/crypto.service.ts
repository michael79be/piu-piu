import { Injectable } from '@angular/core';

export interface WebAuthnSignResult {
  signature: string; // base64
  authenticatorData: string; // base64
  clientData: string; // base64
  username?: string;
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes));
  }

  private base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async importPublicKey(publicKey: string): Promise<CryptoKey> {
    const publicKeyBytes = this.base64ToBytes(publicKey);
    const keyFormat = publicKeyBytes.length === 65 ? 'raw' : 'spki';

    return window.crypto.subtle.importKey(
      keyFormat,
      publicKeyBytes as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }

  async importPublicKeyForSign(publicKey: string): Promise<CryptoKey> {
    const publicKeyBytes = this.base64ToBytes(publicKey);
    const keyFormat = publicKeyBytes.length === 65 ? 'raw' : 'spki';

    return window.crypto.subtle.importKey(
      keyFormat,
      publicKeyBytes as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
  }

  async signData(data: string, publicKey: string): Promise<string | null> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const cryptoKey = await this.importPublicKeyForSign(publicKey);

      const signature = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        dataBytes
      );

      return this.bytesToBase64(new Uint8Array(signature));
    } catch (e) {
      console.error('Signing failed:', e);
      return null;
    }
  }

  async verifySignature(data: string, signature: string, publicKey: string): Promise<boolean> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const cryptoKey = await this.importPublicKey(publicKey);
      const rawSignature = this.derToRawSignature(this.base64ToBytes(signature));

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature.buffer as ArrayBuffer,
        dataBytes
      );
    } catch (e) {
      console.error('Verification failed:', e);
      return false;
    }
  }

  async importRsaPublicKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');
    const binary = atob(pemContents);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return window.crypto.subtle.importKey(
      'spki',
      bytes as BufferSource,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  }

  async rsaEncrypt(data: string, publicKeyPem: string): Promise<string | null> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const cryptoKey = await this.importRsaPublicKey(publicKeyPem);

      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        cryptoKey,
        dataBytes
      );

      return this.bytesToBase64(new Uint8Array(encrypted));
    } catch (e) {
      console.error('RSA encryption failed:', e);
      return null;
    }
  }

  async webAuthnSign(accountName: string): Promise<WebAuthnSignResult | null> {
    const challenge = this.padChallenge(new TextEncoder().encode(accountName), 32);

    try {
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: challenge as unknown as ArrayBuffer,
          timeout: 60000,
          userVerification: 'preferred'
        }
      }) as PublicKeyCredential;

      const response = cred.response as AuthenticatorAssertionResponse;
      const authData = response.authenticatorData ? new Uint8Array(response.authenticatorData) : new Uint8Array(0);
      const clientData = response.clientDataJSON ? new Uint8Array(response.clientDataJSON) : new Uint8Array(0);
      const signature = response.signature ? new Uint8Array(response.signature) : new Uint8Array(0);

      let username: string | undefined;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle);
      }

      return {
        signature: this.bytesToBase64(signature),
        authenticatorData: this.bytesToBase64(authData),
        clientData: this.bytesToBase64(clientData),
        username
      };
    } catch (e) {
      console.error('WebAuthn sign failed:', e);
      return null;
    }
  }

  async verifyWebAuthnSignature(
    authData: string,
    clientData: string,
    signature: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const authDataBytes = this.base64ToBytes(authData);
      const clientDataBytes = this.base64ToBytes(clientData);
      const signatureBytes = this.base64ToBytes(signature);

      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientDataBytes as BufferSource)
      );

      const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
      signedData.set(authDataBytes, 0);
      signedData.set(clientDataHash, authDataBytes.length);

      const cryptoKey = await this.importPublicKey(publicKey);
      const rawSignature = this.derToRawSignature(signatureBytes);

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature as BufferSource,
        signedData as BufferSource
      );
    } catch (e) {
      console.error('WebAuthn verification failed:', e);
      return false;
    }
  }

  derToRawSignature(der: Uint8Array): Uint8Array {
    let offset = 2;
    if (der[1] & 0x80) offset += der[1] & 0x7f;

    const rLen = der[offset + 1];
    const rBytes = der.slice(offset + 2, offset + 2 + rLen);
    offset += 2 + rLen;

    const sLen = der[offset + 1];
    const sBytes = der.slice(offset + 2, offset + 2 + sLen);

    const raw = new Uint8Array(64);
    raw.set(rBytes.slice(-32), 32 - Math.min(32, rBytes.length));
    raw.set(sBytes.slice(-32), 64 - Math.min(32, sBytes.length));

    return raw;
  }

  padChallenge(data: Uint8Array, length: number): Uint8Array {
    const result = new Uint8Array(length);
    result.set(data.slice(0, length));
    return result;
  }
}