import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createEngine } from '../engine.js';
import { createAimStore, validateQuestion } from '../aim/store.js';

function setup({ teamCount = 2, players = 4, file = null } = {}) {
  const updates = [];
  const privates = {};
  const timers = [];
  let clock = 5_000_000;
  const aimStore = createAimStore({ file });
  const engine = createEngine({
    aimStore,
    onUpdate: (code, s) => updates.push(s),
    onPrivate: (code, id, s) => (privates[id] = s),
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; },
    clearTimer: t => t && (t.cancelled = true),
  });
  const { code, secret } = engine.createEvent({ title: 'AIM test', arena: 'aim', teamCount });
  const ps = [];
  for (let i = 0; i < players; i++) {
    const r = engine.joinPlayer({ code, name: 'P' + i });
    clock += 1;
    engine.connect(code, r.playerId);
    ps.push(r);
  }
  const advance = ms => {
    clock += ms;
    for (const t of timers) if (!t.cancelled && !t.fired && t.at <= clock) { t.fired = true; t.fn(); }
  };
  const last = () => updates.at(-1);
  const aim = () => last().aim;
  const tick = ms => (clock += ms);
  return { engine, aimStore, code, secret, ps, privates, last, aim, advance, tick };
}

const cfg = (r1 = 0, r2 = 0, r3 = 0, r4 = 0, r5 = 0, extra = {}) => ({
  rounds: { 1: { count: r1, mode: 'individual' }, 2: { count: r2, mode: 'consensus' }, 3: { count: r3 }, 4: { count: r4, mode: 'consensus' }, 5: { count: r5 } },
  ...extra,
});

test('bank: 60 items, 20/30/30/20 difficulty mix, every MCQ has 4 distinct choices and a source', () => {
  const store = createAimStore();
  const qs = store.questions();
  assert.equal(qs.length, 60);
  const lv = {};
  for (const q of qs) lv[q.level] = (lv[q.level] || 0) + 1;
  assert.deepEqual(lv, { factual: 12, understanding: 18, application: 18, strategic: 12 });
  for (const q of qs) {
    assert.ok(q.source, q.id);
    assert.doesNotThrow(() => validateQuestion(q), q.id);
    if (q.choices) assert.equal(new Set(q.choices).size, 4, q.id);
  }
});

test('pending scenarios are excluded by default and included only when asked', () => {
  const store = createAimStore();
  assert.equal(store.pool(4, false).length, 0);
  assert.equal(store.pool(4, true).length, 14);
  assert.equal(store.pool(1, false).length, 18);
});

test('organizer starts AIM; rounds without approved questions are skipped', () => {
  const { engine, code, secret, aim, last } = setup();
  const r = engine.startGame(code, secret, 'aim', cfg(3, 2, 1, 4, 4));
  assert.equal(r.ok, true);
  assert.equal(last().gameId, 'aim');
  assert.deepEqual(aim().plan.map(p => p.round), [1, 2, 3]); // R4/R5 pending → skipped
  assert.equal(aim().phase, 'intro');
});

test('individual mode: normalized team score, speed bonus, answers hidden until reveal', () => {
  const { engine, code, secret, ps, aim, privates, tick } = setup({ players: 4 });
  engine.startGame(code, secret, 'aim', cfg(1));
  engine.aim.next(code, secret); // intro → question
  const item = aim().item;
  assert.equal(item.choices.length, 4);
  assert.equal(aim().reveal, undefined);
  assert.ok(!JSON.stringify(aim()).includes('"answer"'));
  // find the correct index by answering with player 0 after reveal is impossible; read from bank instead
  const { createAimStore: _ } = { createAimStore };
  const bankQ = createAimStore().questions().find(q => q.id === item.id);
  const correct = item.choices.indexOf(bankQ.choices[bankQ.answer]);
  const team0 = ps.filter(p => p.team === 0);
  const team1 = ps.filter(p => p.team === 1);
  tick(0);
  engine.aim.answer(code, team0[0].playerId, { choice: correct }); // instant → 125
  engine.aim.answer(code, team0[1].playerId, { choice: (correct + 1) % 4 }); // wrong → 0
  assert.match(engine.aim.answer(code, team0[1].playerId, { choice: correct }).error, /already/);
  assert.equal(aim().progress.done, 2);
  engine.aim.answer(code, team1[0].playerId, { choice: correct });
  engine.aim.answer(code, team1[1].playerId, { choice: correct }); // all answered → reveal
  assert.equal(aim().phase, 'reveal');
  assert.equal(aim().reveal.answer, correct);
  assert.equal(aim().reveal.perTeam[0].points, Math.round((125 + 0) / 2));
  assert.equal(aim().reveal.perTeam[1].points, 125);
  assert.equal(aim().scores[1].total, 125);
  assert.equal(privates[team0[0].playerId].aim.answer.result.points, 125);
});

