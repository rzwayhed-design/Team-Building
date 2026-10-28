// TEAM UP server: serves the built web app and runs the real-time games.
// One process, one port, one URL — that's what makes online hosting simple.

import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { createEngine } from './engine.js';
import { catalogue } from './games.js';
import { createAimStore, ValidationError, STATUS_LABELS } from './aim/store.js';
import { timingSafeEqual, createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'events.json');
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');
// AIM question bank edits are saved next to the event data. Editing requires AIM_ADMIN_KEY.
const AIM_BANK_FILE = process.env.AIM_BANK_FILE || path.join(path.dirname(DATA_FILE), 'aim-bank.json');
const AIM_ADMIN_KEY = process.env.AIM_ADMIN_KEY || '';
// Extra origins allowed to connect (only needed if the web app is hosted on a different domain).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

// ---------- persistence (survives restarts; needs a persistent disk when hosted) ----------
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(engine.serialize()));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('Could not save events:', err.message);
  }
}
const scheduleSave = () => {
  if (!saveTimer) saveTimer = setTimeout(saveNow, 1000);
};

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const origin = (req.headers.origin || '').replace(/\/$/, '');
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});

const server = http.createServer(app);

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  try {
    const o = new URL(origin);
    if (o.host === req.headers.host) return true; // same site (normal hosted case)
    if (ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) return true;
    // Local development / office Wi-Fi: Vite dev server on another port, on localhost or a private LAN address.
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(o.hostname)) return true;
  } catch {}
  return false;
}

const io = new Server(server, {
  maxHttpBufferSize: 10_000,
  pingInterval: 20_000,
  pingTimeout: 20_000,
  cors: ALLOWED_ORIGINS.length ? { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] } : undefined,
  allowRequest: (req, cb) => cb(null, originAllowed(req)),
});

const aimStore = createAimStore({ file: AIM_BANK_FILE });

const engine = createEngine({
  aimStore,
  onUpdate: (code, state) => io.to(`event:${code}`).emit('event:update', state),
  onPrivate: (code, playerId, state) => io.to(`player:${code}:${playerId}`).emit('player:private', state),
  onChange: scheduleSave,
});

try {
  if (fs.existsSync(DATA_FILE)) {
    const n = engine.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    console.log(`Restored ${n} event(s) from ${DATA_FILE}`);
  }
} catch (err) {
  console.error('Could not restore saved events:', err.message);
}
setInterval(() => engine.sweep(), 10 * 60 * 1000).unref();

