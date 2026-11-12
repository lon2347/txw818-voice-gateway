import { Component, EventEmitter, Input, Output, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-countdown-btn',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      type="button"
      (click)="onClick()"
      [disabled]="disabled || countdown() > 0 || loading"
      class="px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
      [ngClass]="{
        'bg-sky-600 text-white hover:bg-sky-700 active:bg-sky-800': !disabled && countdown() === 0 && !loading,
        'bg-slate-200 text-slate-400 cursor-not-allowed': disabled || countdown() > 0 || loading
      }">
      @if (loading) {
        <span>发送中...</span>
      } @else if (countdown() > 0) {
        <span>{{ countdown() }}s 后重发</span>
      } @else {
        <span>获取验证码</span>
      }
    </button>
  `
})
export class CountdownBtnComponent implements OnDestroy {
  @Input() disabled = false;
  @Input() loading = false;
  @Output() send = new EventEmitter<void>();

  countdown = signal<number>(0);
  private timer: any = null;

  onClick(): void {
    if (this.disabled || this.countdown() > 0 || this.loading) return;
    this.send.emit();
  }

  startCountdown(seconds = 60): void {
    this.clearTimer();
    this.countdown.set(seconds);
    this.timer = setInterval(() => {
      const cur = this.countdown();
      if (cur <= 1) {
        this.clearTimer();
        this.countdown.set(0);
      } else {
        this.countdown.set(cur - 1);
      }
    }, 1000);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }
}