test('consensus mode: first team answer locks the team; speed bonus decays with time', () => {
  const { engine, code, secret, ps, aim, tick } = setup();
  engine.startGame(code, secret, 'aim', cfg(0, 1));
  engine.aim.next(code, secret);
  const item = aim().item;
  const bankQ = createAimStore().questions().find(q => q.id === item.id);
  if (item.type === 'match') {
    const right = item.items.map(it => item.options.indexOf(bankQ.options[bankQ.answers[bankQ.items.indexOf(it)]]));
    const t0 = ps.find(p => p.team === 0), t1 = ps.find(p => p.team === 1);
    tick(item.timer * 500); // half time → bonus ~12-13
    engine.aim.answer(code, t0.playerId, { matches: right });
    const wrong = right.map((x, i) => (i === 0 ? (x + 1) % item.options.length : x));
    engine.aim.answer(code, t1.playerId, { matches: wrong });
    const r = aim().reveal.perTeam;
    assert.ok(r[0].points >= 112 && r[0].points <= 113, String(r[0].points));
    assert.ok(r[1].points < 100 && r[1].points > 0, 'partial credit');
  } else {
    const correct = item.choices.indexOf(bankQ.choices[bankQ.answer]);
    const t0 = ps.filter(p => p.team === 0);
    tick(item.timer * 500);
    engine.aim.answer(code, t0[0].playerId, { choice: correct });
    assert.match(engine.aim.answer(code, t0[1].playerId, { choice: correct }).error, /team has already/);
    engine.aim.answer(code, ps.find(p => p.team === 1).playerId, { choice: (correct + 1) % 4 });
    const r = aim().reveal.perTeam;
    assert.ok(r[0].points >= 112 && r[0].points <= 113, String(r[0].points));
    assert.equal(r[1].points, 0);
    assert.equal(r[0].by, 'P0');
  }
});

test('collaborative puzzle: clues split so no player holds all of them; up to 200 points', () => {
  const { engine, code, secret, ps, aim, privates } = setup({ players: 6 });
  engine.startGame(code, secret, 'aim', cfg(0, 0, 1));
  engine.aim.next(code, secret);
  const item = aim().item;
  assert.equal(item.type, 'puzzle');
  for (const team of [0, 1]) {
    const members = ps.filter(p => p.team === team);
    const all = members.flatMap(p => privates[p.playerId].aim.clues);
    assert.equal(new Set(all).size, item.clueCount, 'team sees every clue');
    for (const p of members) assert.ok(privates[p.playerId].aim.clues.length < item.clueCount, 'nobody has every clue');
  }
  const bankQ = createAimStore().questions().find(q => q.id === item.id);
  const correct = item.choices.indexOf(bankQ.choices[bankQ.answer]);
  engine.aim.answer(code, ps[0].playerId, { choice: correct });
  engine.aim.answer(code, ps[1].playerId, { choice: (correct + 1) % 4 });
  const r = aim().reveal.perTeam;
  assert.equal(r[ps[0].team].points, 200);
  assert.equal(r[ps[1].team].points, 0);
  assert.deepEqual(privates[ps[0].playerId].aim.clues, [], 'clues hidden after reveal');
});

