import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ApiResponse } from '../models/api.model';
import { LoginResponse, SendSmsResponse, User } from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);

  private _token = signal<string | null>(this.getStoredToken());
  private _currentUser = signal<User | null>(this.getStoredUser());

  readonly token = this._token.asReadonly();
  readonly currentUser = this._currentUser.asReadonly();
  readonly isLoggedIn = computed(() => !!this._token());

  private getStoredToken(): string | null {
    try {
      return localStorage.getItem('vg_token');
    } catch {
      return null;
    }
  }

  private getStoredUser(): User | null {
    try {
      const u = localStorage.getItem('vg_user');
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  }

  sendSms(phone: string): Observable<ApiResponse<SendSmsResponse>> {
    return this.http.post<ApiResponse<SendSmsResponse>>('/api/auth/sms/send', { phone });
  }

  loginWithSms(phone: string, code: string): Observable<ApiResponse<LoginResponse>> {
    return this.http.post<ApiResponse<LoginResponse>>('/api/auth/sms/verify', { phone, code }).pipe(
      tap(res => {
        if (res.code === 0 && res.data?.token) {
          this.setSession(res.data.token, res.data.user);
        }
      })
    );
  }

  setSession(token: string, user: User): void {
    localStorage.setItem('vg_token', token);
    localStorage.setItem('vg_user', JSON.stringify(user));
    this._token.set(token);
    this._currentUser.set(user);
  }

  logout(): void {
    localStorage.removeItem('vg_token');
    localStorage.removeItem('vg_user');
    this._token.set(null);
    this._currentUser.set(null);
  }
}

