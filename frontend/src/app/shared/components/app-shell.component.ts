import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { ToastComponent } from './toast.component';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, ToastComponent],
  template: `
    <div class="min-h-screen bg-slate-100 flex flex-col justify-center items-center">
      <!-- Mobile Container Frame -->
      <main class="w-full max-w-md min-h-screen md:min-h-[840px] md:max-h-[90vh] bg-white flex flex-col shadow-2xl md:rounded-3xl border-slate-200/80 md:border overflow-hidden relative">
        <app-toast />

        <!-- Main Content Area -->
        <div class="flex-1 overflow-y-auto pb-20">
          <router-outlet></router-outlet>
        </div>

        <!-- Bottom Tab Bar Navigation (shown for main tabs) -->
        @if (showBottomNav()) {
          <nav class="absolute bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t border-slate-100 px-6 py-2.5 flex items-center justify-around z-20">
            <a
              routerLink="/devices"
              routerLinkActive="text-sky-600 font-semibold"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex flex-col items-center text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <svg class="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
              </svg>
              <span>设备</span>
            </a>

            <a
              routerLink="/recharge"
              routerLinkActive="text-sky-600 font-semibold"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex flex-col items-center text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <svg class="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
              </svg>
              <span>加油包</span>
            </a>

            <a
              routerLink="/wallet"
              routerLinkActive="text-sky-600 font-semibold"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex flex-col items-center text-xs text-slate-400 hover:text-slate-600 transition-colors">
              <svg class="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
              </svg>
              <span>钱包</span>
            </a>
          </nav>
        }
      </main>
    </div>
  `
})
export class AppShellComponent {
  private router = inject(Router);
  authService = inject(AuthService);

  private currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map((e: any) => e.urlAfterRedirects || e.url)
    ),
    { initialValue: this.router.url }
  );

  showBottomNav = computed(() => {
    const url = this.currentUrl() || '';
    // Show nav on /devices, /recharge, /wallet, and not on /login or /pay/result
    return url.startsWith('/devices') || url.startsWith('/recharge') || url.startsWith('/wallet');
  });
}

