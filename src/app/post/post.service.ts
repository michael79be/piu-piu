import { Injectable, inject } from '@angular/core';
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { AuthService, SignerInfo } from '../auth/auth.service';
import { CryptoService } from '../crypto/crypto.service';

export interface PostData {
  uuid: string;
  sender: string;
  senderAccount: string;
  timestamp: number;
  content: string;
  signature?: Uint8Array;
  authenticatorData?: Uint8Array;
  clientData?: Uint8Array;
}

interface PostsDB extends DBSchema {
  posts: {
    key: string;
    value: string;
  };
}

@Injectable({ providedIn: 'root' })
export class PostService {
  private authService = inject(AuthService);
  private cryptoService = inject(CryptoService);
  private dbCache = new Map<string, Promise<IDBPDatabase<PostsDB>>>();

  private getDB(accountName: string): Promise<IDBPDatabase<PostsDB>> {
    if (!this.dbCache.has(accountName)) {
      this.dbCache.set(accountName, openDB<PostsDB>(accountName, 1, {
        upgrade(db) {
          db.createObjectStore('posts');
        },
      }));
    }
    return this.dbCache.get(accountName)!;
  }

  private createSigningString(post: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData'>): string {
    return `${post.uuid}:${post.senderAccount}:${post.timestamp}:${post.content}`;
  }

  async createPost(accountName: string, content: string): Promise<PostData | null> {
    const signer = this.authService.storedSigner();
    if (!signer) return null;

    const uuid = crypto.randomUUID();
    const timestamp = Date.now();

    const postData: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData'> = {
      uuid,
      sender: signer.username,
      senderAccount: signer.account,
      timestamp,
      content,
    };

    const signingString = this.createSigningString(postData);
    const challenge = await this.hashChallenge(signingString);

    console.log('[createPost] signingString:', signingString);
    console.log('[createPost] challenge length:', challenge.length);

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

      console.log('[createPost] authData length:', authData.length);
      console.log('[createPost] clientData length:', clientData.length);
      console.log('[createPost] signature length:', signature.length);

      let username = signer.username;
      if (response.userHandle) {
        const decoder = new TextDecoder('utf-8');
        username = decoder.decode(response.userHandle) ?? signer.username;
      }

      const post: PostData = {
        ...postData,
        sender: username,
        signature,
        authenticatorData: authData,
        clientData: clientData,
      };

      const db = await this.getDB(accountName);
      await db.put('posts', JSON.stringify(post), uuid);

