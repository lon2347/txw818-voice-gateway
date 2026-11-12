import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private _toast = signal<ToastMessage | null>(null);
  readonly toast = this._toast.asReadonly();
  private timer: any = null;

  show(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    const id = Date.now();
    this._toast.set({ id, message, type });
    this.timer = setTimeout(() => {
      if (this._toast()?.id === id) {
        this._toast.set(null);
      }
    }, duration);
  }

  success(message: string, duration = 3000): void {
    this.show(message, 'success', duration);
  }

  error(message: string, duration = 3500): void {
    this.show(message, 'error', duration);
  }

  info(message: string, duration = 3000): void {
    this.show(message, 'info', duration);
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this._toast.set(null);
  }
}

