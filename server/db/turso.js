const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:slido.db',
  authToken: process.env.TURSO_AUTH_TOKEN || undefined
});

async function initDb() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      host_id TEXT NOT NULL,
      moderation_enabled INTEGER NOT NULL DEFAULT 0,
      active_poll_id TEXT,
      status TEXT NOT NULL DEFAULT 'live',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      client_id TEXT NOT NULL,
      upvotes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'approved',
      is_highlighted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS question_upvotes (
      question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      PRIMARY KEY (question_id, client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      allow_multiple INTEGER NOT NULL DEFAULT 0,
      timer_seconds INTEGER NOT NULL DEFAULT 0,
      show_results INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      survey_group_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS poll_options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      votes INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      option_id TEXT,
      text_value TEXT,
      rating_value INTEGER,
      response_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(poll_id, client_id)
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_scores (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (event_id, client_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_host ON events(host_id)`,
    `CREATE INDEX IF NOT EXISTS idx_questions_event ON questions(event_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_polls_event ON polls(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id)`,
    `CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes(poll_id)`
  ], 'write');
}

const mapEvent = (r) => ({
  _id: r.id,
  title: r.title,
  joinCode: r.join_code,
  hostId: r.host_id,
  moderationEnabled: Boolean(r.moderation_enabled),
  activePollId: r.active_poll_id || null,
  status: r.status,
  createdAt: r.created_at
});

const mapQuestion = (r) => ({
  _id: r.id,
  eventId: r.event_id,
  text: r.text,
  authorName: r.author_name,
  clientId: r.client_id,
  upvotes: Number(r.upvotes),
  upvotedBy: r.upvoted_by ? String(r.upvoted_by).split(',') : [],
  status: r.status,
  isHighlighted: Boolean(r.is_highlighted),
  createdAt: r.created_at
});

const mapOption = (r) => ({
  _id: r.id,
  text: r.text,
  isCorrect: Boolean(r.is_correct),
  votes: Number(r.votes)
});

const mapPoll = (r, optionRows = []) => ({
  _id: r.id,
  eventId: r.event_id,
  type: r.type,
  question: r.question,
  options: optionRows.map(mapOption),
  allowMultiple: Boolean(r.allow_multiple),
  timerSeconds: Number(r.timer_seconds),
  showResults: Boolean(r.show_results),
  status: r.status,
  surveyGroupId: r.survey_group_id || null,
  createdAt: r.created_at
});

module.exports = { db, initDb, mapEvent, mapQuestion, mapPoll };
