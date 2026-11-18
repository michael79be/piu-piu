import { Injectable, inject } from '@angular/core';
import { TuiToastService } from '@taiga-ui/kit';

@Injectable({ providedIn: 'root' })
export class ErrorService {
  private toasts = inject(TuiToastService);

  showError(message: string): void {
    this.toasts.open(message, { appearance: 'negative', autoClose: 5000 }).subscribe();
  }

  showSuccess(message: string): void {
    this.toasts.open(message, { appearance: 'positive', autoClose: 3000 }).subscribe();
  }

  showInfo(message: string): void {
    this.toasts.open(message, { appearance: 'info', autoClose: 3000 }).subscribe();
  }

  showWarning(message: string): void {
    this.toasts.open(message, { appearance: 'warning', autoClose: 4000 }).subscribe();
  }
}