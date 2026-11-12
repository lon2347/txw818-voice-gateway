import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { OrderService } from '../../core/services/order.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { HeaderComponent } from '../../shared/components/header.component';
import { Package } from '../../core/models/order.model';

@Component({
  selector: 'app-recharge',
  standalone: true,
  imports: [CommonModule, HeaderComponent],
  template: `
    <app-header title="充值加油包" subtitle="购买语音交互时长，随充随用" [showBack]="true" />

    <div class="p-5 space-y-5">
      <!-- 权益说明横幅 -->
      <div class="bg-gradient-to-r from-sky-600 to-indigo-600 rounded-2xl p-5 text-white shadow-lg shadow-sky-600/15">
        <div class="flex items-center space-x-2 text-sky-100 text-xs font-medium mb-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg>
          <span>毫秒级极速响应 · 腾讯云上游保障</span>
        </div>
        <h3 class="text-lg font-bold">TXW818 语音时长加油包</h3>
        <p class="text-xs text-sky-100/90 mt-1">按与硬件双向真实通话时长按秒计费，无使用有效期限制</p>
      </div>

      <!-- 套餐列表 -->
      <div>
        <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">选择加油包规格</h4>

        @if (isLoading()) {
          <div class="py-12 text-center text-slate-400 text-xs">
            <span>正在加载最新套餐规格...</span>
          </div>
        } @else {
          <div class="grid grid-cols-1 gap-3">
            @for (pkg of packages(); track pkg.id) {
              <div
                (click)="selectedPkgId.set(pkg.id)"
                class="p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between"
                [ngClass]="{
                  'border-sky-600 bg-sky-50/40 shadow-sm': selectedPkgId() === pkg.id,
                  'border-slate-100 bg-white hover:border-slate-200': selectedPkgId() !== pkg.id
                }">
                <div class="flex items-center space-x-3.5">
                  <div
                    class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                    [ngClass]="{
                      'border-sky-600 bg-sky-600 text-white': selectedPkgId() === pkg.id,
                      'border-slate-300 bg-white': selectedPkgId() !== pkg.id
                    }">
                    @if (selectedPkgId() === pkg.id) {
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
                      </svg>
                    }
                  </div>

                  <div>
                    <div class="flex items-center space-x-2">
                      <span class="text-sm font-bold text-slate-800">{{ pkg.name }}</span>
                      @if (pkg.minutes >= 1000) {
                        <span class="px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded text-[10px] font-bold">最划算</span>
                      }
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5">包含 {{ pkg.minutes }} 分钟 ({{ pkg.minutes * 60 }}秒) 语音通话</p>
                  </div>
                </div>

                <div class="text-right">
                  <div class="text-lg font-black text-slate-900">
                    <span class="text-xs font-normal text-slate-500 mr-0.5">¥</span>{{ pkg.price }}
                  </div>
                  <span class="text-[10px] text-slate-400">平均 ¥{{ calcAvgPrice(pkg.price, pkg.minutes) }}/分</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- 支付方式与按钮 -->
      <div class="bg-white p-4 rounded-2xl border border-slate-100 space-y-3">
        <div class="flex items-center justify-between text-xs text-slate-600">
          <span class="flex items-center space-x-2">
            <svg class="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm2-8H7V7h10v2z"/>
            </svg>
            <span class="font-medium text-slate-800">支付宝安全支付 (Alipay / Vibe Pay)</span>
          </span>
          <span class="text-emerald-600 font-medium">官方渠道</span>
        </div>

        <button
          type="button"
          (click)="onPay()"
          [disabled]="isSubmitting() || !selectedPkgId()"
          class="w-full py-3.5 bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-lg shadow-sky-600/25 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center space-x-2">
          @if (isSubmitting()) {
            <span>正在创建订单并拉起支付...</span>
          } @else {
            <span>立即购买时长</span>
          }
        </button>
      </div>
    </div>
  `
})
export class RechargeComponent implements OnInit {
  private orderService = inject(OrderService);
  private authService = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  packages = signal<Package[]>([]);
  selectedPkgId = signal<number | null>(null);
  isLoading = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  calcAvgPrice(price: string | number, minutes: number): string {
    const p = Number(price) || 0;
    return (p / (minutes || 1)).toFixed(2);
  }

  ngOnInit(): void {
    this.loadPackages();
  }

  loadPackages(): void {
    this.isLoading.set(true);
    this.orderService.getPackages().subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.code === 0 && res.data && res.data.length > 0) {
          this.packages.set(res.data);
          this.selectedPkgId.set(res.data[0].id);
        } else {
          // 兜底本地默认包
          const fallback: Package[] = [
            { id: 1, name: '60分钟加油包', minutes: 60, price: '9.90' },
            { id: 2, name: '300分钟加油包', minutes: 300, price: '39.90' },
            { id: 3, name: '1000分钟加油包', minutes: 1000, price: '99.00' },
          ];
          this.packages.set(fallback);
          this.selectedPkgId.set(fallback[0].id);
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error('拉取套餐失败，请检查网络');
      }
    });
  }

  onPay(): void {
    if (!this.authService.isLoggedIn()) {
      this.toast.info('请先登录再下单');
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/recharge' } });
      return;
    }

    const pkgId = this.selectedPkgId();
    if (!pkgId) return;

    this.isSubmitting.set(true);
    this.orderService.createOrder(pkgId).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        if (res.code === 0 && res.data?.pay_url) {
          sessionStorage.setItem('vg_last_order_no', res.data.order_no);
          this.toast.info('正在前往支付宝安全支付...');
          window.location.href = res.data.pay_url;
        } else {
          this.toast.error(res.msg || '创建订单失败');
        }
      },
      error: () => {
        this.isSubmitting.set(false);
        this.toast.error('网络请求异常');
      }
    });
  }
}
