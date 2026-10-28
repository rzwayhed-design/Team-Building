// Event/game state machine. No networking here, so it can be tested on its own.
// index.js wires it to Socket.io; callbacks tell it what to broadcast.

import { randomBytes } from 'crypto';
import { getGame } from './games.js';
import { createAim } from './aim/engine.js';

export const LIMITS = {
  maxEvents: 500,
  maxPlayersPerEvent: 300,
  minTeams: 2,
  maxTeams: 6,
  eventTtlMs: 24 * 60 * 60 * 1000, // events idle for 24h are removed
};

const TEAM_NAMES = ['Team Red', 'Team Blue', 'Team Green', 'Team Gold', 'Team Purple', 'Team Orange'];
const hex = n => randomBytes(n).toString('hex');
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function createEngine({
  onUpdate = () => {}, // (code, publicState) -> broadcast to everyone in the event
  onPrivate = () => {}, // (code, playerId, privateState) -> send to one player
  onChange = () => {}, // state changed; persist if you want
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  aimStore = null, // AIM Academy Challenge question bank (optional)
} = {}) {
  const events = new Map();
  const timers = new Map();
  const connections = new Map(); // `${code}:${playerId}` -> open socket count (not persisted)
  const isConnected = (code, playerId) => (connections.get(`${code}:${playerId}`) || 0) > 0;

  const find = code => events.get(String(code || '').toUpperCase().trim());
  const scenarioOf = e => (e.gameId ? getGame(e.gameId)?.scenarios[e.round] : null);
  const teamsInPlay = e => e.teams.map((_, i) => i).filter(i => [...Object.values(e.players)].some(p => p.team === i));

  function publicState(e) {
    const g = e.gameId ? getGame(e.gameId) : null;
    const s = e.status === 'playing' || e.status === 'review' ? scenarioOf(e) : null;
    return {
      code: e.code,
      title: e.title,
      arena: e.arena,
      status: e.status,
      gameId: e.gameId,
      round: e.round,
      roundTotal: g ? g.scenarios.length : 0,
      deadline: e.deadline,
      serverNow: now(),
      players: Object.values(e.players).map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        score: p.score,
        connected: (connections.get(`${e.code}:${p.id}`) || 0) > 0,
      })),
      teams: e.teams,
      answeredTeams: Object.keys(e.answers).map(Number),
      results: e.results,
      scenario: s ? { question: s.question, choices: s.choices, hasClues: !!s.clues } : null,
      aim: e.gameId === 'aim' && aim ? aim.publicState(e) : null,
    };
  }

  function privateState(e, playerId) {
    const s = scenarioOf(e);
    const clues = e.status === 'playing' && s?.clues ? e.clueAssignments[playerId] || [] : [];
    const aimState = e.gameId === 'aim' && aim ? aim.privateState(e, playerId) : null;
    return { code: e.code, round: e.round, clues, aim: aimState };
  }

  function publish(e) {
    e.updatedAt = now();
    onUpdate(e.code, publicState(e));
    onChange();
  }

  function sendPrivateToAll(e) {
    for (const id of Object.keys(e.players)) onPrivate(e.code, id, privateState(e, id));
  }

  const aim = aimStore
    ? createAim({
        store: aimStore,
        now,
        setTimer,
        clearTimer,
        publish,
        sendPrivateAll: sendPrivateToAll,
        isConnected,
        onFinish: e => {
          e.status = 'gameover';
        },
      })
    : null;

  // Spread every clue across the team, whatever its size:
  // 1 player gets all 4 clues, 2 players get 2 each, 6 players: everyone gets one (some repeat).
  function assignClues(e) {
    e.clueAssignments = {};
    const s = scenarioOf(e);
    if (!s?.clues) return;
    e.teams.forEach((_, t) => {
      const members = Object.values(e.players)
        .filter(p => p.team === t)
        .sort((a, b) => a.joinedAt - b.joinedAt);
      const n = members.length;
      if (!n) return;
      members.forEach(p => (e.clueAssignments[p.id] = []));
      if (n <= s.clues.length) {
        s.clues.forEach((c, i) => e.clueAssignments[members[i % n].id].push(c));
      } else {
        members.forEach((p, j) => e.clueAssignments[p.id].push(s.clues[j % s.clues.length]));
      }
    });
  }

  function clearRoundTimer(e) {
    const t = timers.get(e.code);
    if (t) clearTimer(t);
    timers.delete(e.code);
  }

  function scheduleRoundEnd(e) {
    clearRoundTimer(e);
    const token = e.roundToken;
    const wait = Math.max(0, e.deadline - now()) + 250;
    timers.set(e.code, setTimer(() => finishRound(e.code, token), wait));
  }

  function startRound(e) {
    const g = getGame(e.gameId);
    e.answers = {};
    e.status = 'playing';
    e.roundToken += 1;
    e.deadline = now() + g.duration * 1000;
    assignClues(e);
    scheduleRoundEnd(e);
    sendPrivateToAll(e); // clues first, so phones never show the question without them
    publish(e);
  }

  // `token` guards against a stale timer finishing a newer round (e.g. after a reset).
  function finishRound(code, token) {
    const e = find(code);
    if (!e || e.status !== 'playing') return;
    if (token !== undefined && token !== e.roundToken) return;
    clearRoundTimer(e);
    const s = scenarioOf(e);
    const answers = e.teams.map((t, team) => {
      const a = e.answers[team];
      const correct = a !== undefined && a.choice === s.answer;
      return {
        team,
        answered: a !== undefined,
        answer: a !== undefined ? s.choices[a.choice] : null,
        by: a?.by ?? null,
        correct,
        points: correct ? 100 : 0,
      };
    });
    for (const a of answers) {
      if (!a.correct) continue;
      e.teams[a.team].score += 100;
      for (const p of Object.values(e.players)) if (p.team === a.team) p.score += 100;
    }
    e.results.push({
      round: e.round + 1,
      question: s.question,
      answer: s.choices[s.answer],
      explanation: s.explanation || '',
      answers,
    });
    e.status = 'review';
    e.deadline = null;
    publish(e);
    sendPrivateToAll(e); // clears clues on phones
  }

  // ---- Public API (every method returns { ok } or { error }) ----

  function createEvent({ title, arena, teamCount } = {}) {
    if (events.size >= LIMITS.maxEvents) return { error: 'Server is busy, please try again later' };
    let code;
    do code = hex(3).toUpperCase();
    while (events.has(code));
    const n = Math.min(LIMITS.maxTeams, Math.max(LIMITS.minTeams, parseInt(teamCount, 10) || 2));
    const e = {
      code,
      secret: hex(20),
      title: clean(title, 80) || 'Team Up Event',
      arena: ['sales', 'aim'].includes(arena) ? arena : 'general',
      status: 'lobby',
      gameId: null,
      round: 0,
      roundToken: 0,
      deadline: null,
      teams: TEAM_NAMES.slice(0, n).map(name => ({ name, score: 0 })),
      players: {},
      answers: {},
      clueAssignments: {},
      results: [],
      createdAt: now(),
      updatedAt: now(),
    };
    events.set(code, e);
    publish(e);
    return { ok: true, code, secret: e.secret };
  }

  function authorizeHost(code, secret) {
    const e = find(code);
    if (!e || typeof secret !== 'string' || e.secret !== secret) return { error: 'This event no longer exists or the host link is invalid' };
    return { ok: true, code: e.code };
  }

  function hostAction(code, secret, fn) {
    const auth = authorizeHost(code, secret);
    if (auth.error) return auth;
    return fn(find(code));
  }

  function joinPlayer({ code, name, playerId } = {}) {
    const e = find(code);
    if (!e) return { error: 'Event not found. Check the code.' };
    if (e.status === 'finished') return { error: 'This event has ended' };
    let p = typeof playerId === 'string' ? e.players[playerId] : null;
    if (!p) {
      const cleanName = clean(name, 30);
      if (!cleanName) return { error: 'Please enter your name' };
      if (Object.keys(e.players).length >= LIMITS.maxPlayersPerEvent) return { error: 'This event is full' };
      // Late joiners are allowed; they go to the smallest team.
      const counts = e.teams.map((_, i) => Object.values(e.players).filter(q => q.team === i).length);
      const team = counts.indexOf(Math.min(...counts));
      p = { id: hex(12), name: cleanName, team, score: 0, joinedAt: now() };
      e.players[p.id] = p;
    }
    return { ok: true, code: e.code, playerId: p.id, team: p.team };
  }

  function connect(code, playerId) {
    const e = find(code);
    if (!e || !e.players[playerId]) return;
    const k = `${e.code}:${playerId}`;
    connections.set(k, (connections.get(k) || 0) + 1);
    publish(e);
    onPrivate(e.code, playerId, privateState(e, playerId));
  }

  function disconnect(code, playerId) {
    const e = find(code);
    if (!e) return;
    const k = `${e.code}:${playerId}`;
    const n = (connections.get(k) || 1) - 1;
    if (n <= 0) connections.delete(k);
    else connections.set(k, n);
    publish(e);
  }

  function startGame(code, secret, gameId, options = {}) {
    return hostAction(code, secret, e => {
      if (gameId === 'aim') {
        if (!aim) return { error: 'The AIM Academy Challenge is not available on this server' };
        if (Object.keys(e.players).length < 2) return { error: 'At least 2 players are needed to start' };
        if (teamsInPlay(e).length < 2) return { error: 'At least 2 teams need players' };
        e.teams.forEach(t => (t.score = 0));
        Object.values(e.players).forEach(p => (p.score = 0));
        const r = aim.start(e, options);
        if (r.error) return r;
        clearRoundTimer(e);
        e.gameId = 'aim';
        e.round = 0;
        e.results = [];
        e.answers = {};
        e.status = 'playing';
        e.deadline = null;
        publish(e);
        sendPrivateToAll(e);
        return { ok: true };
      }
      const g = getGame(gameId);
      const arenaOk = g && (g.arena === e.arena || (e.arena === 'aim' && g.arena === 'general'));
      if (!arenaOk) return { error: 'Invalid game' };
      if (Object.keys(e.players).length < 2) return { error: 'At least 2 players are needed to start' };
      if (teamsInPlay(e).length < 2) return { error: 'At least 2 teams need players' };
      e.gameId = g.id;
      e.round = 0;
      e.results = [];
      e.teams.forEach(t => (t.score = 0));
      Object.values(e.players).forEach(p => (p.score = 0));
      startRound(e);
      return { ok: true };
    });
  }

  function answer({ code, playerId, choice } = {}) {
    const e = find(code);
    if (!e || e.status !== 'playing' || e.gameId === 'aim') return { error: 'This round is not active' };
    const p = e.players[playerId];
    if (!p) return { error: 'Player not found' };
    if (e.answers[p.team] !== undefined) return { error: 'Your team has already answered' };
    const s = scenarioOf(e);
    if (!Number.isInteger(choice) || choice < 0 || choice >= s.choices.length) return { error: 'Invalid answer' };
    e.answers[p.team] = { choice, by: p.name };
    const inPlay = teamsInPlay(e);
    if (inPlay.every(t => e.answers[t] !== undefined)) finishRound(e.code);
    else publish(e);
    return { ok: true };
  }

  function endRoundNow(code, secret) {
    return hostAction(code, secret, e => {
      if (e.status !== 'playing' || e.gameId === 'aim') return { error: 'No round is running' };
      finishRound(e.code);
      return { ok: true };
    });
  }

  function next(code, secret) {
    return hostAction(code, secret, e => {
      if (e.status !== 'review' || e.gameId === 'aim') return { error: 'Finish the current round first' };
      e.round += 1;
      if (e.round >= getGame(e.gameId).scenarios.length) {
        e.status = 'gameover';
        publish(e);
      } else startRound(e);
      return { ok: true };
    });
  }

  // Back to the game library; team scores are kept across games so the event has an overall winner.
  function backToLobby(code, secret, { resetScores = false } = {}) {
    return hostAction(code, secret, e => {
      clearRoundTimer(e);
      if (aim && e.aim) aim.stop(e);
      delete e.aim;
      e.roundToken += 1;
      e.status = 'lobby';
      e.gameId = null;
      e.round = 0;
      e.deadline = null;
      e.answers = {};
      e.clueAssignments = {};
      e.results = [];
      if (resetScores) {
        e.teams.forEach(t => (t.score = 0));
        Object.values(e.players).forEach(p => (p.score = 0));
      }
      publish(e);
      sendPrivateToAll(e);
      return { ok: true };
    });
  }

  function renameTeam(code, secret, team, name) {
    return hostAction(code, secret, e => {
      const n = clean(name, 30);
      if (!e.teams[team] || !n) return { error: 'Invalid team name' };
      e.teams[team].name = n;
      publish(e);
      return { ok: true };
    });
  }

  function movePlayer(code, secret, playerId, team) {
    return hostAction(code, secret, e => {
      const p = e.players[playerId];
      if (!p || !e.teams[team]) return { error: 'Invalid move' };
      if (e.status === 'playing') return { error: 'Wait until the round ends' };
      p.team = team;
      publish(e);
      return { ok: true };
    });
  }

  function removePlayer(code, secret, playerId) {
    return hostAction(code, secret, e => {
      if (!e.players[playerId]) return { error: 'Player not found' };
      delete e.players[playerId];
      publish(e);
      return { ok: true, removed: playerId };
    });
  }

  function endEvent(code, secret) {
    return hostAction(code, secret, e => {
      clearRoundTimer(e);
      if (aim && e.aim) aim.stop(e);
      e.roundToken += 1;
      e.status = 'finished';
      e.deadline = null;
      publish(e);
      return { ok: true };
    });
  }

  // Lobby team setup: change the number of teams, or shuffle players into balanced teams.
  function setTeamCount(code, secret, count) {
    return hostAction(code, secret, e => {
      if (e.status !== 'lobby') return { error: 'Change teams from the lobby' };
      const n = Math.min(LIMITS.maxTeams, Math.max(LIMITS.minTeams, parseInt(count, 10) || 2));
      while (e.teams.length < n) e.teams.push({ name: TEAM_NAMES[e.teams.length] || `Team ${e.teams.length + 1}`, score: 0 });
      e.teams.length = n;
      for (const p of Object.values(e.players)) {
        if (p.team < n) continue;
        const counts = e.teams.map((_, i) => Object.values(e.players).filter(q => q.team === i).length);
        p.team = counts.indexOf(Math.min(...counts));
      }
      publish(e);
      return { ok: true };
    });
  }

  function shuffleTeams(code, secret) {
    return hostAction(code, secret, e => {
      if (e.status === 'playing') return { error: 'Wait until the game ends' };
      const ps = Object.values(e.players);
      for (let i = ps.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ps[i], ps[j]] = [ps[j], ps[i]];
      }
      ps.forEach((p, i) => (p.team = i % e.teams.length));
      publish(e);
      return { ok: true };
    });
  }

  // ---- AIM Academy Challenge actions ----
  const aimHost = (code, secret, fn) =>
    hostAction(code, secret, e => {
      if (!aim || e.gameId !== 'aim' || !e.aim) return { error: 'No AIM challenge is running' };
      return fn(e);
    });
  const aimPlayer = (code, playerId, fn) => {
    const e = find(code);
    if (!aim || !e || e.gameId !== 'aim' || !e.aim) return { error: 'No AIM challenge is running' };
    if (!e.players[playerId]) return { error: 'Player not found' };
    return fn(e);
  };
  const aimApi = {
    next: (code, secret) => aimHost(code, secret, e => aim.next(e)),
    scoreItem: (code, secret, data) => aimHost(code, secret, e => aim.scoreItem(e, data)),
    scoreProposal: (code, secret, data) => aimHost(code, secret, e => aim.scoreProposal(e, data)),
    answer: (code, playerId, data) => aimPlayer(code, playerId, e => aim.answer(e, playerId, data)),
    saveProposal: (code, playerId, data) => aimPlayer(code, playerId, e => aim.saveProposal(e, playerId, data)),
    vote: (code, playerId, team) => aimPlayer(code, playerId, e => aim.vote(e, playerId, team)),
  };

  function getPublic(code) {
    const e = find(code);
    return e ? publicState(e) : null;
  }

  function getPrivate(code, playerId) {
    const e = find(code);
    return e && e.players[playerId] ? privateState(e, playerId) : null;
  }

  function sweep() {
    const cutoff = now() - LIMITS.eventTtlMs;
    for (const e of events.values()) {
      if (e.updatedAt < cutoff) {
        clearRoundTimer(e);
        events.delete(e.code);
      }
    }
    onChange();
  }

  const serialize = () => ({ version: 1, events: [...events.values()] });

  function load(data) {
    if (!data || !Array.isArray(data.events)) return 0;
    for (const e of data.events) {
      if (!e?.code || !e.secret) continue;
      events.set(e.code, e);
      if (e.status === 'playing' && e.gameId === 'aim') {
        if (aim && e.aim) aim.resume(e);
      } else if (e.status === 'playing') {
        if (!e.deadline || e.deadline <= now()) finishRound(e.code);
        else scheduleRoundEnd(e);
      }
    }
    return events.size;
  }

  return {
    createEvent, authorizeHost, joinPlayer, connect, disconnect, startGame, answer, endRoundNow,
    next, backToLobby, renameTeam, movePlayer, removePlayer, endEvent, getPublic, getPrivate,
    setTeamCount, shuffleTeams, aim: aimApi,
    sweep, serialize, load, finishRound,
    get size() { return events.size; },
  };
}
