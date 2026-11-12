import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DeviceService } from '../../core/services/device.service';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header.component';
import { ResolveDeviceResponse } from '../../core/models/device.model';

@Component({
  selector: 'app-bind-device',
  standalone: true,
  imports: [CommonModule, FormsModule, HeaderComponent],
  template: `
    <app-header title="绑定设备" subtitle="扫码或输入设备编号进行绑定" [showBack]="true" />

    <div class="p-5 space-y-5">
      <!-- 扫码或手动输入设备编号 -->
      <div class="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-500 mb-1.5">设备编号 (Device ID)</label>
          <div class="flex items-center space-x-2">
            <input
              type="text"
              placeholder="如: TXW818-ABC123"
              [(ngModel)]="deviceId"
              name="deviceId"
              class="flex-1 px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 uppercase focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:normal-case placeholder:text-slate-400"
            />
            <button
              type="button"
              (click)="onResolve()"
              [disabled]="!deviceId.trim() || isResolving()"
              class="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 active:scale-95 text-white text-xs font-semibold rounded-xl transition-all disabled:opacity-40 disabled:pointer-events-none">
              @if (isResolving()) {
                <span>查询中...</span>
              } @else {
                <span>查询状态</span>
              }
            </button>
          </div>
          <p class="text-[11px] text-slate-400 mt-1.5">设备编号通常位于机身底部二维码贴纸下方</p>
        </div>
      </div>

      <!-- 设备识别结果卡片 -->
      @if (deviceInfo(); as dev) {
        <div class="bg-gradient-to-br from-white to-sky-50/40 p-5 rounded-2xl border border-sky-100 shadow-sm space-y-4 animate-fade-in">
          <div class="flex items-start justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-12 h-12 bg-sky-500/10 text-sky-600 rounded-xl flex items-center justify-center">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z"></path>
                </svg>
              </div>
              <div>
                <h3 class="text-sm font-bold text-slate-800">TXW818 智能语音设备</h3>
                <p class="text-xs text-slate-500 font-mono mt-0.5">{{ dev.device_id }}</p>
              </div>
            </div>

            <!-- 状态胶囊 -->
            @if (dev.bound) {
              <span class="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200/60 rounded-full text-[11px] font-semibold">
                已被绑定
              </span>
            } @else {
              <span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-full text-[11px] font-semibold">
                未绑定·可接入
              </span>
            }
          </div>

          <div class="border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500">
            <span>出厂硬件状态</span>
            <span class="font-medium text-slate-700">{{ dev.status === 'disabled' ? '已停用' : '正常' }}</span>
          </div>

          <!-- 绑定按钮 -->
          <div class="pt-2">
            @if (authService.isLoggedIn()) {
              <button
                type="button"
                (click)="onBind()"
                [disabled]="isBinding() || dev.status === 'disabled'"
                class="w-full py-3 bg-sky-600 hover:bg-sky-700 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-md shadow-sky-600/20 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center space-x-2">
                @if (isBinding()) {
                  <span>正在执行绑定...</span>
                } @else {
                  <span>确认绑定到当前账号</span>
                }
              </button>
            } @else {
              <button
                type="button"
                (click)="goToLogin()"
                class="w-full py-3 bg-slate-800 hover:bg-slate-900 active:scale-[0.99] text-white font-semibold text-sm rounded-xl transition-all flex items-center justify-center space-x-1">
                <span>请先登录以完成绑定</span>
                <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </button>
            }
          </div>
        </div>
      }

      <!-- 快速提示说明 -->
      <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200/60 text-xs text-slate-500 space-y-2">
        <div class="font-semibold text-slate-700 flex items-center space-x-1.5">
          <svg class="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <span>绑定须知</span>
        </div>
        <p>1. 一台设备仅可归属于一个手机号账户；绑定后语音额度将共享账户内加油包时长。</p>
        <p>2. 若设备已归属当前手机号，再次绑定可刷新网关接入凭证。</p>
      </div>
    </div>
  `
})
export class BindDeviceComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private deviceService = inject(DeviceService);
  private toast = inject(ToastService);
  authService = inject(AuthService);

  deviceId = '';
  deviceInfo = signal<ResolveDeviceResponse | null>(null);
  isResolving = signal<boolean>(false);
  isBinding = signal<boolean>(false);

  ngOnInit(): void {
    const qId = this.route.snapshot.queryParams['device_id'];
    if (qId) {
      this.deviceId = qId.trim();
      this.onResolve();
    }
  }

  onResolve(): void {
    const id = this.deviceId.trim();
    if (!id) return;

    this.isResolving.set(true);
    this.deviceService.resolveDevice(id).subscribe({
      next: (res) => {
        this.isResolving.set(false);
        if (res.code === 0 && res.data) {
          this.deviceInfo.set(res.data);
          this.toast.info('已识别到设备');
        } else {
          this.deviceInfo.set(null);
          this.toast.error(res.msg || '设备未录入或编号错误');
        }
      },
      error: () => {
        this.isResolving.set(false);
        this.toast.error('网络请求异常');
      }
    });
  }

  onBind(): void {
    const id = this.deviceId.trim();
    if (!id) return;

    this.isBinding.set(true);
    this.deviceService.bindDevice(id).subscribe({
      next: (res) => {
        this.isBinding.set(false);
        if (res.code === 0) {
          this.toast.success('设备绑定成功！');
          this.router.navigate(['/devices']);
        } else {
          this.toast.error(res.msg || '绑定失败');
        }
      },
      error: () => {
        this.isBinding.set(false);
        this.toast.error('绑定请求失败');
      }
    });
  }

  goToLogin(): void {
    const returnUrl = `/bind?device_id=${encodeURIComponent(this.deviceId.trim())}`;
    this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }
}

