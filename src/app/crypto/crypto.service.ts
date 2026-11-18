import { Injectable } from '@angular/core';

export interface WebAuthnSignResult {
  signature: Uint8Array;
  authenticatorData: Uint8Array;
  clientData: Uint8Array;
  username?: string;
}

@Injectable({ providedIn: 'root' })
export class CryptoService {
  async importPublicKey(publicKey: number[]): Promise<CryptoKey> {
    const publicKeyBytes = new Uint8Array(publicKey);
    const keyFormat = publicKeyBytes.length === 65 ? 'raw' : 'spki';

    return window.crypto.subtle.importKey(
      keyFormat,
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  }

  async importPublicKeyForSign(publicKey: number[]): Promise<CryptoKey> {
    const publicKeyBytes = new Uint8Array(publicKey);
    const keyFormat = publicKeyBytes.length === 65 ? 'raw' : 'spki';

    return window.crypto.subtle.importKey(
      keyFormat,
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
  }

  async signData(data: string, publicKey: number[]): Promise<Uint8Array | null> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const cryptoKey = await this.importPublicKeyForSign(publicKey);

      const signature = await window.crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        dataBytes
      );

      return new Uint8Array(signature);
    } catch (e) {
      console.error('Signing failed:', e);
      return null;
    }
  }

  async verifySignature(data: string, signature: Uint8Array, publicKey: number[]): Promise<boolean> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const cryptoKey = await this.importPublicKey(publicKey);
      const rawSignature = this.derToRawSignature(signature);

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

      return { signature, authenticatorData: authData, clientData, username };
    } catch (e) {
      console.error('WebAuthn sign failed:', e);
      return null;
    }
  }

  async verifyWebAuthnSignature(
    authData: Uint8Array,
    clientData: Uint8Array,
    signature: Uint8Array,
    publicKey: number[]
  ): Promise<boolean> {
    try {
      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientData.buffer as ArrayBuffer)
      );

      const signedData = new Uint8Array(authData.length + clientDataHash.length);
      signedData.set(authData, 0);
      signedData.set(clientDataHash, authData.length);

      const cryptoKey = await this.importPublicKey(publicKey);
      const rawSignature = this.derToRawSignature(signature);

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature.buffer as ArrayBuffer,
        signedData
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