require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { db, initDb, mapEvent, mapQuestion, mapPoll } = require('./db/turso');
const { signHostToken, verifyHostToken, requireHost, optionalHost } = require('./middleware/auth');
const { checkQaRateLimit } = require('./middleware/qaRateLimit');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:4200' }));
app.use(express.json());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Try again in 15 minutes.' }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:4200' }
});

const generateCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const isUniqueViolation = (err) =>
  String(err?.code || '').includes('SQLITE_CONSTRAINT') ||
  String(err?.message || '').includes('UNIQUE constraint failed');

async function getEventByCode(code) {
  const res = await db.execute({
    sql: 'SELECT * FROM events WHERE join_code = ?',
    args: [String(code || '').toUpperCase()]
  });
  return res.rows[0] || null;
}

async function getQuestionById(questionId) {
  const res = await db.execute({
    sql: `SELECT q.*, GROUP_CONCAT(u.client_id) AS upvoted_by
          FROM questions q
          LEFT JOIN question_upvotes u ON u.question_id = q.id
          WHERE q.id = ?
          GROUP BY q.id`,
    args: [questionId]
  });
  return res.rows[0] ? mapQuestion(res.rows[0]) : null;
}

async function getPollWithOptions(pollId) {
  const [pollRes, optRes] = await db.batch([
    { sql: 'SELECT * FROM polls WHERE id = ?', args: [pollId] },
    { sql: 'SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order ASC', args: [pollId] }
  ], 'read');
  return pollRes.rows[0] ? mapPoll(pollRes.rows[0], optRes.rows) : null;
}

async function buildWordCloud(pollId) {
  const res = await db.execute({
    sql: `SELECT LOWER(TRIM(text_value)) AS word, COUNT(*) AS count
          FROM votes
          WHERE poll_id = ? AND text_value IS NOT NULL AND TRIM(text_value) != ''
          GROUP BY LOWER(TRIM(text_value))
          ORDER BY count DESC
          LIMIT 50`,
    args: [pollId]
  });
  return res.rows.map((r) => ({ word: r.word, count: Number(r.count) }));
}

async function buildRatingSummary(pollId) {
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS count, COALESCE(AVG(rating_value), 0) AS avg
          FROM votes
          WHERE poll_id = ? AND rating_value IS NOT NULL`,
    args: [pollId]
  });
  const row = res.rows[0] || { count: 0, avg: 0 };
  return { count: Number(row.count), average: Number(Number(row.avg).toFixed(2)) };
}

async function getLeaderboard(eventId, limit = 10) {
  const res = await db.execute({
    sql: `SELECT display_name, score, correct_count
          FROM quiz_scores
          WHERE event_id = ?
          ORDER BY score DESC
          LIMIT ?`,
    args: [eventId, limit]
  });
  return res.rows.map((r) => ({
    displayName: r.display_name,
    score: Number(r.score),
    correctCount: Number(r.correct_count)
  }));
}

function getSocketIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address;
}

async function buildPollPayload(poll) {
  const cloud = poll.type === 'word_cloud' || poll.type === 'open_text'
    ? await buildWordCloud(poll._id)
    : null;
  const rating = poll.type === 'rating'
    ? await buildRatingSummary(poll._id)
    : null;
  return { poll, cloud, rating };
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');

  if (!email || !name || password.length < 8) {
    return res.status(400).json({ error: 'Name, valid email, and 8+ char password are required' });
  }

  try {
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await db.execute({
      sql: 'INSERT INTO hosts (id, email, name, password_hash) VALUES (?, ?, ?, ?)',
      args: [id, email, name, passwordHash]
    });

    const host = { id, email, name };
    res.status(201).json({ token: signHostToken(host), host });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const resDb = await db.execute({
    sql: 'SELECT id, email, name, password_hash FROM hosts WHERE email = ?',
    args: [email]
  });
  const row = resDb.rows[0];
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, String(row.password_hash));
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const host = { id: row.id, email: row.email, name: row.name };
  res.json({ token: signHostToken(host), host });
});

app.get('/api/auth/me', requireHost, (req, res) => {
  res.json({ host: { id: req.hostUser.sub, email: req.hostUser.email, name: req.hostUser.name } });
});

app.get('/api/events', requireHost, async (req, res) => {
  const resDb = await db.execute({
    sql: 'SELECT * FROM events WHERE host_id = ? ORDER BY created_at DESC',
    args: [req.hostUser.sub]
  });
  res.json(resDb.rows.map(mapEvent));
});

app.post('/api/events', requireHost, async (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const id = crypto.randomUUID();
  const joinCode = generateCode();

  await db.execute({
    sql: `INSERT INTO events (id, title, join_code, host_id, moderation_enabled)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, title, joinCode, req.hostUser.sub, req.body.moderationEnabled ? 1 : 0]
  });

  const row = await getEventByCode(joinCode);
  res.status(201).json(mapEvent(row));
});

