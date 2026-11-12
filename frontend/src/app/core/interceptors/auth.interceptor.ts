import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  const token = authService.token();

  let authReq = req;
  if (token) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    map(event => {
      // 后端部分接口可能在 HTTP 200 下返回 { code: 401 }
      if (event instanceof HttpResponse) {
        const body = event.body as any;
        if (body && typeof body === 'object' && body.code === 401) {
          authService.logout();
          toast.error(body.msg || '登录已过期，请重新登录');
          router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
        }
      }
      return event;
    }),
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        authService.logout();
        toast.error('登录状态失效，请重新登录');
        router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
      }
      return throwError(() => error);
    })
  );
};

