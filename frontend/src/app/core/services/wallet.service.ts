import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ApiResponse } from '../models/api.model';
import { BillsResponse, WalletResponse } from '../models/wallet.model';

@Injectable({
  providedIn: 'root'
})
export class WalletService {
  private http = inject(HttpClient);

  private _balanceSeconds = signal<number>(0);
  readonly balanceSeconds = this._balanceSeconds.asReadonly();

  readonly balanceMinutes = computed(() => Math.floor(this._balanceSeconds() / 60));
  readonly balanceHoursFormatted = computed(() => {
    const sec = this._balanceSeconds();
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h} 小时 ${m} 分钟`;
    }
    if (m > 0) {
      return `${m} 分钟 ${s} 秒`;
    }
    return `${s} 秒`;
  });

  fetchBalance(): Observable<ApiResponse<WalletResponse>> {
    return this.http.get<ApiResponse<WalletResponse>>('/api/wallet').pipe(
      tap(res => {
        if (res.code === 0 && res.data) {
          this._balanceSeconds.set(res.data.balance_sec || 0);
        }
      })
    );
  }

  fetchBills(): Observable<ApiResponse<BillsResponse>> {
    return this.http.get<ApiResponse<BillsResponse>>('/api/bills');
  }
}