test('scenario: graded options, rubric override by facilitator, discussion forces consensus', () => {
  const { engine, aimStore, code, secret, ps, aim } = setup();
  aimStore.setStatus(aimStore.questions().filter(q => q.round === 4).map(q => q.id), 'approved');
  engine.startGame(code, secret, 'aim', { ...cfg(0, 0, 0, 14), rounds: { ...cfg().rounds, 4: { count: 14, mode: 'individual' } } });
  engine.aim.next(code, secret);
  let sawDiscussion = false;
  for (let i = 0; i < 14; i++) {
    const item = aim().item;
    if (item.discussion) {
      sawDiscussion = true;
      assert.equal(item.mode, 'consensus');
    }
    const t0 = ps.find(p => p.team === 0);
    if (item.mode === 'consensus') {
      engine.aim.answer(code, t0.playerId, { choice: 0, rationale: 'We agreed' });
      engine.aim.answer(code, ps.find(p => p.team === 1).playerId, { choice: 1 });
    } else {
      for (const p of ps) engine.aim.answer(code, p.playerId, { choice: 0 });
    }
    assert.equal(aim().phase, 'reveal');
    const max = Math.max(...aim().reveal.points);
    assert.equal(max, 150);
    if (i === 0) {
      const hi = aim().reveal.historyIndex;
      engine.aim.scoreItem(code, secret, { historyIndex: hi, team: 1, checks: [true, true, false, false] });
      const r = item.rubric;
      assert.equal(aim().reveal.perTeam[1].points, r[0].points + r[1].points);
      assert.equal(aim().reveal.perTeam[1].override !== undefined, true);
    }
    engine.aim.next(code, secret);
  }
  assert.ok(sawDiscussion);
  assert.equal(aim().phase, 'roundEnd');
});

test('round 5: proposals, no self-voting, rubric scoring, awards and summary', () => {
  const { engine, aimStore, code, secret, ps, aim, privates, advance } = setup({ teamCount: 3, players: 6 });
  aimStore.setStatus(aimStore.questions().filter(q => q.round === 5).map(q => q.id), 'approved');
  engine.startGame(code, secret, 'aim', cfg(1, 0, 0, 0, 4));
  // Round 1 single question
  engine.aim.next(code, secret);
  for (const p of ps) engine.aim.answer(code, p.playerId, { choice: 0 });
  engine.aim.next(code, secret); // reveal → roundEnd
  engine.aim.next(code, secret); // → round 5 intro
  assert.equal(aim().round.round, 5);
  engine.aim.next(code, secret); // → write
  assert.equal(aim().phase, 'write');
  assert.equal(Object.keys(aim().briefs).length, 3);
  const byTeam = t => ps.filter(p => p.team === t);
  const fields = n => ({ name: 'Idea ' + n, audience: 'Members', pillar: 'Better', impact: 'Big', resources: 'Few', measure: 'Surveys' });
  assert.match(engine.aim.saveProposal(code, byTeam(0)[0].playerId, { name: 'Draft', submit: true }).error, /every field/);
  engine.aim.saveProposal(code, byTeam(0)[0].playerId, { ...fields(0), submit: true });
  engine.aim.saveProposal(code, byTeam(1)[0].playerId, fields(1));
  assert.equal(privates[byTeam(0)[1].playerId].aim.proposal.name, 'Idea 0', 'teammates see the draft');
  assert.equal(aim().proposals, undefined, 'other teams cannot see proposals while writing');
  advance(10 * 60 * 1000 + 1000); // timer closes writing
  assert.equal(aim().phase, 'vote');
  assert.match(engine.aim.vote(code, byTeam(0)[0].playerId, 0).error, /own team/);
  assert.match(engine.aim.vote(code, byTeam(0)[0].playerId, 2).error, /no proposal/);
  engine.aim.vote(code, byTeam(0)[0].playerId, 1);
  engine.aim.vote(code, byTeam(2)[0].playerId, 1);
  engine.aim.vote(code, byTeam(1)[0].playerId, 0);
  assert.deepEqual(aim().voteCounts, { 0: 1, 1: 2 });
  engine.aim.next(code, secret); // → review
  engine.aim.scoreProposal(code, secret, { team: 0, values: { alignment: 10, feasibility: 10, impact: 10, creativity: 10 } });
  engine.aim.scoreProposal(code, secret, { team: 1, values: { alignment: 5, feasibility: 4, impact: 6, creativity: 10 } });
  assert.equal(aim().propScores[0].points, 300);
  assert.equal(aim().propScores[1].points, Math.round(300 * (15 + 10 + 15 + 20) / 100));
  engine.aim.next(code, secret); // → roundEnd
  engine.aim.next(code, secret); // → final
  const a = aim();
  assert.equal(a.phase, 'final');
  const innovation = a.awards.find(x => x.key === 'innovation');
  assert.deepEqual(innovation.teams, [0]);
  assert.deepEqual(a.awards.find(x => x.key === 'peoples').teams, [1]);
  assert.equal(a.summary.participants, 6);
  assert.equal(a.summary.proposals.length, 2);
  assert.ok(a.summary.note.includes('not a performance evaluation'));
  assert.equal(engine.getPublic(code).status, 'gameover');
});

