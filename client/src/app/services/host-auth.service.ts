import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface HostUser {
  id: string;
  email: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class HostAuthService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;
  private readonly TOKEN_KEY = 'slido_host_jwt';

  readonly token = signal<string | null>(localStorage.getItem(this.TOKEN_KEY));
  readonly host = signal<HostUser | null>(null);
  readonly isLoggedIn = computed(() => Boolean(this.token()));

  async register(name: string, email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ token: string; host: HostUser }>(`${this.apiUrl}/api/auth/register`, { name, email, password })
    );
    this.setSession(res.token, res.host);
  }

  async login(email: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<{ token: string; host: HostUser }>(`${this.apiUrl}/api/auth/login`, { email, password })
    );
    this.setSession(res.token, res.host);
  }

  async loadProfile(): Promise<void> {
    if (!this.token()) return;
    try {
      const res = await firstValueFrom(this.http.get<{ host: HostUser }>(`${this.apiUrl}/api/auth/me`));
      this.host.set(res.host);
    } catch {
      this.logout();
    }
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    this.token.set(null);
    this.host.set(null);
  }

  private setSession(token: string, host: HostUser): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    this.token.set(token);
    this.host.set(host);
  }
}
