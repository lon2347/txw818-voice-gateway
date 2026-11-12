import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule, Location } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="bg-white border-b border-slate-100 px-4 py-3.5 sticky top-0 z-30 flex items-center justify-between">
      <div class="flex items-center space-x-2.5">
        @if (showBack) {
          <button
            type="button"
            (click)="goBack()"
            class="p-1 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-50 active:bg-slate-100 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path>
            </svg>
          </button>
        }
        <div>
          <h1 class="text-base font-bold text-slate-900 leading-tight">{{ title }}</h1>
          @if (subtitle) {
            <p class="text-xs text-slate-400 mt-0.5">{{ subtitle }}</p>
          }
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <ng-content select="[actions]"></ng-content>
      </div>
    </header>
  `
})
export class HeaderComponent {
  private location = inject(Location);

  @Input() title = '';
  @Input() subtitle = '';
  @Input() showBack = false;
  @Output() back = new EventEmitter<void>();

  goBack(): void {
    if (this.back.observed) {
      this.back.emit();
    } else {
      this.location.back();
    }
  }
}

