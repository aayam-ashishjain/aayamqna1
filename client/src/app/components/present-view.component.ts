import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toDataURL } from 'qrcode';
import { SlidoSocketService } from '../services/slido-socket.service';

@Component({
  selector: 'app-present-view',
  standalone: true,
  template: `
    <div class="present-canvas">
      <aside class="qr-rail">
        <div class="brand-tag">Join at <strong>{{ joinHost }}</strong></div>
        <div class="join-code">#{{ slido.joinCode() }}</div>

        @if (qrDataUrl()) {
          <button class="qr-card" (click)="qrFullscreen.set(true)" title="Expand QR (Q)">
            <img [src]="qrDataUrl()" alt="Scan to join live session" />
            <span>Scan to participate</span>
          </button>
        }

        <div class="rail-meta">
          <div class="metric">
            <strong>{{ approvedQuestions().length }}</strong>
            <span>Questions</span>
          </div>
          @if (slido.activePoll()) {
            <div class="metric">
              <strong>{{ totalVotes() }}</strong>
              <span>Votes</span>
            </div>
          }
        </div>

        <div class="controls">
          <button (click)="qrFullscreen.set(true)">QR [Q]</button>
          @if (slido.leaderboard().length) {
            <button (click)="showLeaderboard.set(!showLeaderboard())">
              {{ showLeaderboard() ? 'Stage' : 'Scores' }} [L]
            </button>
          }
          <button (click)="toggleFullscreen()">Full [F]</button>
        </div>
      </aside>

      <main class="stage">
        <header class="stage-header">
          <h1>{{ slido.eventTitle() || 'Live Session' }}</h1>
          <span class="stage-pill">{{ stageLabel() }}</span>
        </header>

        @if (showLeaderboard()) {
          <section class="leaderboard-stage">
            <h2>Quiz Leaderboard</h2>
            <ol class="podium-list">
              @for (entry of slido.leaderboard().slice(0, 6); track entry.displayName; let idx = $index) {
                <li [class.leader]="idx === 0">
                  <span class="rank">#{{ idx + 1 }}</span>
                  <span class="player">{{ entry.displayName }}</span>
                  <strong class="points">{{ entry.score }} pts</strong>
                </li>
              }
            </ol>
          </section>
        } @else if (slido.activePoll(); as poll) {
          <section class="poll-stage">
            <h2 class="poll-question">{{ poll.question }}</h2>

            @if (poll.type === 'multiple_choice' || poll.type === 'quiz') {
              <div class="bar-chart">
                @for (opt of poll.options; track opt._id) {
                  <div
                    class="bar-row"
                    [class.correct]="poll.type === 'quiz' && poll.status === 'locked' && opt.isCorrect">
                    <div class="bar-label-line">
                      <span class="opt-text">{{ opt.text }}</span>
                      @if (poll.showResults) {
                        <span class="opt-stats">
                          <strong>{{ votePercent(opt.votes) }}%</strong>
                          <em>({{ opt.votes }})</em>
                        </span>
                      }
                    </div>
                    <div class="bar-track">
                      <div
                        class="bar-fill"
                        [style.width.%]="poll.showResults ? barWidth(opt.votes) : 0">
                      </div>
                    </div>
                  </div>
                }
              </div>

              @if (!poll.showResults) {
                <p class="hidden-banner">Results hidden by host — voting is open</p>
              }
            }

            @if (poll.type === 'word_cloud' || poll.type === 'open_text') {
              <div class="cloud-wall">
                @for (item of slido.wordCloud(); track item.word) {
                  <span
                    class="cloud-word"
                    [style.fontSize.rem]="wordFontRem(item.count)"
                    [style.opacity]="wordOpacity(item.count)">
                    {{ item.word }}
                  </span>
                }
              </div>
            }

            @if (poll.type === 'rating' && slido.ratingSummary(); as rs) {
              <div class="rating-stage">
                <div class="rating-score">{{ rs.average }} <span>/ 5 ★</span></div>
                <p>{{ rs.count }} audience ratings</p>
              </div>
            }

            <footer class="poll-footer">
              <span>{{ totalVotes() }} total responses</span>
              <span class="status-badge" [class.locked]="poll.status === 'locked'">
                {{ poll.status === 'locked' ? 'Voting Locked' : 'Voting Open' }}
              </span>
            </footer>
          </section>
        } @else if (highlightedQuestion(); as spotlight) {
          <section class="spotlight-stage">
            <div class="spotlight-card">
              <div class="spotlight-top">
                <span class="spotlight-tag">Live Q&amp;A Spotlight</span>
                <span class="upvote-pill">▲ {{ spotlight.upvotes }}</span>
              </div>
              <p class="spotlight-text">{{ spotlight.text }}</p>
              <div class="spotlight-author">— {{ spotlight.authorName }}</div>
            </div>
          </section>
        } @else {
          <section class="qa-wall">
            @for (q of approvedQuestions().slice(0, 4); track q._id) {
              <article class="wall-card">
                <div class="wall-votes">▲ {{ q.upvotes }}</div>
                <div class="wall-body">
                  <p>{{ q.text }}</p>
                  <small>{{ q.authorName }}</small>
                </div>
              </article>
            } @empty {
              <div class="empty-stage">
                <p>Scan the QR code to ask the first question.</p>
              </div>
            }
          </section>
        }
      </main>

      @if (qrFullscreen()) {
        <div class="qr-overlay" (click)="qrFullscreen.set(false)">
          <div class="qr-overlay-box" (click)="$event.stopPropagation()">
            <p class="overlay-kicker">Join live at {{ joinHost }}</p>
            <div class="overlay-code">#{{ slido.joinCode() }}</div>
            <img [src]="qrDataUrl()" alt="Fullscreen join QR code" />
            <button class="close-btn" (click)="qrFullscreen.set(false)">Dismiss [Esc]</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      background: #090e1a;
      color: #f8fafc;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }

    .present-canvas {
      display: grid;
      grid-template-columns: 320px 1fr;
      height: 100%;
    }

    .qr-rail {
      background: #111827;
      border-right: 1px solid #1f2937;
      padding: 2rem 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
    }

    .brand-tag { font-size: 1.05rem; color: #94a3b8; text-align: center; }
    .brand-tag strong { color: #f8fafc; display: block; margin-top: 0.2rem; }
    .join-code { font-size: 2.5rem; font-weight: 800; letter-spacing: 0.08em; color: #38bdf8; }

    .qr-card {
      background: #ffffff;
      border: none;
      border-radius: 16px;
      padding: 1rem;
      width: 100%;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: #0f172a;
      font-weight: 700;
      font-size: 0.95rem;
    }

    .qr-card img { width: 220px; height: 220px; display: block; }
    .rail-meta { display: flex; gap: 1.5rem; margin-top: auto; }
    .metric { text-align: center; }
    .metric strong { display: block; font-size: 2rem; color: #f8fafc; }
    .metric span { font-size: 0.85rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
    .controls { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
    .controls button {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 0.45rem 0.75rem;
      font-size: 0.85rem;
    }

    .stage { padding: 2.5rem 3.5rem; display: flex; flex-direction: column; min-width: 0; }
    .stage-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid #1e293b;
      padding-bottom: 1rem;
    }
    .stage-header h1 { margin: 0; font-size: clamp(1.5rem, 2.2vw, 2.2rem); font-weight: 700; }
    .stage-pill {
      background: #1e293b;
      color: #38bdf8;
      padding: 0.4rem 0.95rem;
      border-radius: 999px;
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .poll-stage { display: flex; flex-direction: column; flex: 1; justify-content: center; }
    .poll-question { font-size: clamp(2rem, 3.4vw, 3.2rem); line-height: 1.2; margin: 0 0 2.25rem; }
    .bar-chart { display: flex; flex-direction: column; gap: 1.4rem; }
    .bar-label-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 0.45rem;
      font-size: clamp(1.25rem, 1.9vw, 1.75rem);
    }
    .opt-stats strong { color: #38bdf8; margin-right: 0.4rem; }
    .opt-stats em { font-style: normal; color: #94a3b8; font-size: 0.85em; }
    .bar-track { height: 36px; background: #1e293b; border-radius: 10px; overflow: hidden; }
    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #0284c7, #38bdf8);
      border-radius: 10px;
      transition: width 320ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .bar-row.correct .bar-fill { background: linear-gradient(90deg, #059669, #34d399); }
    .bar-row.correct .opt-text::after { content: '  ✓'; color: #34d399; font-weight: 800; }
    .hidden-banner { margin-top: 2rem; text-align: center; color: #94a3b8; font-size: 1.4rem; }
    .poll-footer {
      margin-top: auto;
      padding-top: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 1.15rem;
      color: #94a3b8;
    }
    .status-badge { padding: 0.35rem 0.9rem; border-radius: 8px; background: #064e3b; color: #6ee7b7; font-weight: 700; }
    .status-badge.locked { background: #7f1d1d; color: #fca5a5; }
    .cloud-wall { display: flex; flex-wrap: wrap; gap: 1.2rem 1.8rem; align-items: center; justify-content: center; padding: 2rem 0; }
    .cloud-word { font-weight: 800; color: #38bdf8; line-height: 1.1; transition: font-size 250ms ease; }
    .rating-stage { text-align: center; padding: 3rem 0; }
    .rating-score { font-size: 5rem; font-weight: 900; color: #facc15; }
    .rating-score span { font-size: 2.5rem; color: #94a3b8; }

    .spotlight-stage { flex: 1; display: flex; align-items: center; justify-content: center; }
    .spotlight-card {
      background: #111827;
      border: 2px solid #38bdf8;
      border-radius: 24px;
      padding: 3rem 3.5rem;
      width: 100%;
      max-width: 980px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.55);
    }
    .spotlight-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.75rem; }
    .spotlight-tag { color: #38bdf8; font-weight: 800; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.08em; }
    .upvote-pill { background: #0284c7; color: #ffffff; padding: 0.45rem 1.1rem; border-radius: 999px; font-size: 1.35rem; font-weight: 800; }
    .spotlight-text { font-size: clamp(2.1rem, 3.8vw, 3.4rem); line-height: 1.3; margin: 0 0 2rem; font-weight: 700; }
    .spotlight-author { font-size: 1.45rem; color: #94a3b8; }

    .qa-wall { display: flex; flex-direction: column; gap: 1.25rem; }
    .wall-card {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 1.5rem;
      align-items: center;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 1.5rem 2rem;
    }
    .wall-votes { font-size: 1.75rem; font-weight: 800; color: #38bdf8; text-align: center; }
    .wall-body p { margin: 0 0 0.4rem; font-size: clamp(1.35rem, 2vw, 1.85rem); line-height: 1.3; }
    .wall-body small { font-size: 1.05rem; color: #94a3b8; }
    .empty-stage { margin: auto; font-size: 2rem; color: #64748b; }

    .leaderboard-stage h2 { font-size: 2.5rem; margin: 0 0 1.5rem; }
    .podium-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 1rem; }
    .podium-list li {
      display: grid;
      grid-template-columns: 80px 1fr auto;
      align-items: center;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 14px;
      padding: 1.2rem 1.75rem;
      font-size: 1.65rem;
    }
    .podium-list li.leader { border-color: #facc15; background: #1c1917; }
    .rank { color: #94a3b8; font-weight: 800; }
    .leader .rank { color: #facc15; }
    .points { color: #38bdf8; }

    .qr-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 14, 26, 0.92);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    .qr-overlay-box {
      background: #ffffff;
      color: #0f172a;
      border-radius: 28px;
      padding: 2.5rem 3.5rem;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }
    .overlay-kicker { margin: 0; font-size: 1.4rem; color: #475569; }
    .overlay-code { font-size: 3.5rem; font-weight: 900; letter-spacing: 0.1em; }
    .qr-overlay-box img { width: min(48vh, 420px); height: min(48vh, 420px); }
    .close-btn {
      margin-top: 0.5rem;
      background: #0f172a;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 0.7rem 1.4rem;
      font-size: 1rem;
      font-weight: 700;
    }
  `]
})
export class PresentViewComponent implements OnInit {
  slido = inject(SlidoSocketService);
  private route = inject(ActivatedRoute);

