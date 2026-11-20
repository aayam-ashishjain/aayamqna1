import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { HostAuthService } from '../services/host-auth.service';

export const hostAuthGuard: CanActivateFn = () => {
  const auth = inject(HostAuthService);
  if (auth.isLoggedIn()) return true;
  return inject(Router).createUrlTree(['/login']);
};
