import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { HostAuthService } from '../services/host-auth.service';

export const hostAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(HostAuthService).token();
  if (!token) return next(req);

  return next(req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  }));
};
