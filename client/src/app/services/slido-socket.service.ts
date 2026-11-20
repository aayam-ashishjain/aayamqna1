import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { io, Socket } from 'socket.io-client';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { HostAuthService } from './host-auth.service';

export interface EventItem {
  _id: string;
  title: string;
  joinCode: string;
  moderationEnabled: boolean;
  activePollId: string | null;
  status: 'live' | 'ended';
  createdAt: string;
}

export interface QuestionItem {
  _id: string;
  text: string;
  authorName: string;
  upvotes: number;
  upvotedBy: string[];
  status: 'pending' | 'approved' | 'answered' | 'archived';
  isHighlighted: boolean;
}

export interface PollOption {
  _id: string;
  text: string;
  isCorrect: boolean;
  votes: number;
}

export interface PollItem {
  _id: string;
  type: 'multiple_choice' | 'word_cloud' | 'rating' | 'open_text' | 'quiz';
  question: string;
  options: PollOption[];
  status: 'draft' | 'active' | 'locked';
  showResults: boolean;
}

export interface RatingSummary {
  count: number;
  average: number;
}

@Injectable({ providedIn: 'root' })
export class SlidoSocketService {
  private http = inject(HttpClient);
  private auth = inject(HostAuthService);
  private apiUrl = environment.apiUrl;

  private socket: Socket = io(this.apiUrl, {
    auth: (cb) => cb({ token: this.auth.token() })
  });

  readonly clientId = this.getOrCreateClientId();
  readonly eventTitle = signal('');
  readonly joinCode = signal('');
  readonly questions = signal<QuestionItem[]>([]);
  readonly polls = signal<PollItem[]>([]);
  readonly activePoll = signal<PollItem | null>(null);
  readonly wordCloud = signal<{ word: string; count: number }[]>([]);
  readonly ratingSummary = signal<RatingSummary | null>(null);
  readonly leaderboard = signal<{ displayName: string; score: number; correctCount?: number }[]>([]);
  readonly errorBanner = signal<string | null>(null);

  constructor() {
    this.registerListeners();
  }

  refreshSocketAuth(): void {
    this.socket.disconnect().connect();
  }

  private getOrCreateClientId(): string {
    const key = 'slido_client_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  }

  private flashError(message: string): void {
    this.errorBanner.set(message);
    setTimeout(() => {
      if (this.errorBanner() === message) this.errorBanner.set(null);
    }, 5000);
  }

  private registerListeners(): void {
    this.socket.on('qa:new', (q: QuestionItem) => this.upsertQuestion(q));
    this.socket.on('qa:pending', (q: QuestionItem) => this.upsertQuestion(q));
    this.socket.on('qa:updated', (q: QuestionItem) => this.upsertQuestion(q));

    this.socket.on('poll:created', (poll: PollItem) => {
      this.polls.update((list) => [...list, poll]);
    });

    this.socket.on('poll:state', ({ poll, cloud, rating }: {
      poll: PollItem;
      cloud: { word: string; count: number }[] | null;
      rating: RatingSummary | null;
    }) => {
      this.polls.update((list) => list.map((p) => (p._id === poll._id ? poll : p)));
      this.activePoll.set(poll.status === 'draft' ? null : poll);
      if (cloud) this.wordCloud.set(cloud);
      if (rating) this.ratingSummary.set(rating);
    });

    this.socket.on('quiz:leaderboard', (rows) => this.leaderboard.set(rows));

    this.socket.on('qa:error', ({ message }: { message: string }) => this.flashError(message));
    this.socket.on('poll:error', ({ message }: { message: string }) => this.flashError(message));
    this.socket.on('auth:error', ({ message }: { message: string }) => this.flashError(message));

    this.socket.on('connect_error', (err) => {
      if (err.message === 'AUTH_INVALID_TOKEN') {
        this.auth.logout();
        this.refreshSocketAuth();
      }
    });
  }

  private upsertQuestion(incoming: QuestionItem): void {
    this.questions.update((list) => {
      const filtered = list.filter((q) => q._id !== incoming._id);
      if (incoming.status === 'archived') return filtered;
      return [...filtered, incoming].sort((a, b) =>
        Number(b.isHighlighted) - Number(a.isHighlighted) || b.upvotes - a.upvotes
      );
    });
  }

  listHostEvents(): Promise<EventItem[]> {
    return firstValueFrom(this.http.get<EventItem[]>(`${this.apiUrl}/api/events`));
  }

  createEvent(title: string, moderationEnabled: boolean): Promise<EventItem> {
    return firstValueFrom(
      this.http.post<EventItem>(`${this.apiUrl}/api/events`, { title, moderationEnabled })
    );
  }

  async joinRoom(code: string, role: 'participant' | 'host' = 'participant'): Promise<void> {
    const clean = code.trim().toUpperCase();
    const data: any = await firstValueFrom(
      this.http.get(`${this.apiUrl}/api/events/${clean}`)
    );

    this.joinCode.set(clean);
    this.eventTitle.set(data.event.title);
    this.questions.set(data.questions);
    this.polls.set(data.polls);
    this.leaderboard.set(data.leaderboard);
    this.wordCloud.set(data.activeCloud || []);
    this.ratingSummary.set(data.activeRating || null);

    const live = data.polls.find((p: PollItem) => p._id === data.event.activePollId) || null;
    this.activePoll.set(live);

    this.socket.emit('room:join', { joinCode: clean, role });
  }

  submitQuestion(text: string, authorName: string): void {
    this.socket.emit('qa:submit', {
      joinCode: this.joinCode(),
      text,
      authorName,
      clientId: this.clientId
    });
  }

  toggleUpvote(questionId: string): void {
    this.socket.emit('qa:upvote', {
      joinCode: this.joinCode(),
      questionId,
      clientId: this.clientId
    });
  }

  moderateQuestion(questionId: string, status?: string, isHighlighted?: boolean): void {
    this.socket.emit('qa:moderate', {
      joinCode: this.joinCode(),
      questionId,
      status,
      isHighlighted
    });
  }

  setPollState(pollId: string, status: 'draft' | 'active' | 'locked', showResults = true): void {
    this.socket.emit('poll:setActive', {
      joinCode: this.joinCode(),
      pollId,
      status,
      showResults
    });
  }

  castVote(payload: {
    pollId: string;
    optionId?: string;
    textValue?: string;
    ratingValue?: number;
    displayName?: string;
    responseMs?: number;
  }): void {
    this.socket.emit('poll:vote', {
      joinCode: this.joinCode(),
      clientId: this.clientId,
      ...payload
    });
  }

  createPoll(pollBody: Partial<PollItem>): Promise<PollItem> {
    return firstValueFrom(
      this.http.post<PollItem>(`${this.apiUrl}/api/events/${this.joinCode()}/polls`, pollBody)
    );
  }

  async downloadQaCsv(): Promise<void> {
    const blob = await firstValueFrom(
      this.http.get(`${this.apiUrl}/api/events/${this.joinCode()}/export/qa`, { responseType: 'blob' })
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.joinCode()}-qa.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
