import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { WalletService } from '../../core/services/wallet.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header.component';
import { PurchaseOrder, VoiceBill } from '../../core/models/wallet.model';

@Component({
  selector: 'app-wallet',
  standalone: true,
  imports: [CommonModule, RouterLink, HeaderComponent],
  template: `
    <app-header title="账户中心" subtitle="语音时长与账单明细">
      <div actions>
        <button
          type="button"
          (click)="onLogout()"
          class="text-xs text-slate-400 hover:text-rose-600 transition-colors px-2 py-1">
          退出登录
        </button>
      </div>
    </app-header>

    <div class="p-4 space-y-4">
      <!-- 用户信息与余额卡片 -->
      <div class="bg-gradient-to-br from-slate-900 via-sky-950 to-slate-900 rounded-2xl p-5 text-white shadow-xl relative overflow-hidden">
        <!-- 装饰光圈 -->
        <div class="absolute -right-10 -bottom-10 w-40 h-40 bg-sky-500/20 rounded-full blur-2xl pointer-events-none"></div>

        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-2">
            <div class="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-sky-300">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
              </svg>
            </div>
            <div>
              <p class="text-[11px] text-slate-400 leading-none">当前绑定账号</p>
              <p class="text-xs font-semibold text-slate-200 mt-1 font-mono">{{ maskedPhone() }}</p>
            </div>
          </div>

          <button
            type="button"
            (click)="refreshBalance()"
            [disabled]="isRefreshing()"
            class="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 active:scale-95 transition-all">
            <svg class="w-4 h-4" [ngClass]="{ 'animate-spin': isRefreshing() }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
          </button>
        </div>

        <div>
          <span class="text-xs text-sky-200/80">剩余可用语音交互时长</span>
          <div class="mt-1 flex items-baseline space-x-2">
            <span class="text-3xl font-black tracking-tight text-white font-mono">
              {{ walletService.balanceHoursFormatted() }}
            </span>
          </div>
          <p class="text-[11px] text-slate-400 mt-1 font-mono">
            精准权威值: {{ walletService.balanceSeconds() }} 秒
          </p>
        </div>

        <div class="mt-5 pt-3 border-t border-white/10 flex items-center justify-between">
          <span class="text-xs text-slate-300">额度不足将无法发起语音对话</span>
          <a
            routerLink="/recharge"
            class="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 active:scale-95 text-white text-xs font-bold rounded-lg shadow-sm transition-all">
            充值时长
          </a>
        </div>
      </div>

      <!-- 流水明细 Tab -->
      <div class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div class="flex border-b border-slate-100">
          <button
            type="button"
            (click)="activeTab.set('orders')"
            class="flex-1 py-3 text-xs font-semibold text-center transition-colors relative"
            [ngClass]="{
              'text-sky-600': activeTab() === 'orders',
              'text-slate-400 hover:text-slate-600': activeTab() !== 'orders'
            }">
            <span>充值记录</span>
            @if (activeTab() === 'orders') {
              <div class="absolute bottom-0 inset-x-8 h-0.5 bg-sky-600 rounded-full"></div>
            }
          </button>

          <button
            type="button"
            (click)="activeTab.set('bills')"
            class="flex-1 py-3 text-xs font-semibold text-center transition-colors relative"
            [ngClass]="{
              'text-sky-600': activeTab() === 'bills',
              'text-slate-400 hover:text-slate-600': activeTab() !== 'bills'
            }">
            <span>通话扣费流水</span>
            @if (activeTab() === 'bills') {
              <div class="absolute bottom-0 inset-x-8 h-0.5 bg-sky-600 rounded-full"></div>
            }
          </button>
        </div>

        <div class="p-3">
          @if (activeTab() === 'orders') {
            @if (orders().length === 0) {
              <div class="py-10 text-center text-xs text-slate-400">暂无充值记录</div>
            } @else {
              <div class="divide-y divide-slate-50">
                @for (o of orders(); track o.order_no) {
                  <div class="py-3 px-2 flex items-center justify-between">
                    <div>
                      <p class="text-xs font-bold text-slate-800">{{ o.subject || '语音加油包' }}</p>
                      <p class="text-[11px] text-slate-400 mt-0.5 font-mono">{{ o.paid_at || '待支付' }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-bold text-slate-900 font-mono">¥{{ o.amount }}</p>
                      <span
                        class="inline-block px-1.5 py-0.5 text-[10px] rounded font-medium"
                        [ngClass]="{
                          'bg-emerald-50 text-emerald-600': o.status === 'paid',
                          'bg-amber-50 text-amber-600': o.status === 'pending',
                          'bg-slate-100 text-slate-400': o.status !== 'paid' && o.status !== 'pending'
                        }">
                        {{ o.status === 'paid' ? '已到账' : '处理中' }}
                      </span>
                    </div>
                  </div>
                }
              </div>
            }
          } @else {
            @if (bills().length === 0) {
              <div class="py-10 text-center text-xs text-slate-400">暂无通话扣费记录</div>
            } @else {
              <div class="divide-y divide-slate-50">
                @for (b of bills(); track b.session_id) {
                  <div class="py-3 px-2 flex items-center justify-between">
                    <div>
                      <p class="text-xs font-bold text-slate-800">TXW818 语音交互会话</p>
                      <p class="text-[11px] text-slate-400 mt-0.5 font-mono">{{ b.started_at }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-sm font-bold text-rose-500 font-mono">-{{ b.seconds }} 秒</p>
                      <p class="text-[10px] text-slate-400 font-mono">≈ {{ (b.seconds / 60).toFixed(1) }} 分钟</p>
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>
  `
})
export class WalletComponent implements OnInit {
  walletService = inject(WalletService);
  private authService = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  activeTab = signal<'orders' | 'bills'>('orders');
  orders = signal<PurchaseOrder[]>([]);
  bills = signal<VoiceBill[]>([]);
  isRefreshing = signal<boolean>(false);

  maskedPhone(): string {
    const p = this.authService.currentUser()?.phone || '';
    if (p.length === 11) {
      return p.slice(0, 3) + '****' + p.slice(7);
    }
    return p || '未登录';
  }

  ngOnInit(): void {
    this.refreshBalance();
    this.loadBills();
  }

  refreshBalance(): void {
    this.isRefreshing.set(true);
    this.walletService.fetchBalance().subscribe({
      next: () => this.isRefreshing.set(false),
      error: () => this.isRefreshing.set(false)
    });
  }

  loadBills(): void {
    this.walletService.fetchBills().subscribe({
      next: (res) => {
        if (res.code === 0 && res.data) {
          this.orders.set(res.data.orders || []);
          this.bills.set(res.data.bills || []);
        }
      }
    });
  }

  onLogout(): void {
    this.authService.logout();
    this.toast.info('已退出登录');
    this.router.navigate(['/login']);
  }
}

