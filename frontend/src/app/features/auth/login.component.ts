import { Component, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { CountdownBtnComponent } from '../../shared/components/countdown-btn.component';
import { HeaderComponent } from '../../shared/components/header.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, CountdownBtnComponent, HeaderComponent],
  template: `
    <app-header title="快捷登录" subtitle="使用手机短信验证码登录" [showBack]="true" />

    <div class="p-6 flex flex-col justify-between min-h-[calc(100vh-140px)] md:min-h-[700px]">
      <div>
        <div class="text-center my-6">
          <div class="w-16 h-16 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z"></path>
            </svg>
          </div>
          <h2 class="text-xl font-bold text-slate-800">欢迎使用 AI 语音伴侣</h2>
          <p class="text-xs text-slate-400 mt-1">登录后即可管理设备与购买语音时长</p>
        </div>

        <form (ngSubmit)="onSubmit()" class="space-y-4">
          <!-- 手机号输入 -->
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-1.5">手机号码</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <span class="text-sm font-medium">+86</span>
              </div>
              <input
                type="tel"
                maxlength="11"
                placeholder="请输入11位中国大陆手机号"
                [(ngModel)]="phone"
                name="phone"
                class="w-full pl-14 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all placeholder:text-slate-400"
              />
            </div>
          </div>

          <!-- 短信验证码输入 -->
          <div>
            <label class="block text-xs font-semibold text-slate-500 mb-1.5">验证码</label>
            <div class="flex items-center space-x-2">
              <input
                type="text"
                maxlength="6"
                placeholder="6位短信验证码"
                [(ngModel)]="code"
                name="code"
                class="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all tracking-widest placeholder:tracking-normal placeholder:text-slate-400"
              />
              <app-countdown-btn
                #countdownBtn
                [disabled]="!isValidPhone()"
                [loading]="isSendingCode()"
                (send)="onSendCode()"
              />
            </div>

            <!-- 开发模式下快速填充提示 -->
            @if (debugCode()) {
              <div class="mt-2.5 p-2.5 bg-amber-50 border border-amber-200/60 rounded-lg flex items-center justify-between text-xs text-amber-700">
                <span>[开发调试验证码]: <strong>{{ debugCode() }}</strong></span>
                <button
                  type="button"
                  (click)="code = debugCode()"
                  class="text-amber-800 font-semibold underline text-xs ml-2">
                  自动填入
                </button>
              </div>
            }
          </div>

          <!-- 登录按钮 -->
          <div class="pt-4">
            <button
              type="submit"
              [disabled]="isSubmitting() || !isValidForm()"
              class="w-full py-3.5 bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 active:scale-[0.99] text-white font-semibold text-sm rounded-xl shadow-lg shadow-sky-500/20 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center space-x-2">
              @if (isSubmitting()) {
                <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>验证登录中...</span>
              } @else {
                <span>立即登录</span>
              }
            </button>
          </div>
        </form>
      </div>

      <div class="text-center text-[11px] text-slate-400 pb-2">
        登录即代表您已同意 <span class="text-sky-600">服务条款</span> 与 <span class="text-sky-600">隐私协议</span>
      </div>
    </div>
  `
})
export class LoginComponent {
  @ViewChild('countdownBtn') countdownBtn?: CountdownBtnComponent;

  private authService = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  phone = '';
  code = '';
  debugCode = signal<string>('');
  isSendingCode = signal<boolean>(false);
  isSubmitting = signal<boolean>(false);

  isValidPhone(): boolean {
    return /^1[3-9]\d{9}$/.test(this.phone.trim());
  }

  isValidForm(): boolean {
    return this.isValidPhone() && this.code.trim().length === 6;
  }

  onSendCode(): void {
    if (!this.isValidPhone()) {
      this.toast.error('请输入正确的11位中国手机号');
      return;
    }

    this.isSendingCode.set(true);
    this.authService.sendSms(this.phone.trim()).subscribe({
      next: (res) => {
        this.isSendingCode.set(false);
        if (res.code === 0) {
          this.toast.success('验证码已发送');
          this.countdownBtn?.startCountdown(60);
          if (res.data?.debugCode) {
            this.debugCode.set(res.data.debugCode);
          }
        } else {
          this.toast.error(res.msg || '发送验证码失败');
        }
      },
      error: () => {
        this.isSendingCode.set(false);
        this.toast.error('网络请求失败，请稍后重试');
      }
    });
  }

  onSubmit(): void {
    if (!this.isValidForm()) return;

    this.isSubmitting.set(true);
    this.authService.loginWithSms(this.phone.trim(), this.code.trim()).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        if (res.code === 0) {
          this.toast.success('登录成功');
          const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/devices';
          this.router.navigateByUrl(returnUrl);
        } else {
          this.toast.error(res.msg || '登录失败');
        }
      },
      error: () => {
        this.isSubmitting.set(false);
        this.toast.error('登录请求异常，请检查网络');
      }
    });
  }
}

