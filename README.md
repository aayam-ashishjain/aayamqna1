# Slido Clone (Turso + Express + Socket.IO + Angular 18)

Real-time audience Q&A, live polls (multiple choice, word cloud, rating, open text, speed-scored quiz), host moderation, JWT authentication, and a projector-ready Present Mode with scannable QR overlay.

## Project Layout

```text
slido-turso-angular/
├── server/
│   ├── db/turso.js
│   ├── middleware/auth.js
│   ├── middleware/qaRateLimit.js
│   ├── server.js
│   ├── .env.example
│   └── package.json
└── client/
    └── src/app/
        ├── components/
        │   ├── host-login.component.ts
        │   ├── host-dashboard.component.ts
        │   ├── host-console.component.ts
        │   ├── participant-room.component.ts
        │   └── present-view.component.ts
        ├── guards/host-auth.guard.ts
        ├── interceptors/host-auth.interceptor.ts
        └── services/
            ├── host-auth.service.ts
            └── slido-socket.service.ts
```

## 1. Backend Setup

```bash
cd server
cp .env.example .env
# Edit .env: set JWT_SECRET (required).
# Leave TURSO_DATABASE_URL blank to use local file:slido.db during dev,
# or fill in your Turso URL and token from the step below.
npm install
npm start
```

### Provision Turso (Mumbai Region)

```bash
turso auth login
turso group create india --location aws-ap-south-1
turso db create slido-app --group india
turso db show slido-app --url
turso db tokens create slido-app
```

Paste the URL and token into `server/.env`.

## 2. Frontend Setup

```bash
cd client
npm install
npm start
```

Open `http://localhost:4200/login` to register a host account, create an event, and open:
- `/host/:code` — Host moderation & poll control console
- `/present/:code` — Fullscreen projector stage (`Q` = QR overlay, `L` = leaderboard, `F` = fullscreen)
- `/join/:code` — Anonymous attendee room (linked automatically from the QR code)

## 3. Push to GitHub

```bash
git init -b main
git add .
git commit -m "Initial Slido clone: Turso, Socket.IO, Angular Present Mode, JWT auth"
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```
