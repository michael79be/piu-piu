import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiTextfield } from '@taiga-ui/core';
import { POLYMORPHEUS_CONTEXT } from '@taiga-ui/polymorpheus';
import { PostData } from '../../models/post-data';
import { PostService } from '../../post/post.service';
import { TuiTextarea } from '@taiga-ui/kit';
import { AuthService } from '../../auth/auth.service';
import { SignerInfo } from '../../models/signer-info';

export interface PostDialogData {
  accountName: string;
}

export interface PostDialogContext {
  completeWith: (value: PostData | null) => void;
  data: PostDialogData;
}

@Component({
  selector: 'app-post-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, TuiButton, TuiTextfield, TuiTextarea],
  templateUrl: './post-dialog.component.html',
})
export class PostDialogComponent {
  private postService = inject(PostService);
  private authService = inject(AuthService);
  private context = inject(POLYMORPHEUS_CONTEXT) as PostDialogContext;

  content = signal('');
  loading = signal(false);

  async submit(): Promise<void> {
    const text = this.content().trim();
    if (!text || this.loading()) return;

    const signer = this.authService.storedSigner();
    if (!signer) return;

    this.loading.set(true);
    try {
      const post = await this.postService.createPost(signer, text);
      this.context.completeWith(post);
    } finally {
      this.loading.set(false);
    }
  }

  close(): void {
    this.context.completeWith(null);
  }
}