app.get('/api/events/:code', optionalHost, async (req, res) => {
  const eventRow = await getEventByCode(req.params.code);
  if (!eventRow) return res.status(404).json({ error: 'Room not found' });

  const isVerifiedOwner = Boolean(req.hostUser && req.hostUser.sub === eventRow.host_id);
  const statusClause = isVerifiedOwner
    ? `q.status != 'archived'`
    : `q.status IN ('approved', 'answered')`;

  const [qRes, pRes, optRes, lbRes] = await db.batch([
    {
      sql: `SELECT q.*, GROUP_CONCAT(u.client_id) AS upvoted_by
            FROM questions q
            LEFT JOIN question_upvotes u ON u.question_id = q.id
            WHERE q.event_id = ? AND ${statusClause}
            GROUP BY q.id
            ORDER BY q.is_highlighted DESC, q.upvotes DESC, q.created_at DESC`,
      args: [eventRow.id]
    },
    { sql: 'SELECT * FROM polls WHERE event_id = ? ORDER BY created_at ASC', args: [eventRow.id] },
    {
      sql: `SELECT o.* FROM poll_options o
            INNER JOIN polls p ON p.id = o.poll_id
            WHERE p.event_id = ?
            ORDER BY o.sort_order ASC`,
      args: [eventRow.id]
    },
    {
      sql: `SELECT display_name, score, correct_count
            FROM quiz_scores
            WHERE event_id = ?
            ORDER BY score DESC
            LIMIT 20`,
      args: [eventRow.id]
    }
  ], 'read');

  const optionsByPoll = new Map();
  for (const opt of optRes.rows) {
    const list = optionsByPoll.get(opt.poll_id) || [];
    list.push(opt);
    optionsByPoll.set(opt.poll_id, list);
  }

  const polls = pRes.rows.map((p) => mapPoll(p, optionsByPoll.get(p.id) || []));
  const activePoll = polls.find((p) => p._id === eventRow.active_poll_id) || null;
  const activeCloud = activePoll && (activePoll.type === 'word_cloud' || activePoll.type === 'open_text')
    ? await buildWordCloud(activePoll._id)
    : [];
  const activeRating = activePoll && activePoll.type === 'rating'
    ? await buildRatingSummary(activePoll._id)
    : null;

  res.json({
    event: mapEvent(eventRow),
    isOwner: isVerifiedOwner,
    questions: qRes.rows.map(mapQuestion),
    polls,
    activeCloud,
    activeRating,
    leaderboard: lbRes.rows.map((r) => ({
      displayName: r.display_name,
      score: Number(r.score),
      correctCount: Number(r.correct_count)
    }))
  });
});

app.post('/api/events/:code/polls', requireHost, async (req, res) => {
  const eventRow = await getEventByCode(req.params.code);
  if (!eventRow) return res.status(404).json({ error: 'Room not found' });
  if (eventRow.host_id !== req.hostUser.sub) {
    return res.status(403).json({ error: 'Only the event host can create polls' });
  }

  const pollId = crypto.randomUUID();
  const options = Array.isArray(req.body.options) ? req.body.options : [];

  await db.batch([
    {
      sql: `INSERT INTO polls (id, event_id, type, question, allow_multiple, timer_seconds, show_results, survey_group_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        pollId,
        eventRow.id,
        req.body.type,
        req.body.question,
        req.body.allowMultiple ? 1 : 0,
        Number(req.body.timerSeconds || 0),
        req.body.showResults === false ? 0 : 1,
        req.body.surveyGroupId || null
      ]
    },
    ...options.map((opt, idx) => ({
      sql: `INSERT INTO poll_options (id, poll_id, text, is_correct, votes, sort_order)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: [crypto.randomUUID(), pollId, opt.text, opt.isCorrect ? 1 : 0, idx]
    }))
  ], 'write');

  const poll = await getPollWithOptions(pollId);
  io.to(`host:${eventRow.join_code}`).emit('poll:created', poll);
  res.status(201).json(poll);
});

