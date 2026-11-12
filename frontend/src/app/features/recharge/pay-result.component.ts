import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { OrderService } from '../../core/services/order.service';
import { WalletService } from '../../core/services/wallet.service';
import { HeaderComponent } from '../../shared/components/header.component';

@Component({
  selector: 'app-pay-result',
  standalone: true,
  imports: [CommonModule, RouterLink, HeaderComponent],
  template: `
    <app-header title="支付结果" subtitle="订单履约与时长到账确认" [showBack]="false" />

    <div class="p-6 text-center py-16 space-y-6">
      @if (status() === 'checking') {
        <div class="space-y-4">
          <div class="relative w-20 h-20 mx-auto flex items-center justify-center">
            <div class="absolute inset-0 rounded-full border-4 border-sky-100 border-t-sky-600 animate-spin"></div>
            <svg class="w-8 h-8 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-800">正在核验支付到账...</h3>
            <p class="text-xs text-slate-400 mt-1">支付宝异步通知正在发放语音时长 ({{ pollCount() }}/12)</p>
          </div>
        </div>
      } @else if (status() === 'paid') {
        <div class="space-y-4 animate-fade-in">
          <div class="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-bold text-emerald-700">时长已成功到账！</h3>
            <p class="text-xs text-slate-500 mt-1">您的 TXW818 语音硬件现在可以随时唤醒对话</p>
          </div>
          <div class="pt-4">
            <a
              routerLink="/wallet"
              class="inline-block w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-lg shadow-emerald-600/20 transition-all">
              查看我的钱包余额
            </a>
          </div>
        </div>
      } @else {
        <div class="space-y-4">
          <div class="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-800">支付确认中</h3>
            <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
              若您已在支付宝成功付款，系统入账可能有短暂延迟，稍后在钱包中刷新即可查看到账
            </p>
          </div>
          <div class="pt-4 space-y-2">
            <a
              routerLink="/wallet"
              class="inline-block w-full py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm rounded-xl transition-all">
              进入钱包中心
            </a>
            <a
              routerLink="/recharge"
              class="inline-block w-full py-2.5 text-xs text-slate-500 hover:text-slate-700">
              返回充值页
            </a>
          </div>
        </div>
      }
    </div>
  `
})
export class PayResultComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private orderService = inject(OrderService);
  private walletService = inject(WalletService);

  status = signal<'checking' | 'paid' | 'pending'>('checking');
  pollCount = signal<number>(0);
  private timer: any = null;

  ngOnInit(): void {
    const qOrderNo = this.route.snapshot.queryParams['out_trade_no'] ||
                     this.route.snapshot.queryParams['order_no'] ||
                     sessionStorage.getItem('vg_last_order_no');

    if (!qOrderNo) {
      this.status.set('pending');
      return;
    }

    this.startPolling(qOrderNo.trim());
  }

  private startPolling(orderNo: string): void {
    let attempts = 0;
    const maxAttempts = 12;

    const check = () => {
      attempts++;
      this.pollCount.set(attempts);

      this.orderService.getOrderStatus(orderNo).subscribe({
        next: (res) => {
          if (res.code === 0 && res.data?.status === 'paid') {
            this.status.set('paid');
            this.walletService.fetchBalance().subscribe();
            this.clearTimer();
            sessionStorage.removeItem('vg_last_order_no');
          } else if (attempts >= maxAttempts) {
            this.status.set('pending');
            this.clearTimer();
          } else {
            this.timer = setTimeout(check, 2500);
          }
        },
        error: () => {
          if (attempts >= maxAttempts) {
            this.status.set('pending');
            this.clearTimer();
          } else {
            this.timer = setTimeout(check, 2500);
          }
        }
      });
    };

    check();
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }
}