test('existing games still work alongside AIM, and lobby team tools', () => {
  const { engine, code, secret, ps, last } = setup({ players: 4 });
  assert.equal(engine.setTeamCount(code, secret, 3).ok, true);
  assert.equal(last().teams.length, 3);
  assert.equal(engine.shuffleTeams(code, secret).ok, true);
  const counts = [0, 1, 2].map(t => last().players.filter(p => p.team === t).length);
  assert.deepEqual(counts.sort(), [1, 1, 2]);
  // An AIM-arena event can also play the general team-building games, but not sales ones
  assert.ok(engine.startGame(code, secret, 'objection').error);
  assert.equal(engine.startGame(code, secret, 'crisis').ok, true);
  assert.equal(last().scenario.choices.length, 4);
  engine.backToLobby(code, secret);
  engine.startGame(code, secret, 'aim', cfg(1));
  engine.backToLobby(code, secret);
  assert.equal(last().status, 'lobby');
  assert.equal(last().aim, null);
});

test('AIM event survives a server restart mid-question', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-'));
  const { engine, code, secret, ps, aim } = setup();
  engine.startGame(code, secret, 'aim', cfg(2));
  engine.aim.next(code, secret);
  engine.aim.answer(code, ps[0].playerId, { choice: 0 });
  const snap = JSON.parse(JSON.stringify(engine.serialize()));
  const store = createAimStore({ file: path.join(dir, 'b.json') });
  const later = createEngine({ aimStore: store, now: () => 5_000_000 + 3_600_000, setTimer: () => 0, clearTimer: () => {} });
  later.load(snap);
  const s = later.getPublic(code);
  assert.equal(s.aim.phase, 'reveal', 'expired question is revealed on restart');
  assert.equal(later.aim.next(code, secret).ok, true);
});

test('bank store: add, edit, validate, import JSON, profile fields, configs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimb-'));
  const file = path.join(dir, 'bank.json');
  const s = createAimStore({ file });
  assert.throws(() => s.upsertQuestion({ type: 'mcq', round: 1, level: 'factual', prompt: 'x', choices: ['a', 'a', 'b', 'c'], answer: 0 }), /different/);
  const q = s.upsertQuestion({ type: 'mcq', round: 1, level: 'factual', prompt: 'New?', choices: ['a', 'b', 'c', 'd'], answer: 2, status: 'verified' });
  assert.equal(s.questions().length, 61);
  s.upsertQuestion({ ...q, prompt: 'Edited?' });
  assert.equal(s.questions().find(x => x.id === q.id).prompt, 'Edited?');
  const imp = s.importQuestions([{ type: 'mcq', round: 2, level: 'understanding', prompt: 'Imported', choices: ['1', '2', '3', '4'], answer: 1 }, { type: 'nope' }]);
  assert.equal(imp.imported, 1);
  assert.equal(imp.errors.length, 1);
  s.setProfile({ coreValues: { values: ['Respect', 'Teamwork'], status: 'pending' } });
  assert.equal(s.profile().coreValues.values[1], 'Teamwork');
  const c = s.saveConfig({ name: 'Mine', rounds: { 1: { count: 3, mode: 'consensus' } } });
  assert.ok(s.getConfig(c.id));
  // persisted
  const again = createAimStore({ file });
  assert.equal(again.questions().length, 62);
  assert.ok(again.getConfig(c.id));
  s.deleteQuestion(q.id);
  assert.equal(s.questions().length, 61);
});