app.get('/api/events/:code/export/qa', requireHost, async (req, res) => {
  const eventRow = await getEventByCode(req.params.code);
  if (!eventRow) return res.status(404).json({ error: 'Room not found' });
  if (eventRow.host_id !== req.hostUser.sub) {
    return res.status(403).json({ error: 'Only the event host can export Q&A' });
  }

  const qRes = await db.execute({
    sql: 'SELECT author_name, status, upvotes, text, created_at FROM questions WHERE event_id = ? ORDER BY upvotes DESC',
    args: [eventRow.id]
  });

  const header = 'Author,Status,Upvotes,Question,CreatedAt\n';
  const body = qRes.rows.map((q) =>
    `"${String(q.author_name).replace(/"/g, '""')}",${q.status},${q.upvotes},"${String(q.text).replace(/"/g, '""')}",${q.created_at}`
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${eventRow.join_code}-qa.csv"`);
  res.send(header + body);
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.data.host = null;
    return next();
  }

  try {
    socket.data.host = verifyHostToken(token);
    return next();
  } catch {
    return next(new Error('AUTH_INVALID_TOKEN'));
  }
});

async function assertHostOwnsEvent(socket, joinCode) {
  const eventRow = await getEventByCode(joinCode);
  if (!eventRow) return null;

  if (!socket.data.host || socket.data.host.sub !== eventRow.host_id) {
    socket.emit('auth:error', { message: 'Host privileges required for this room.' });
    return null;
  }
  return eventRow;
}