      return post;
    } catch (e) {
      console.error('WebAuthn sign failed:', e);
      return null;
    }
  }

  private async hashChallenge(data: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(data));
    return new Uint8Array(hash);
  }

  async getPost(accountName: string, uuid: string): Promise<PostData | null> {
    const db = await this.getDB(accountName);
    const data = await db.get('posts', uuid);
    if (!data) return null;
    const post = JSON.parse(data);
    return this.deserializePost(post);
  }

  async getAllPosts(accountName: string): Promise<PostData[]> {
    const db = await this.getDB(accountName);
    const allData = await db.getAll('posts');
    return allData.map(d => this.deserializePost(JSON.parse(d))).sort((a, b) => b.timestamp - a.timestamp);
  }

  private deserializePost(post: Record<string, unknown>): PostData {
    console.log('[deserializePost] raw post keys:', Object.keys(post));
    console.log('[deserializePost] signature present:', !!post['signature']);
    console.log('[deserializePost] signature type:', typeof post['signature'], Array.isArray(post['signature']));
    console.log('[deserializePost] authenticatorData present:', !!post['authenticatorData']);
    console.log('[deserializePost] clientData present:', !!post['clientData']);
    
    const toUint8Array = (val: unknown): Uint8Array | undefined => {
      if (!val) return undefined;
      if (val instanceof Uint8Array) return val;
      if (Array.isArray(val)) return new Uint8Array(val);
      // Handle object with numeric keys (JSON-serialized Uint8Array)
      const obj = val as Record<string, number>;
      const keys = Object.keys(obj);
      if (keys.length === 0) return new Uint8Array(0);
      const maxKey = Math.max(...keys.map(k => parseInt(k, 10)));
      const arr = new Uint8Array(maxKey + 1);
      for (const key of keys) {
        arr[parseInt(key, 10)] = obj[key];
      }
      return arr;
    };

    const result = {
      ...post,
      signature: toUint8Array(post['signature']),
      authenticatorData: toUint8Array(post['authenticatorData']),
      clientData: toUint8Array(post['clientData']),
    } as PostData;
    
    console.log('[deserializePost] result signature length:', result.signature?.length);
    console.log('[deserializePost] result authenticatorData length:', result.authenticatorData?.length);
    console.log('[deserializePost] result clientData length:', result.clientData?.length);
    return result;
  }

  async deletePost(accountName: string, uuid: string): Promise<void> {
    const db = await this.getDB(accountName);
    await db.delete('posts', uuid);
  }

  async verifyPost(post: PostData, publicKey: number[]): Promise<boolean> {
    if (!post.signature || post.signature.length === 0) return false;

    const postWithoutSig: Omit<PostData, 'signature' | 'authenticatorData' | 'clientData'> = {
      uuid: post.uuid,
      sender: post.sender,
      senderAccount: post.senderAccount,
      timestamp: post.timestamp,
      content: post.content,
    };

    const signingString = this.createSigningString(postWithoutSig);
    const expectedChallenge = await this.hashChallenge(signingString);

    try {
      const clientDataBytes = post.clientData ?? new Uint8Array(0);
      const clientDataHash = new Uint8Array(
        await window.crypto.subtle.digest('SHA-256', clientDataBytes as BufferSource)
      );

      const authDataBytes = post.authenticatorData ?? new Uint8Array(0);
      const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
      signedData.set(authDataBytes, 0);
      signedData.set(clientDataHash, authDataBytes.length);

      // Verify the challenge in clientData matches our expected challenge
      const clientDataJson = new TextDecoder().decode(clientDataBytes);
      let actualChallenge: Uint8Array | null = null;
      try {
        const parsed = JSON.parse(clientDataJson);
        if (parsed.challenge) {
          // WebAuthn challenge is base64url encoded
          actualChallenge = this.base64UrlToBytes(parsed.challenge);
        }
      } catch (e) {
        console.error('[verifyPost] Failed to parse clientDataJSON:', e);
      }

      console.log('[verifyPost] post uuid:', post.uuid);
      console.log('[verifyPost] signingString:', signingString);
      console.log('[verifyPost] expectedChallenge length:', expectedChallenge.length);
      console.log('[verifyPost] actualChallenge length:', actualChallenge?.length);
      console.log('[verifyPost] challenge match:', actualChallenge ? this.bytesEqual(expectedChallenge, actualChallenge) : 'no challenge in clientData');
      console.log('[verifyPost] authData length:', authDataBytes.length);
      console.log('[verifyPost] clientData length:', clientDataBytes.length);
      console.log('[verifyPost] clientDataHash length:', clientDataHash.length);
      console.log('[verifyPost] signedData length:', signedData.length);
      console.log('[verifyPost] signature length:', post.signature.length);
      console.log('[verifyPost] publicKey length:', publicKey.length);

      if (!actualChallenge || !this.bytesEqual(expectedChallenge, actualChallenge)) {
        console.error('[verifyPost] Challenge mismatch!');
        return false;
      }

      const cryptoKey = await this.cryptoService.importPublicKey(publicKey);
      const rawSignature = this.cryptoService.derToRawSignature(post.signature);

      console.log('[verifyPost] rawSignature length:', rawSignature.length);

      return await window.crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        cryptoKey,
        rawSignature as BufferSource,
        signedData as BufferSource
      );
    } catch (e) {
      console.error('Verification failed:', e);
      return false;
    }
  }

  private base64UrlToBytes(base64url: string): Uint8Array {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async getVerifiedPosts(accountName: string, publicKey: number[]): Promise<PostData[]> {
    const allPosts = await this.getAllPosts(accountName);
    console.log('[getVerifiedPosts] total posts:', allPosts.length);
    console.log('[getVerifiedPosts] publicKey length:', publicKey.length);
    const verifiedPosts: PostData[] = [];
    for (const post of allPosts) {
      console.log('[getVerifiedPosts] checking post:', post.uuid);
      if (await this.verifyPost(post, publicKey)) {
        console.log('[getVerifiedPosts] post verified:', post.uuid);
        verifiedPosts.push(post);
      } else {
        console.log('[getVerifiedPosts] post FAILED verification:', post.uuid);
      }
    }
    return verifiedPosts;
  }
}