import { Routes } from '@angular/router';
import { ParticipantRoomComponent } from './components/participant-room.component';
import { HostConsoleComponent } from './components/host-console.component';
import { PresentViewComponent } from './components/present-view.component';
import { HostLoginComponent } from './components/host-login.component';
import { HostDashboardComponent } from './components/host-dashboard.component';
import { hostAuthGuard } from './guards/host-auth.guard';

export const routes: Routes = [
  { path: 'login', component: HostLoginComponent },
  { path: 'dashboard', component: HostDashboardComponent, canActivate: [hostAuthGuard] },
  { path: 'join', component: ParticipantRoomComponent },
  { path: 'join/:code', component: ParticipantRoomComponent },
  { path: 'host/:code', component: HostConsoleComponent, canActivate: [hostAuthGuard] },
  { path: 'present/:code', component: PresentViewComponent },
  { path: '', redirectTo: 'join', pathMatch: 'full' }
];
