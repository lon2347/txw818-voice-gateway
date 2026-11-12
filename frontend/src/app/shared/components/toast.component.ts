import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (toastService.toast(); as t) {
      <div class="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all duration-300 flex items-center space-x-2 animate-bounce-short"
        [ngClass]="{
          'bg-emerald-600 text-white': t.type === 'success',
          'bg-rose-600 text-white': t.type === 'error',
          'bg-slate-800 text-white': t.type === 'info'
        }">
        @if (t.type === 'success') {
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
        } @else if (t.type === 'error') {
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        } @else {
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        }
        <span>{{ t.message }}</span>
      </div>
    }
  `,
  styles: [`
    @keyframes bounceShort {
      0% { opacity: 0; transform: translate(-50%, -10px); }
      100% { opacity: 1; transform: translate(-50%, 0); }
    }
    .animate-bounce-short {
      animation: bounceShort 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  `]
})
export class ToastComponent {
  toastService = inject(ToastService);
}