  qrDataUrl = signal('');
  qrFullscreen = signal(false);
  showLeaderboard = signal(false);
  joinHost = window.location.host;

  approvedQuestions = computed(() =>
    this.slido.questions().filter((q) => q.status === 'approved')
  );

  highlightedQuestion = computed(() =>
    this.slido.questions().find((q) => q.isHighlighted && q.status !== 'archived') || null
  );

  totalVotes = computed(() => {
    const poll = this.slido.activePoll();
    if (!poll) return 0;
    if (poll.type === 'word_cloud' || poll.type === 'open_text') {
      return this.slido.wordCloud().reduce((sum, w) => sum + w.count, 0);
    }
    if (poll.type === 'rating') {
      return this.slido.ratingSummary()?.count || 0;
    }
    return poll.options.reduce((sum, o) => sum + o.votes, 0);
  });

  maxCloudCount = computed(() =>
    Math.max(1, ...this.slido.wordCloud().map((w) => w.count))
  );

  stageLabel = computed(() => {
    if (this.showLeaderboard()) return 'Leaderboard';
    if (this.slido.activePoll()) return 'Live Poll';
    if (this.highlightedQuestion()) return 'Spotlight';
    return 'Audience Q&A';
  });

  async ngOnInit(): Promise<void> {
    const code = (this.route.snapshot.paramMap.get('code') || '').trim().toUpperCase();
    if (!code) return;

    await this.slido.joinRoom(code, 'participant');

    const joinUrl = `${window.location.origin}/join/${code}`;
    const dataUrl = await toDataURL(joinUrl, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' }
    });
    this.qrDataUrl.set(dataUrl);
  }

  votePercent(count: number): number {
    const total = this.totalVotes();
    return total ? Math.round((count / total) * 100) : 0;
  }

  barWidth(count: number): number {
    if (!count) return 0;
    return Math.max(3, this.votePercent(count));
  }

  wordFontRem(count: number): number {
    const ratio = count / this.maxCloudCount();
    return +(1.4 + ratio * 3.4).toFixed(2);
  }

  wordOpacity(count: number): number {
    const ratio = count / this.maxCloudCount();
    return +(0.55 + ratio * 0.45).toFixed(2);
  }

  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  @HostListener('window:keydown', ['$event'])
  onShortcut(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (key === 'escape') this.qrFullscreen.set(false);
    if (key === 'q') this.qrFullscreen.update((v) => !v);
    if (key === 'l' && this.slido.leaderboard().length) this.showLeaderboard.update((v) => !v);
    if (key === 'f') this.toggleFullscreen();
  }
}
