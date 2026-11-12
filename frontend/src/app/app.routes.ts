import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'devices'
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'bind',
    loadComponent: () => import('./features/device/bind.component').then(m => m.BindDeviceComponent)
  },
  {
    path: 'devices',
    canActivate: [authGuard],
    loadComponent: () => import('./features/device/device-list.component').then(m => m.DeviceListComponent)
  },
  {
    path: 'recharge',
    loadComponent: () => import('./features/recharge/recharge.component').then(m => m.RechargeComponent)
  },
  {
    path: 'pay/result',
    loadComponent: () => import('./features/recharge/pay-result.component').then(m => m.PayResultComponent)
  },
  {
    path: 'wallet',
    canActivate: [authGuard],
    loadComponent: () => import('./features/wallet/wallet.component').then(m => m.WalletComponent)
  },
  {
    path: '**',
    redirectTo: 'devices'
  }
];