app.get('/healthz', (req, res) => res.json({ ok: true, events: engine.size }));
app.get('/api/games', (req, res) => res.json(catalogue()));
// ---------- AIM Academy Challenge: question bank API ----------
const keyHash = k => createHash('sha256').update(String(k)).digest();
function aimAdmin(req, res, next) {
  if (!AIM_ADMIN_KEY) return res.status(503).json({ error: 'Question bank editing is turned off. Set AIM_ADMIN_KEY on the server to enable it.' });
  const given = req.get('x-aim-key') || '';
  if (!timingSafeEqual(keyHash(given), keyHash(AIM_ADMIN_KEY))) {
    return setTimeout(() => res.status(401).json({ error: 'Wrong question bank key' }), 400);
  }
  next();
}
const aimJson = express.json({ limit: '2mb' });
const aimRoute = fn => (req, res) => {
  try {
    res.json(fn(req) ?? { ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
};
app.get('/api/aim/overview', aimRoute(() => ({ ...aimStore.overview(), editing: !!AIM_ADMIN_KEY })));
app.get('/api/aim/bank', aimAdmin, aimRoute(() => ({ ...aimStore.getBank(), statusLabels: STATUS_LABELS })));
app.post('/api/aim/questions', aimAdmin, aimJson, aimRoute(req => aimStore.upsertQuestion({ ...req.body, id: undefined })));
app.put('/api/aim/questions/:id', aimAdmin, aimJson, aimRoute(req => aimStore.upsertQuestion({ ...req.body, id: req.params.id })));
app.delete('/api/aim/questions/:id', aimAdmin, aimRoute(req => ({ ok: aimStore.deleteQuestion(req.params.id) })));
app.post('/api/aim/status', aimAdmin, aimJson, aimRoute(req => ({ updated: aimStore.setStatus(req.body.ids || [], req.body.status, req.body.active) })));
app.post('/api/aim/import', aimAdmin, aimJson, aimRoute(req => {
  const list = Array.isArray(req.body) ? req.body : req.body?.questions;
  return aimStore.importQuestions(list, { replace: !!req.body?.replace });
}));
app.put('/api/aim/profile', aimAdmin, aimJson, aimRoute(req => aimStore.setProfile(req.body)));
app.post('/api/aim/configs', aimAdmin, aimJson, aimRoute(req => aimStore.saveConfig(req.body)));
app.delete('/api/aim/configs/:id', aimAdmin, aimRoute(req => aimStore.deleteConfig(req.params.id)));
app.post('/api/aim/reset', aimAdmin, aimRoute(() => aimStore.resetToDefaults()));
app.get('/api/aim/verify-key', aimAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/events/:code', (req, res) => {
  const e = engine.getPublic(req.params.code);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  res.json(e);
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res.type('text').send('TEAM UP server is running. In development open the Vite app on port 5173; for production run "npm run build" first.'),
  );
}

// ---------- simple abuse protection ----------
const clientIp = socket =>
  String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
const createLog = new Map(); // ip -> timestamps of event creations
function canCreate(ip) {
  const hour = Date.now() - 60 * 60 * 1000;
  const list = (createLog.get(ip) || []).filter(t => t > hour);
  if (list.length >= 20) return false;
  list.push(Date.now());
  createLog.set(ip, list);
  return true;
}
setInterval(() => {
  const hour = Date.now() - 60 * 60 * 1000;
  for (const [ip, list] of createLog) if (!list.some(t => t > hour)) createLog.delete(ip);
}, 15 * 60 * 1000).unref();

// ---------- sockets ----------
io.on('connection', socket => {
  const bucket = { tokens: 30, at: Date.now() };
  const allow = () => {
    const t = Date.now();
    bucket.tokens = Math.min(30, bucket.tokens + ((t - bucket.at) / 1000) * 5);
    bucket.at = t;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };

  // Wraps every handler: rate limit, safe payload, always reply.
  const on = (name, fn) =>
    socket.on(name, (data, reply) => {
      const respond = typeof reply === 'function' ? reply : () => {};
      if (!allow()) return respond({ error: 'Too many actions, slow down a little' });
      try {
        respond(fn(data && typeof data === 'object' ? data : {}) || { ok: true });
      } catch (err) {
        console.error(`Error in ${name}:`, err);
        respond({ error: 'Something went wrong' });
      }
    });

  const leaveCurrent = () => {
    const p = socket.data.player;
    if (p) {
      engine.disconnect(p.code, p.id);
      socket.leave(`player:${p.code}:${p.id}`);
    }
    for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
    socket.data.player = null;
    socket.data.host = null;
  };

  const attachHost = (code, secret) => {
    leaveCurrent();
    socket.data.host = { code, secret };
    socket.join(`event:${code}`);
    socket.emit('event:update', engine.getPublic(code));
  };

  on('host:create', ({ title, arena, teamCount }) => {
    if (!canCreate(clientIp(socket))) return { error: 'Too many events created from this network. Try again later.' };
    const r = engine.createEvent({ title, arena, teamCount });
    if (r.ok) attachHost(r.code, r.secret);
    return r;
  });

  on('host:resume', ({ code, secret }) => {
    const r = engine.authorizeHost(code, secret);
    if (r.ok) attachHost(r.code, secret);
    return r;
  });

  on('player:join', ({ code, name, playerId }) => {
    const r = engine.joinPlayer({ code, name, playerId });
    if (!r.ok) return r;
    leaveCurrent();
    socket.data.player = { code: r.code, id: r.playerId };
    socket.join(`event:${r.code}`);
    socket.join(`player:${r.code}:${r.playerId}`);
    engine.connect(r.code, r.playerId); // broadcasts state + sends this player's clues
    return r;
  });

  on('player:answer', ({ choice }) => {
    const p = socket.data.player;
    if (!p) return { error: 'You are not in an event' };
    return engine.answer({ code: p.code, playerId: p.id, choice });
  });

  const player = fn => d => {
    const p = socket.data.player;
    if (!p) return { error: 'You are not in an event' };
    return fn(p, d);
  };
  on('aim:answer', player((p, d) => engine.aim.answer(p.code, p.id, d)));
  on('aim:proposal', player((p, d) => engine.aim.saveProposal(p.code, p.id, d)));
  on('aim:vote', player((p, d) => engine.aim.vote(p.code, p.id, d.team)));

  on('player:leave', () => {
    const p = socket.data.player;
    leaveCurrent();
    return { ok: true, left: p?.code };
  });

  const host = (fn) => () => {
    const h = socket.data.host;
    if (!h) return { error: 'Not authorized' };
    return fn(h);
  };
  on('host:start', d => host(h => engine.startGame(h.code, h.secret, d.gameId, d.options || {}))());
  on('host:teamCount', d => host(h => engine.setTeamCount(h.code, h.secret, d.count))());
  on('host:shuffleTeams', host(h => engine.shuffleTeams(h.code, h.secret)));
  // AIM Academy Challenge
  on('aim:next', host(h => engine.aim.next(h.code, h.secret)));
  on('aim:scoreItem', d => host(h => engine.aim.scoreItem(h.code, h.secret, d))());
  on('aim:scoreProposal', d => host(h => engine.aim.scoreProposal(h.code, h.secret, d))());
  on('host:endRound', host(h => engine.endRoundNow(h.code, h.secret)));
  on('host:next', host(h => engine.next(h.code, h.secret)));
  on('host:lobby', d => host(h => engine.backToLobby(h.code, h.secret, { resetScores: !!d.resetScores }))());
  on('host:renameTeam', d => host(h => engine.renameTeam(h.code, h.secret, Number(d.team), d.name))());
  on('host:movePlayer', d => host(h => engine.movePlayer(h.code, h.secret, String(d.playerId), Number(d.team)))());
  on('host:removePlayer', d =>
    host(h => {
      const r = engine.removePlayer(h.code, h.secret, String(d.playerId));
      if (r.ok) {
        const room = `player:${h.code}:${r.removed}`;
        io.to(room).emit('player:removed');
        io.in(room).socketsLeave([room, `event:${h.code}`]);
      }
      return r;
    })(),
  );
  on('host:endEvent', host(h => engine.endEvent(h.code, h.secret)));

  socket.on('disconnect', () => {
    const p = socket.data.player;
    if (p) engine.disconnect(p.code, p.id);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`TEAM UP running on port ${PORT}`));

function shutdown() {
  saveNow();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
