import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TuiButton, TuiDropdown, TuiDataList, TuiTextfield, TuiDialogService } from '@taiga-ui/core';
import { PolymorpheusComponent } from '@taiga-ui/polymorpheus';
import { LaIconComponent, LaIconLibrary } from 'angular-line-awesome';
import { lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock } from 'angular-line-awesome/icons';
import { ProfileData } from '../profile/profile.service';
import { ErrorService } from '../error/error.service';
import { RoomService } from '../room/room.service';
import { AuthService } from '../auth/auth.service';
import { PostService, PostData } from '../post/post.service';
import { PostDialogComponent } from '../post/post-dialog/post-dialog.component';

type MenuItem = {
  label: string;
  command: () => void;
}

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, TuiButton, TuiDropdown, TuiDataList, TuiTextfield, LaIconComponent],
  templateUrl: './account.html',
  styleUrl: './account.scss'
})
export class Account implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private errorService = inject(ErrorService);
  private roomService = inject(RoomService);
  private authService = inject(AuthService);
  private postService = inject(PostService);
  private dialogService = inject(TuiDialogService);
  private library = inject(LaIconLibrary);

  profileData = signal<ProfileData | null>(null);
  accountName = signal<string | null>(null);
  showAccountMenu = signal(false);

  peers = this.roomService.peers;
  isConnected = this.roomService.isConnected;
  peerCount = this.roomService.peerCount;
  selfId = this.roomService.selfId;

  isSignedIn = this.authService.isSignedIn;
  storedSigner = this.authService.storedSigner;
  displayName = this.authService.displayName;

  posts = signal<PostData[]>([]);

  signerMatchesAccount = computed(() => {
    const signer = this.storedSigner();
    const accountName = this.accountName();
    return signer?.account === accountName;
  });

  canPost = computed(() => this.isSignedIn() && this.signerMatchesAccount());

  accountMenu = computed<MenuItem[]>(() => {
    if (this.isSignedIn()) {
      return [
        { label: 'Profile', command: () => { } },
        { label: 'Sign out', command: () => this.signOut() }
      ];
    } else {
      return [
        { label: 'Sign in', command: () => this.signIn() },
        { label: 'Register', command: () => this.router.navigate(['/register']) }
      ];
    }
  });

  constructor() {
    this.library.addIcons([lasArrowLeft, lasEllipsisH, lasHome, larEdit, larUser, lasUsers, lasComment, lasPaperPlane, lasShieldAlt, lasUserSecret, lasUser, lasClock]);
  }

  async ngOnInit(): Promise<void> {
    this.profileData.set(this.route.snapshot.data['profileData']);
    const routeAccountName = this.route.snapshot.paramMap.get('accountName');
    const profile = this.profileData();
    this.accountName.set(routeAccountName ?? profile?.accountName ?? profile?.username ?? null);

    if (this.accountName()) {
      await this.roomService.joinRoom(this.accountName()!);
    }

    await this.loadPosts();

    const signInParam = this.route.snapshot.queryParamMap.get('signIn');
    if (signInParam === 'true') {
      this.showAccountMenu.set(true);
      await this.performSignIn();
    }
  }

  private async performSignIn(): Promise<void> {
    const accountName = this.accountName();
    if (null === accountName) {
      this.errorService.showError('No account name set');
      return;
    }
    await this.authService.signIn(accountName);
    this.router.navigate([], { queryParams: { signIn: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async signIn(): Promise<void> {
    this.router.navigate(['/'], { queryParams: { signIn: true }, queryParamsHandling: 'merge' });
  }

  async loadPosts(): Promise<void> {
    const accountName = this.accountName();
    const profile = this.profileData();
    console.log('[Account.loadPosts] accountName:', accountName);
    console.log('[Account.loadPosts] profile:', profile);
    if (!accountName || !profile?.publicKey) {
      console.log('[Account.loadPosts] missing accountName or publicKey');
      this.posts.set([]);
      return;
    }
    console.log('[Account.loadPosts] publicKey length:', profile.publicKey.length);
    const verifiedPosts = await this.postService.getVerifiedPosts(accountName, profile.publicKey);
    console.log('[Account.loadPosts] verifiedPosts count:', verifiedPosts.length);
    this.posts.set(verifiedPosts);
  }

  onHome(): void {
  }

  openPostDialog(): void {
    const accountName = this.accountName();
    if (!accountName) return;

    this.dialogService.open<PostData>(new PolymorpheusComponent(PostDialogComponent), {
      size: 'm',
      closable: true,
      dismissible: true,
      data: { accountName },
    }).subscribe((post) => {
      if (post) {
        this.loadPosts();
      }
    });
  }

  onAccount(): void {
  }

  signOut(): void {
    this.authService.signOut();
    this.roomService.leaveRoom();
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
}