io.on('connection', (socket) => {
  socket.on('room:join', async ({ joinCode, role }) => {
    const eventRow = await getEventByCode(joinCode);
    if (!eventRow) return;

    socket.join(eventRow.join_code);

    if (role === 'host') {
      if (socket.data.host && socket.data.host.sub === eventRow.host_id) {
        socket.join(`host:${eventRow.join_code}`);
      } else {
        socket.emit('auth:error', { message: 'Host channel denied: invalid credentials.' });
      }
    }
  });

  socket.on('qa:submit', async ({ joinCode, text, authorName, clientId }) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    const verdict = checkQaRateLimit(clientId, getSocketIp(socket));
    if (!verdict.allowed) {
      socket.emit('qa:error', { message: verdict.reason, retrySec: verdict.retrySec });
      return;
    }

    const eventRow = await getEventByCode(joinCode);
    if (!eventRow) return;

    const id = crypto.randomUUID();
    const status = eventRow.moderation_enabled ? 'pending' : 'approved';

    await db.execute({
      sql: `INSERT INTO questions (id, event_id, text, author_name, client_id, status)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, eventRow.id, cleanText.slice(0, 300), (authorName?.trim() || 'Anonymous').slice(0, 40), clientId, status]
    });

    const question = await getQuestionById(id);
    if (status === 'approved') {
      io.to(eventRow.join_code).emit('qa:new', question);
    } else {
      io.to(`host:${eventRow.join_code}`).emit('qa:pending', question);
    }
  });

  socket.on('qa:upvote', async ({ joinCode, questionId, clientId }) => {
    const tx = await db.transaction('write');
    try {
      const exists = await tx.execute({ sql: 'SELECT id FROM questions WHERE id = ?', args: [questionId] });
      if (!exists.rows.length) {
        await tx.rollback();
        return;
      }

      const removed = await tx.execute({
        sql: 'DELETE FROM question_upvotes WHERE question_id = ? AND client_id = ?',
        args: [questionId, clientId]
      });

      if (removed.rowsAffected > 0) {
        await tx.execute({ sql: 'UPDATE questions SET upvotes = MAX(0, upvotes - 1) WHERE id = ?', args: [questionId] });
      } else {
        await tx.execute({ sql: 'INSERT INTO question_upvotes (question_id, client_id) VALUES (?, ?)', args: [questionId, clientId] });
        await tx.execute({ sql: 'UPDATE questions SET upvotes = upvotes + 1 WHERE id = ?', args: [questionId] });
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      tx.close();
    }

    const updated = await getQuestionById(questionId);
    if (updated) io.to(String(joinCode).toUpperCase()).emit('qa:updated', updated);
  });

  socket.on('qa:moderate', async ({ joinCode, questionId, status, isHighlighted }) => {
    const eventRow = await assertHostOwnsEvent(socket, joinCode);
    if (!eventRow) return;

    const stmts = [];
    if (isHighlighted === true) {
      stmts.push({ sql: 'UPDATE questions SET is_highlighted = 0 WHERE event_id = ?', args: [eventRow.id] });
    }

    const sets = [];
    const args = [];
    if (status) { sets.push('status = ?'); args.push(status); }
    if (typeof isHighlighted === 'boolean') { sets.push('is_highlighted = ?'); args.push(isHighlighted ? 1 : 0); }

    if (sets.length) {
      args.push(questionId);
      stmts.push({ sql: `UPDATE questions SET ${sets.join(', ')} WHERE id = ?`, args });
      await db.batch(stmts, 'write');
    }

    const updated = await getQuestionById(questionId);
    if (updated) io.to(eventRow.join_code).emit('qa:updated', updated);
  });

  socket.on('poll:setActive', async ({ joinCode, pollId, status, showResults }) => {
    const eventRow = await assertHostOwnsEvent(socket, joinCode);
    if (!eventRow) return;

    const sets = [];
    const args = [];
    if (status) { sets.push('status = ?'); args.push(status); }
    if (typeof showResults === 'boolean') { sets.push('show_results = ?'); args.push(showResults ? 1 : 0); }

    const activePollId = status === 'active' || status === 'locked' ? pollId : null;
    const stmts = [];
    if (sets.length) {
      args.push(pollId);
      stmts.push({ sql: `UPDATE polls SET ${sets.join(', ')} WHERE id = ?`, args });
    }
    stmts.push({ sql: 'UPDATE events SET active_poll_id = ? WHERE id = ?', args: [activePollId, eventRow.id] });

    await db.batch(stmts, 'write');

    const poll = await getPollWithOptions(pollId);
    if (!poll) return;

    io.to(eventRow.join_code).emit('poll:state', await buildPollPayload(poll));
  });

  socket.on('poll:vote', async ({ joinCode, pollId, clientId, displayName, optionId, textValue, ratingValue, responseMs }) => {
    const code = String(joinCode || '').toUpperCase();
    const poll = await getPollWithOptions(pollId);
    if (!poll || poll.status !== 'active') return;

    const stmts = [{
      sql: `INSERT INTO votes (id, poll_id, event_id, client_id, option_id, text_value, rating_value, response_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(), poll._id, poll.eventId, clientId, optionId || null,
        textValue ? String(textValue).trim().slice(0, 200) : null,
        ratingValue ? Number(ratingValue) : null,
        Number(responseMs || 0)
      ]
    }];

    if (optionId && ['multiple_choice', 'quiz'].includes(poll.type)) {
      stmts.push({ sql: 'UPDATE poll_options SET votes = votes + 1 WHERE id = ? AND poll_id = ?', args: [optionId, poll._id] });
    }

    if (poll.type === 'quiz' && optionId) {
      const chosen = poll.options.find((o) => o._id === optionId);
      const isRight = Boolean(chosen?.isCorrect);
      const speedBonus = isRight ? Math.max(100, 1000 - Math.floor(Number(responseMs || 0) / 20)) : 0;

      stmts.push({
        sql: `INSERT INTO quiz_scores (event_id, client_id, display_name, score, correct_count)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(event_id, client_id) DO UPDATE SET
                score = score + excluded.score,
                correct_count = correct_count + excluded.correct_count`,
        args: [poll.eventId, clientId, displayName || 'Player', speedBonus, isRight ? 1 : 0]
      });
    }

    try {
      await db.batch(stmts, 'write');
    } catch (err) {
      if (isUniqueViolation(err)) {
        socket.emit('poll:error', { message: 'Already voted on this poll.' });
        return;
      }
      throw err;
    }

    const updatedPoll = await getPollWithOptions(poll._id);
    io.to(code).emit('poll:state', await buildPollPayload(updatedPoll));

    if (poll.type === 'quiz') {
      io.to(code).emit('quiz:leaderboard', await getLeaderboard(poll.eventId, 10));
    }
  });
});

initDb()
  .then(() => {
    const port = process.env.PORT || 3000;
    server.listen(port, () => console.log(`Authenticated Turso server listening on :${port}`));
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
