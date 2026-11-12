import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DeviceService } from '../../core/services/device.service';
import { ToastService } from '../../core/services/toast.service';
import { HeaderComponent } from '../../shared/components/header.component';
import { Device } from '../../core/models/device.model';

@Component({
  selector: 'app-device-list',
  standalone: true,
  imports: [CommonModule, RouterLink, HeaderComponent],
  template: `
    <app-header title="我的设备" subtitle="已绑定至当前账号的语音硬件">
      <div actions>
        <a
          routerLink="/bind"
          class="px-2.5 py-1.5 bg-sky-50 text-sky-600 hover:bg-sky-100 rounded-lg text-xs font-semibold flex items-center space-x-1 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"></path>
          </svg>
          <span>绑定新设备</span>
        </a>
      </div>
    </app-header>

    <div class="p-4 space-y-3">
      @if (isLoading()) {
        <div class="py-16 text-center text-slate-400 text-xs flex flex-col items-center space-y-2">
          <svg class="animate-spin h-6 w-6 text-sky-500" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
          </svg>
          <span>加载设备列表中...</span>
        </div>
      } @else if (devices().length === 0) {
        <div class="py-16 text-center">
          <div class="w-16 h-16 bg-slate-100 text-slate-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
            </svg>
          </div>
          <h3 class="text-sm font-bold text-slate-700">暂未绑定任何设备</h3>
          <p class="text-xs text-slate-400 mt-1 max-w-xs mx-auto">请扫描硬件机身底部的二维码，或手动输入设备编号进行接入</p>
          <div class="mt-5">
            <a
              routerLink="/bind"
              class="inline-flex items-center space-x-1.5 px-4 py-2 bg-sky-600 text-white rounded-xl text-xs font-semibold shadow-sm hover:bg-sky-700 transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
              </svg>
              <span>立即绑定第一台设备</span>
            </a>
          </div>
        </div>
      } @else {
        <div class="space-y-3">
          @for (d of devices(); track d.device_id) {
            <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-sky-100 transition-colors">
              <div class="flex items-center space-x-3">
                <div class="w-11 h-11 bg-sky-50 text-sky-600 rounded-xl flex items-center justify-center shrink-0">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z"></path>
                  </svg>
                </div>
                <div>
                  <div class="flex items-center space-x-2">
                    <h4 class="text-sm font-bold text-slate-800">TXW818 语音伴侣</h4>
                    <span
                      class="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      [ngClass]="{
                        'bg-emerald-50 text-emerald-700': d.status === 'bound',
                        'bg-slate-100 text-slate-500': d.status !== 'bound'
                      }">
                      {{ d.status === 'bound' ? '已在线绑定' : d.status }}
                    </span>
                  </div>
                  <p class="text-xs text-slate-400 font-mono mt-0.5">ID: {{ d.device_id }}</p>
                </div>
              </div>

              <div>
                <a
                  routerLink="/recharge"
                  class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition-colors">
                  充时长
                </a>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `
})
export class DeviceListComponent implements OnInit {
  private deviceService = inject(DeviceService);
  private toast = inject(ToastService);

  devices = signal<Device[]>([]);
  isLoading = signal<boolean>(false);

  ngOnInit(): void {
    this.loadDevices();
  }

  loadDevices(): void {
    this.isLoading.set(true);
    this.deviceService.getMyDevices().subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.code === 0) {
          this.devices.set(res.data || []);
        } else {
          this.toast.error(res.msg || '获取设备列表失败');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.toast.error('网络请求异常');
      }
    });
  }
}

