import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HostAuthService } from '../services/host-auth.service';
import { EventItem, SlidoSocketService } from '../services/slido-socket.service';

@Component({
  selector: 'app-host-dashboard',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="dash-shell">
      <header class="dash-header">
        <div>
          <h1>Host Events</h1>
          @if (auth.host(); as h) {
            <small>{{ h.name }} · {{ h.email }}</small>
          }
        </div>
        <button class="ghost-btn" (click)="logout()">Sign Out</button>
      </header>

      <form (ngSubmit)="createRoom()" class="create-bar">
        <input [(ngModel)]="title" name="title" placeholder="Event title (e.g. Q4 Engineering Town Hall)" required />
        <label class="toggle">
          <input type="checkbox" [(ngModel)]="moderationEnabled" name="mod" />
          Moderate Q&amp;A before publishing
        </label>
        <button type="submit" class="primary-btn">Create Room</button>
      </form>

      <section class="event-list">
        @for (ev of events(); track ev._id) {
          <article class="event-card">
            <div>
              <h3>{{ ev.title }}</h3>
              <p>Code: <strong>#{{ ev.joinCode }}</strong> · Moderation: {{ ev.moderationEnabled ? 'On' : 'Off' }}</p>
            </div>
            <div class="actions">
              <a [routerLink]="['/host', ev.joinCode]" class="btn">Host Console</a>
              <a [routerLink]="['/present', ev.joinCode]" target="_blank" class="btn secondary">Present Mode</a>
              <a [routerLink]="['/join', ev.joinCode]" target="_blank" class="btn secondary">Participant Link</a>
            </div>
          </article>
        } @empty {
          <p class="empty">No events yet. Create your first room above.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .dash-shell { max-width: 920px; margin: 2rem auto; padding: 0 1.25rem; }
    .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .dash-header h1 { margin: 0; }
    .dash-header small { color: #64748b; }
    .create-bar {
      background: #ffffff;
      padding: 1.25rem;
      border-radius: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: center;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
    }
    .create-bar input[type="text"], .create-bar input:not([type="checkbox"]) {
      flex: 1;
      min-width: 220px;
      padding: 0.7rem 0.9rem;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
    }
    .toggle { display: flex; align-items: center; gap: 0.45rem; font-size: 0.9rem; }
    .primary-btn { background: #0284c7; color: #fff; border: none; border-radius: 8px; padding: 0.75rem 1.25rem; font-weight: 700; }
    .ghost-btn { background: #e2e8f0; border: none; border-radius: 8px; padding: 0.55rem 1rem; font-weight: 600; }
    .event-list { display: flex; flex-direction: column; gap: 1rem; }
    .event-card {
      background: #ffffff;
      border-radius: 14px;
      padding: 1.25rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
    }
    .event-card h3 { margin: 0 0 0.25rem; }
    .event-card p { margin: 0; color: #475569; font-size: 0.92rem; }
    .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .btn {
      text-decoration: none;
      background: #0f172a;
      color: #ffffff;
      padding: 0.55rem 0.9rem;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 600;
    }
    .btn.secondary { background: #e2e8f0; color: #0f172a; }
    .empty { color: #64748b; text-align: center; padding: 2rem; }
  `]
})
export class HostDashboardComponent implements OnInit {
  auth = inject(HostAuthService);
  private slido = inject(SlidoSocketService);
  private router = inject(Router);

  events = signal<EventItem[]>([]);
  title = '';
  moderationEnabled = false;

  async ngOnInit(): Promise<void> {
    await this.auth.loadProfile();
    this.events.set(await this.slido.listHostEvents());
  }

  async createRoom(): Promise<void> {
    if (!this.title.trim()) return;
    const created = await this.slido.createEvent(this.title.trim(), this.moderationEnabled);
    this.events.update((list) => [created, ...list]);
    this.title = '';
  }

  async logout(): Promise<void> {
    this.auth.logout();
    this.slido.refreshSocketAuth();
    await this.router.navigate(['/login']);
  }
}
