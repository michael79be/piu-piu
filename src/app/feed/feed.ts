import { Component, computed, inject, OnInit, signal, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TuiDialogService } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasClock, lasShieldAlt, lasList, lasSpinner, lasRss, lasUser } from 'angular-line-awesome/icons';
import { RoomService } from '../room/room.service';
import { AuthService } from '../auth/auth.service';
import { PostService } from '../post/post.service';
import { PostData } from '../models/post-data';
import { FollowData } from '../models/follow-data';
import { SettingsData } from '../models/settings-data';
import { PostDialogComponent } from '../post/post-dialog/post-dialog.component';
import { CryptoService } from '../crypto/crypto.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, LaIconComponent],
  templateUrl: './feed.html',
  styleUrl: './feed.scss'
})
export class Feed implements OnInit, OnDestroy {
  private router = inject(Router);
  private roomService = inject(RoomService);
  private authService = inject(AuthService);
  private postService = inject(PostService);
  private dialogService = inject(TuiDialogService);
  private cryptoService = inject(CryptoService);
  private library = inject(LaIconLibrary);

  posts = signal<PostData[]>([]);
  loading = signal(false);
  gravatarCache = new Map<string, string>();

  private handlePostsUpdated = (event: CustomEvent) => {
    const detail = event.detail;
    if (!detail?.accountName) {
      this.loadFeed();
    }
  };

  constructor() {
    this.library.addIcons([lasClock, lasShieldAlt, lasList, lasSpinner, lasRss]);
  }

  ngOnInit(): void {
    this.loadFeed();

    // Listen for P2P post events
    window.addEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('piu-piu:load-posts', this.handlePostsUpdated as EventListener);
  }

  canPost = computed(() => this.authService.isSignedIn() && this.authService.storedSigner()?.account);

  async loadFeed(): Promise<void> {
    const viewerAccount = this.authService.storedSigner()?.account;
    const viewerPublicKey = this.authService.storedSigner()?.publicKey;
    if (!viewerAccount || !viewerPublicKey) {
      this.posts.set([]);
      return;
    }

    this.loading.set(true);
    try {
      // Get follow data
      const followData = await this.postService.getFollow(viewerAccount);
      if (!followData) {
        this.posts.set([]);
        return;
      }

      const isValid = await this.postService.verifyFollow(followData, viewerPublicKey);
      if (!isValid) {
        this.posts.set([]);
        return;
      }

      const followedAccounts = Object.keys(followData.follows);
      if (followedAccounts.length === 0) {
        this.posts.set([]);
        return;
      }

      // Collect posts from all followed accounts
      const allPosts: PostData[] = [];
      for (const targetAccount of followedAccounts) {
        const verifiedPosts = await this.postService.getVerifiedPosts(targetAccount);
        allPosts.push(...verifiedPosts);
      }

      // Sort by timestamp descending (newest first)
      allPosts.sort((a, b) => b.timestamp - a.timestamp);
      this.posts.set(allPosts);

      // Preload gravatar URLs for all unique sender accounts
      const uniqueAccounts = [...new Set(allPosts.map(p => p.senderAccount))];
      for (const account of uniqueAccounts) {
        const settings = await this.postService.getSettings(account);
        if (settings?.avatarUrl) {
          this.gravatarCache.set(account, settings.avatarUrl);
        } else {
          this.gravatarCache.set(account, '');
        }
      }
    } catch (e) {
      console.error('Failed to load feed:', e);
      this.posts.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  openPostDialog(): void {
    const accountName = this.authService.storedSigner()?.account;
    if (!accountName) return;

    this.dialogService.open<PostData>(new PolymorpheusComponent(PostDialogComponent), {
      size: 'm',
      closable: true,
      dismissible: true,
      data: { accountName },
    }).subscribe(async (post) => {
      if (post) {
        await this.roomService.broadcastPost(post);
        this.loadFeed();
      }
    });
  }

  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  }

  getAvatarUrl(senderAccount: string): string {
    return this.gravatarCache.get(senderAccount) ?? '';
  }

  navigateToPost(post: PostData): void {
    this.router.navigateByUrl(`/@${post.senderAccount}`).then(() => {
      setTimeout(() => {
        const element = document.getElementById(`post-${post.uuid}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    });
  }
}

import { Router } from '@angular/router';