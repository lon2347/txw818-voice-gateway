import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  if (authService.isLoggedIn()) {
    return true;
  }

  toast.info('请先登录账号');
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url }
  });
};

