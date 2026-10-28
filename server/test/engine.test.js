import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../engine.js';
import { getGame } from '../games.js';

function setup({ teamCount = 2, arena = 'general' } = {}) {
  const updates = [];
  const privates = {};
  const timers = [];
  let clock = 1_000_000;
  const engine = createEngine({
    onUpdate: (code, s) => updates.push(s),
    onPrivate: (code, id, s) => (privates[id] = s),
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms, cancelled: false }; timers.push(t); return t; },
    clearTimer: t => (t.cancelled = true),
  });
  const { code, secret } = engine.createEvent({ title: 'Test', arena, teamCount });
  const advance = ms => {
    clock += ms;
    for (const t of timers) if (!t.cancelled && !t.fired && t.at <= clock) { t.fired = true; t.fn(); }
  };
  const join = name => {
    const r = engine.joinPlayer({ code, name });
    clock += 1;
    engine.connect(code, r.playerId);
    return r;
  };
  const last = () => updates.at(-1);
  return { engine, code, secret, privates, updates, last, join, advance };
}

test('clues are spread so a 2-person team sees all 4 clues', () => {
  const { engine, code, secret, privates, join } = setup();
  const players = ['A', 'B', 'C', 'D'].map(join); // teams alternate 0,1,0,1
  assert.equal(engine.startGame(code, secret, 'missing').ok, true);
  const clues = getGame('missing').scenarios[0].clues;
  for (const team of [0, 1]) {
    const seen = players.filter(p => p.team === team).flatMap(p => privates[p.playerId].clues);
    assert.deepEqual([...seen].sort(), [...clues].sort());
  }
});

test('round 2 of The Missing Information sends round 2 clues', () => {
  const { engine, code, secret, privates, join } = setup();
  const [a] = ['A', 'B'].map(join);
  engine.startGame(code, secret, 'missing');
  engine.endRoundNow(code, secret);
  assert.deepEqual(privates[a.playerId].clues, [], 'clues hidden during review');
  engine.next(code, secret);
  assert.deepEqual(privates[a.playerId].clues, getGame('missing').scenarios[1].clues, 'solo team member gets every clue');
});

test('large team: everyone gets at least one clue', () => {
  const { engine, code, secret, privates, join } = setup();
  const ps = Array.from({ length: 14 }, (_, i) => join('P' + i));
  engine.startGame(code, secret, 'missing');
  for (const p of ps) assert.ok(privates[p.playerId].clues.length >= 1);
});

test('public state carries choices but never the answer or clues', () => {
  const { engine, code, secret, last, join } = setup();
  join('A'); join('B');
  engine.startGame(code, secret, 'crisis');
  const s = last();
  assert.equal(s.scenario.choices.length, 4);
  const text = JSON.stringify(s);
  assert.ok(!text.includes('"answer"'));
  assert.ok(!text.includes('clues'));
  assert.ok(!text.includes(secret));
});

test('answered teams are tracked; round ends when every playing team answered; scoring', () => {
  const { engine, code, secret, last, join } = setup();
  const [a, b] = [join('A'), join('B')];
  engine.startGame(code, secret, 'crisis');
  assert.equal(engine.answer({ code, playerId: a.playerId, choice: 1 }).ok, true);
  assert.deepEqual(last().answeredTeams, [a.team]);
  assert.equal(last().status, 'playing');
  assert.match(engine.answer({ code, playerId: a.playerId, choice: 0 }).error, /already/);
  engine.answer({ code, playerId: b.playerId, choice: 0 });
  const s = last();
  assert.equal(s.status, 'review');
  assert.equal(s.teams[a.team].score, 100);
  assert.equal(s.teams[b.team].score, 0);
  assert.equal(s.results[0].answers[a.team].by, 'A');
});

test('empty teams do not block the round from ending early', () => {
  const { engine, code, secret, last, join } = setup({ teamCount: 4 });
  const [a, b] = [join('A'), join('B')];
  engine.startGame(code, secret, 'crisis');
  engine.answer({ code, playerId: a.playerId, choice: 1 });
  engine.answer({ code, playerId: b.playerId, choice: 1 });
  assert.equal(last().status, 'review');
});

test('timer ends the round; a stale timer cannot end a newer round', () => {
  const { engine, code, secret, last, join, advance } = setup();
  join('A'); join('B');
  engine.startGame(code, secret, 'crisis'); // 75s
  advance(30_000);
  engine.backToLobby(code, secret);
  engine.startGame(code, secret, 'crisis');
  advance(50_000); // old timer would have fired here
  assert.equal(last().status, 'playing');
  advance(30_000);
  assert.equal(last().status, 'review');
});

test('invalid answers and unauthorized host actions are rejected', () => {
  const { engine, code, secret, join } = setup();
  const a = join('A'); join('B');
  assert.ok(engine.startGame(code, 'wrong', 'crisis').error);
  assert.ok(engine.startGame(code, secret, 'objection').error, 'sales game in general arena');
  engine.startGame(code, secret, 'crisis');
  for (const choice of [-1, 4, '1', 1.5, null]) assert.ok(engine.answer({ code, playerId: a.playerId, choice }).error);
});

test('rejoining with a saved player id keeps the same player and team', () => {
  const { engine, code, secret, join, last } = setup();
  const a = join('A'); join('B');
  engine.startGame(code, secret, 'crisis');
  engine.disconnect(code, a.playerId);
  assert.equal(last().players.find(p => p.id === a.playerId).connected, false);
  const again = engine.joinPlayer({ code, playerId: a.playerId });
  assert.equal(again.playerId, a.playerId);
  assert.equal(again.team, a.team);
  engine.connect(code, again.playerId);
  assert.equal(last().players.find(p => p.id === a.playerId).connected, true);
  assert.equal(last().players.length, 2);
});

test('game over keeps scores; next game in lobby; end event blocks joins', () => {
  const { engine, code, secret, join, last } = setup();
  const a = join('A'); join('B');
  engine.startGame(code, secret, 'crisis');
  engine.answer({ code, playerId: a.playerId, choice: 1 });
  engine.endRoundNow(code, secret);
  engine.next(code, secret);
  engine.endRoundNow(code, secret);
  engine.next(code, secret);
  assert.equal(last().status, 'gameover');
  engine.backToLobby(code, secret);
  assert.equal(last().teams[a.team].score, 100);
  engine.endEvent(code, secret);
  assert.ok(engine.joinPlayer({ code, name: 'Late' }).error);
});

test('serialize/load restores events and finishes expired rounds', () => {
  const { engine, code, secret, join } = setup();
  join('A'); join('B');
  engine.startGame(code, secret, 'crisis');
  const snapshot = JSON.parse(JSON.stringify(engine.serialize()));
  const later = createEngine({ now: () => 1_000_000 + 10 * 60_000, setTimer: () => 0, clearTimer: () => {} });
  assert.equal(later.load(snapshot), 1);
  assert.equal(later.getPublic(code).status, 'review');
  assert.equal(later.authorizeHost(code, secret).ok, true);
});
