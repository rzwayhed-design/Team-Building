// AIM Academy Challenge — game flow, scoring and results.
// Plugs into the existing TEAM UP engine: same events, teams, players, timers and broadcasts.
// State lives on event.aim (plain JSON, so it is saved/restored with the event).

import { randomInt } from 'crypto';
import { validateConfig } from './store.js';

export const ROUND_INFO = {
  1: { title: 'Know Your AIM', desc: 'History, meaning, mission, vision, pillars and leadership.' },
  2: { title: 'Inside AIM', desc: 'Activities, programs, community initiatives and partners.' },
  3: { title: 'The AIM Mission Quest', desc: 'Every teammate holds different clues. Talk, combine, unlock.' },
  4: { title: 'Think Like an AIM Coach', desc: 'Real coaching situations. Choose the strongest response.' },
  5: { title: 'Build AIM’s Future', desc: 'Design one new initiative within your budget, then vote.' },
};
export const MODE_LABELS = {
  individual: 'Individual answers',
  consensus: 'Team consensus',
  collaborative: 'Collaborative puzzle',
  proposal: 'Team proposal',
};
export const PILLARS = ['Faster', 'Stronger', 'Better'];
const DEFAULT_TIMERS = { factual: 25, understanding: 35, strategic: 45, application: 45 };
const PROPOSAL_FIELDS = { name: 80, audience: 160, pillar: 20, impact: 500, resources: 500, measure: 500 };

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const range = n => [...Array(n).keys()];
const clamp01 = x => Math.max(0, Math.min(1, x));
const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function timerFor(q) {
  if (q.timer) return q.timer;
  if (q.type === 'puzzle') return 240;
  if (q.type === 'scenario') return q.discussion ? 120 : 75;
  if (q.type === 'match') return 60;
  return DEFAULT_TIMERS[q.level] || 35;
}

// Snapshot a bank question for one event, with answer order randomized.
export function prepareItem(q) {
  const it = structuredClone(q);
  it.timer = timerFor(q);
  if (Array.isArray(q.choices)) {
    const order = shuffle(range(q.choices.length));
    it.choices = order.map(i => q.choices[i]);
    it.answer = order.indexOf(q.answer);
    if (Array.isArray(q.points)) it.points = order.map(i => q.points[i]);
  }
  if (q.type === 'match') {
    const itemOrder = shuffle(range(q.items.length));
    const optOrder = shuffle(range(q.options.length));
    it.items = itemOrder.map(i => q.items[i]);
    it.options = optOrder.map(i => q.options[i]);
    it.answers = itemOrder.map(i => optOrder.indexOf(q.answers[i]));
  }
  if (q.type === 'puzzle') it.clues = shuffle(q.clues);
  return it;
}

export function createAim({ store, now, setTimer, clearTimer, publish, sendPrivateAll, isConnected, onFinish = () => {} }) {
  const timers = new Map();

  const effectiveMode = (round, item) => {
    if (round.mode === 'proposal' || round.mode === 'collaborative') return round.mode;
    if (item?.type === 'puzzle') return 'collaborative';
    if (item?.discussion) return 'consensus';
    return round.mode;
  };
  const teamMode = mode => mode !== 'individual';
  const curRound = a => a.rounds[a.ri];
  const curItem = a => curRound(a)?.items[a.ii];
  const playersOf = e => Object.values(e.players);
  const teamsWithPlayers = e => e.teams.map((_, t) => t).filter(t => playersOf(e).some(p => p.team === t));

  function clearTimers(e) {
    const t = timers.get(e.code);
    if (t) clearTimer(t);
    timers.delete(e.code);
  }

  function schedule(e, fn) {
    clearTimers(e);
    const a = e.aim;
    const token = ++a.token;
    const wait = Math.max(0, a.deadline - now()) + 250;
    timers.set(e.code, setTimer(() => {
      if (e.aim && e.aim.token === token) fn();
    }, wait));
  }

  function broadcast(e) {
    recompute(e);
    publish(e);
    sendPrivateAll(e);
  }

  // ---------- start ----------
  function start(e, cfgInput) {
    const preset = cfgInput?.configId ? store.getConfig(cfgInput.configId) : null;
    const cfg = validateConfig(cfgInput || {}, preset || store.getConfig('standard'));
    const rounds = [];
    for (const r of [1, 2, 3, 4, 5]) {
      const want = cfg.rounds[r].count;
      if (!want) continue;
      let pool = store.pool(r, cfg.includePending);
      if (cfg.randomize) pool = shuffle(pool);
      const picked = pool.slice(0, want);
      if (!picked.length) continue;
      rounds.push({
        round: r,
        title: ROUND_INFO[r].title,
        desc: ROUND_INFO[r].desc,
        mode: cfg.rounds[r].mode,
        items: r === 5 ? picked.map(q => structuredClone(q)) : picked.map(prepareItem),
      });
    }
    if (!rounds.length) return { error: 'No questions are ready to play. Approve or add questions in the AIM Question Bank.' };
    e.aim = {
      cfg,
      rounds,
      ri: 0,
      ii: -1,
      phase: 'intro',
      deadline: null,
      startedAt: null,
      token: 0,
      cur: null,
      history: [],
      personal: {},
      proposals: {},
      votes: {},
      propScores: {},
      scores: {},
      startedEventAt: now(),
    };
    recompute(e);
    return { ok: true };
  }

  function stop(e) {
    clearTimers(e);
  }

  // ---------- items ----------
  function startItem(e, ii) {
    const a = e.aim;
    const round = curRound(a);
    const item = round.items[ii];
    const mode = effectiveMode(round, item);
    a.ii = ii;
    a.phase = 'question';
    a.startedAt = now();
    a.deadline = a.startedAt + item.timer * 1000;
    const eligible = {};
    e.teams.forEach((_, t) => {
      eligible[t] = playersOf(e)
        .filter(p => p.team === t && isConnected(e.code, p.id))
        .sort((x, y) => x.joinedAt - y.joinedAt)
        .map(p => p.id);
    });
    const clues = {};
    if (item.type === 'puzzle') {
      for (const ids of Object.values(eligible)) {
        const n = ids.length;
        if (!n) continue;
        ids.forEach(id => (clues[id] = []));
        if (n <= item.clues.length) item.clues.forEach((c, i) => clues[ids[i % n]].push(c));
        else ids.forEach((id, j) => clues[id].push(item.clues[j % item.clues.length]));
      }
    }
    a.cur = { mode, eligible, clues, answers: {}, teamAnswers: {} };
    schedule(e, () => reveal(e));
    broadcast(e);
  }

  function scoreAnswer(item, ans, a) {
    const total = a.deadline - a.startedAt;
    const speed = clamp01((a.deadline - ans.at) / total);
    if (item.type === 'mcq') {
      const correct = ans.choice === item.answer;
      return { correct, points: correct ? 100 + Math.round(25 * speed) : 0, text: item.choices[ans.choice] };
    }
    if (item.type === 'puzzle') {
      const correct = ans.choice === item.answer;
      return { correct, points: correct ? 150 + Math.round(50 * speed) : 0, text: item.choices[ans.choice] };
    }
    if (item.type === 'scenario') {
      const points = item.points[ans.choice] || 0;
      return { correct: points === Math.max(...item.points), points, text: item.choices[ans.choice] };
    }
    if (item.type === 'match') {
      const right = item.answers.filter((x, i) => ans.matches[i] === x).length;
      const frac = right / item.answers.length;
      return {
        correct: frac === 1,
        fraction: frac,
        points: Math.round(100 * frac) + (frac === 1 ? Math.round(25 * speed) : 0),
        text: `${right}/${item.answers.length} matched`,
      };
    }
    return { correct: false, points: 0, text: '' };
  }

  function allAnswered(e) {
    const { cur } = e.aim;
    if (teamMode(cur.mode)) {
      const inPlay = Object.entries(cur.eligible).filter(([, ids]) => ids.length).map(([t]) => Number(t));
      return inPlay.length > 0 && inPlay.every(t => cur.teamAnswers[t]);
    }
    const ids = Object.values(cur.eligible).flat();
    return ids.length > 0 && ids.every(id => cur.answers[id]);
  }

  function reveal(e) {
    const a = e.aim;
    if (a.phase !== 'question') return;
    clearTimers(e);
    const round = curRound(a);
    const item = curItem(a);
    const { cur } = a;
    const perTeam = {};
    let statE = 0, statA = 0, statC = 0;
    e.teams.forEach((_, t) => {
      const ids = cur.eligible[t] || [];
      if (teamMode(cur.mode)) {
        const ans = cur.teamAnswers[t];
        const r = ans ? scoreAnswer(item, ans, a) : { correct: false, points: 0, text: '' };
        perTeam[t] = {
          points: r.points, auto: r.points, answered: !!ans, correct: r.correct, answerText: r.text,
          choice: ans?.choice ?? null, by: ans?.by || null, rationale: ans?.rationale || '', eligible: ids.length,
        };
        if (ids.length) {
          statE++;
          if (ans) statA++;
          if (r.correct) statC++;
        }
      } else {
        let sum = 0, answered = 0, correct = 0;
        for (const id of ids) {
          const ans = cur.answers[id];
          if (!ans) continue;
          const r = scoreAnswer(item, ans, a);
          answered++;
          if (r.correct) correct++;
          sum += r.points;
          a.personal[id] = (a.personal[id] || 0) + r.points;
          ans.result = r;
        }
        const pts = ids.length ? Math.round(sum / ids.length) : 0;
        perTeam[t] = {
          points: pts, auto: pts, answered: answered > 0, correct: ids.length > 0 && correct === ids.length,
          answerText: ids.length ? `${correct}/${ids.length} correct` : '', eligible: ids.length, answeredCount: answered, correctCount: correct,
        };
        statE += ids.length;
        statA += answered;
        statC += correct;
      }
      if (teamMode(cur.mode) && cur.teamAnswers[t]) cur.teamAnswers[t].result = { points: perTeam[t].points, correct: perTeam[t].correct };
    });
    a.history.push({
      round: round.round,
      qid: item.id,
      type: item.type,
      level: item.level,
      area: item.area || '',
      prompt: item.prompt,
      mode: cur.mode,
      correctText: item.type === 'match'
        ? item.items.map((it, i) => `${it} → ${item.options[item.answers[i]]}`).join(' · ')
        : item.choices[item.answer],
      perTeam,
      stats: { eligible: statE, answered: statA, correct: statC },
    });
    a.phase = 'reveal';
    a.deadline = null;
    broadcast(e);
  }

  // ---------- proposals ----------
  function briefFor(a, t) {
    const items = curRound(a)?.round === 5 ? curRound(a).items : a.rounds.find(r => r.round === 5)?.items || [];
    return items.length ? items[t % items.length] : null;
  }

  function closeWriting(e) {
    if (e.aim?.phase !== 'write') return;
    e.aim.phase = 'vote';
    e.aim.deadline = null;
    broadcast(e);
  }

  function startWrite(e) {
    const a = e.aim;
    a.phase = 'write';
    a.startedAt = now();
    a.deadline = a.startedAt + a.cfg.proposalMinutes * 60 * 1000;
    schedule(e, () => closeWriting(e));
    broadcast(e);
  }

  // ---------- results ----------
  function recompute(e) {
    const a = e.aim;
    const scores = {};
    e.teams.forEach((_, t) => (scores[t] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, total: 0 }));
    for (const h of a.history) {
      for (const [t, r] of Object.entries(h.perTeam)) if (scores[t]) scores[t][h.round] += r.points;
    }
    for (const [t, s] of Object.entries(a.propScores)) if (scores[t]) scores[t][5] += s.points;
    for (const s of Object.values(scores)) s.total = s[1] + s[2] + s[3] + s[4] + s[5];
    a.scores = scores;
    e.teams.forEach((team, t) => (team.score = scores[t].total));
    for (const p of playersOf(e)) p.score = a.personal[p.id] || 0;
  }

  function voteCounts(a) {
    const counts = {};
    for (const t of Object.values(a.votes)) counts[t] = (counts[t] || 0) + 1;
    return counts;
  }

  function awards(e) {
    const a = e.aim;
    const teams = teamsWithPlayers(e);
    const best = (fn, label, key) => {
      if (!teams.length) return { key, label, teams: [], score: 0 };
      const vals = teams.map(t => ({ t, v: fn(a.scores[t], t) }));
      const top = Math.max(...vals.map(x => x.v));
      return { key, label, teams: top > 0 ? vals.filter(x => x.v === top).map(x => x.t) : [], score: top };
    };
    const votes = voteCounts(a);
    return [
      best(s => s.total, 'AIM Academy Champions', 'overall'),
      best(s => s[1] + s[2], 'Knowledge Champions', 'knowledge'),
      best(s => s[3], 'Collaboration Champions', 'collaboration'),
      best(s => s[4], 'Coaching Judgment Champions', 'coaching'),
      best(s => s[5], 'Innovation Champions', 'innovation'),
      best((s, t) => votes[t] || 0, 'People’s Choice (peer votes)', 'peoples'),
    ];
  }

  function summary(e) {
    const a = e.aim;
    const teams = e.teams.map((t, i) => ({ team: i, name: t.name, members: playersOf(e).filter(p => p.team === i).length }));
    const missed = a.history
      .filter(h => h.type !== 'scenario')
      .map(h => {
        const individual = h.mode === 'individual';
        const total = h.stats.eligible;
        const rate = total ? 1 - h.stats.correct / total : 0;
        return { qid: h.qid, round: h.round, prompt: h.prompt, correctText: h.correctText, missRate: rate, basis: individual ? 'players' : 'teams' };
      })
      .filter(m => m.missRate > 0)
      .sort((x, y) => y.missRate - x.missRate)
      .slice(0, 5);
    const areas = {};
    for (const h of a.history) {
      if (h.type === 'scenario' || !h.area) continue;
      const ar = (areas[h.area] ||= { area: h.area, eligible: 0, correct: 0 });
      ar.eligible += h.stats.eligible;
      ar.correct += h.stats.correct;
    }
    const areaList = Object.values(areas)
      .map(x => ({ ...x, accuracy: x.eligible ? x.correct / x.eligible : 0 }))
      .sort((x, y) => x.accuracy - y.accuracy);
    const votes = voteCounts(a);
    return {
      participants: playersOf(e).length,
      teams,
      scoresByRound: a.scores,
      roundsPlayed: a.rounds.map(r => ({ round: r.round, title: r.title, mode: r.mode, count: r.items.length })),
      mostMissed: missed,
      areas: areaList,
      needsAwareness: areaList.filter(x => x.eligible && x.accuracy < 0.6).map(x => x.area),
      proposals: Object.entries(a.proposals).map(([t, p]) => ({
        team: Number(t), ...p, votes: votes[t] || 0, score: a.propScores[t]?.points ?? null, brief: briefFor(a, Number(t))?.title || '',
      })),
      note: 'For learning and team building only — not a performance evaluation.',
    };
  }

  // ---------- public / private views ----------
  function itemPublic(item, mode) {
    if (!item) return null;
    const base = {
      id: item.id, type: item.type, level: item.level, area: item.area, prompt: item.prompt, timer: item.timer,
      discussion: !!item.discussion, topic: item.topic || '', mode,
    };
    if (item.choices) base.choices = item.choices;
    if (item.type === 'match') Object.assign(base, { items: item.items, options: item.options });
    if (item.type === 'puzzle') base.clueCount = item.clues.length;
    if (item.type === 'scenario') base.rubric = item.rubric;
    return base;
  }

  function publicState(e) {
    const a = e.aim;
    if (!a) return null;
    const round = curRound(a);
    const item = ['question', 'reveal'].includes(a.phase) ? curItem(a) : null;
    const mode = item ? a.cur?.mode : round?.mode;
    const s = {
      phase: a.phase,
      roundIndex: a.ri,
      roundCount: a.rounds.length,
      round: round ? { round: round.round, title: round.title, desc: round.desc, mode: round.mode, count: round.items.length } : null,
      plan: a.rounds.map(r => ({ round: r.round, title: r.title, mode: r.mode, count: r.items.length })),
      itemIndex: a.ii,
      deadline: a.deadline,
      startedAt: a.startedAt,
      scores: a.scores,
      modeLabels: MODE_LABELS,
      rubric5: store.rubric5(),
    };
    if (item) {
      s.item = itemPublic(item, mode);
      const cur = a.cur;
      if (teamMode(cur.mode)) {
        s.progress = {
          kind: 'teams',
          done: Object.keys(cur.teamAnswers).length,
          of: Object.values(cur.eligible).filter(ids => ids.length).length,
          teamsDone: Object.keys(cur.teamAnswers).map(Number),
        };
      } else {
        const ids = Object.values(cur.eligible).flat();
        s.progress = { kind: 'players', done: ids.filter(id => cur.answers[id]).length, of: ids.length };
      }
    }
    if (a.phase === 'reveal') {
      const h = a.history[a.history.length - 1];
      s.reveal = {
        historyIndex: a.history.length - 1,
        answer: item.answer ?? null,
        answers: item.answers || null,
        points: item.points || null,
        correctText: h.correctText,
        explanation: item.explanation,
        source: item.source,
        perTeam: h.perTeam,
        stats: h.stats,
      };
    }
    if (round?.round === 5 || a.phase === 'final') {
      s.briefs = {};
      e.teams.forEach((_, t) => {
        const b = briefFor(a, t);
        if (b) s.briefs[t] = { title: b.title, budget: b.budget, constraints: b.constraints, focus: b.focus, prompt: b.prompt };
      });
      s.submitted = Object.entries(a.proposals).filter(([, p]) => p.submitted).map(([t]) => Number(t));
      s.drafting = Object.keys(a.proposals).map(Number);
      if (['vote', 'review', 'roundEnd', 'final'].includes(a.phase)) {
        s.proposals = a.proposals;
        s.voteCounts = voteCounts(a);
        s.votesCast = Object.keys(a.votes).length;
        s.propScores = a.propScores;
      }
    }
    if (a.phase === 'roundEnd' && round) {
      s.roundResults = a.history.filter(h => h.round === round.round).map(h => ({ prompt: h.prompt, correctText: h.correctText, stats: h.stats, type: h.type }));
    }
    if (a.phase === 'final') {
      s.awards = awards(e);
      s.summary = summary(e);
    }
    return s;
  }

  function privateState(e, pid) {
    const a = e.aim;
    if (!a) return null;
    const p = e.players[pid];
    if (!p) return null;
    const s = { key: `${a.ri}:${a.ii}:${a.phase}`, personal: a.personal[pid] || 0 };
    const cur = a.cur;
    if (['question', 'reveal'].includes(a.phase) && cur) {
      s.eligible = (cur.eligible[p.team] || []).includes(pid);
      if (curItem(a)?.type === 'puzzle') s.clues = a.phase === 'question' ? cur.clues[pid] || [] : [];
      if (teamMode(cur.mode)) {
        const ta = cur.teamAnswers[p.team];
        s.answer = ta ? { choice: ta.choice, matches: ta.matches, by: ta.by, rationale: ta.rationale, result: ta.result } : null;
        s.locked = !!ta;
      } else {
        const ans = cur.answers[pid];
        s.answer = ans ? { choice: ans.choice, matches: ans.matches, result: ans.result } : null;
        s.locked = !!ans;
      }
      if (a.phase === 'reveal') s.teamResult = a.history[a.history.length - 1]?.perTeam[p.team] || null;
    }
    if (curRound(a)?.round === 5) {
      s.proposal = a.proposals[p.team] || null;
      s.myVote = a.votes[pid] ?? null;
    }
    return s;
  }

  // ---------- host actions ----------
  function next(e) {
    const a = e.aim;
    const round = curRound(a);
    switch (a.phase) {
      case 'intro':
        if (round.mode === 'proposal') startWrite(e);
        else startItem(e, 0);
        return { ok: true };
      case 'question':
        reveal(e);
        return { ok: true };
      case 'reveal':
        if (a.ii + 1 < round.items.length) startItem(e, a.ii + 1);
        else {
          a.phase = 'roundEnd';
          broadcast(e);
        }
        return { ok: true };
      case 'write':
        clearTimers(e);
        a.phase = 'vote';
        a.deadline = null;
        broadcast(e);
        return { ok: true };
      case 'vote':
        a.phase = 'review';
        broadcast(e);
        return { ok: true };
      case 'review':
        a.phase = 'roundEnd';
        broadcast(e);
        return { ok: true };
      case 'roundEnd':
        if (a.ri + 1 < a.rounds.length) {
          a.ri += 1;
          a.ii = -1;
          a.phase = 'intro';
          a.cur = null;
          broadcast(e);
        } else {
          a.phase = 'final';
          a.cur = null;
          clearTimers(e);
          onFinish(e);
          broadcast(e);
        }
        return { ok: true };
      default:
        return { error: 'The AIM challenge is complete' };
    }
  }

  function answer(e, pid, payload = {}) {
    const a = e.aim;
    if (!a || a.phase !== 'question') return { error: 'This question is closed' };
    const p = e.players[pid];
    if (!p) return { error: 'Player not found' };
    const item = curItem(a);
    const { cur } = a;
    const ans = { at: now() };
    if (item.type === 'match') {
      const m = payload.matches;
      if (!Array.isArray(m) || m.length !== item.items.length || m.some(x => !Number.isInteger(x) || x < 0 || x >= item.options.length)) {
        return { error: 'Match every item before submitting' };
      }
      ans.matches = m;
    } else {
      if (!Number.isInteger(payload.choice) || payload.choice < 0 || payload.choice >= item.choices.length) return { error: 'Invalid answer' };
      ans.choice = payload.choice;
    }
    if (teamMode(cur.mode)) {
      if (cur.teamAnswers[p.team]) return { error: 'Your team has already answered' };
      if (!(cur.eligible[p.team] || []).length) cur.eligible[p.team] = [pid]; // team had nobody online when the question started
      ans.by = p.name;
      ans.pid = pid;
      ans.rationale = str(payload.rationale, 300);
      cur.teamAnswers[p.team] = ans;
    } else {
      if (!(cur.eligible[p.team] || []).includes(pid)) return { error: 'You joined during this question — you can answer the next one' };
      if (cur.answers[pid]) return { error: 'You already answered' };
      cur.answers[pid] = ans;
    }
    if (allAnswered(e)) reveal(e);
    else broadcast(e);
    return { ok: true };
  }

  function scoreItem(e, { historyIndex, team, checks, points }) {
    const a = e.aim;
    const h = a.history[historyIndex];
    if (!h) return { error: 'Question not found' };
    if (h.type !== 'scenario') return { error: 'Only scenario answers can be re-scored' };
    const r = h.perTeam[team];
    if (!r) return { error: 'Team not found' };
    const item = a.rounds.find(x => x.round === h.round)?.items.find(x => x.id === h.qid);
    let pts;
    if (Array.isArray(checks) && item?.rubric) {
      pts = item.rubric.reduce((sum, c, i) => sum + (checks[i] ? c.points : 0), 0);
      r.checks = item.rubric.map((_, i) => !!checks[i]);
    } else {
      pts = Number(points);
      if (!Number.isFinite(pts)) return { error: 'Invalid points' };
      delete r.checks;
    }
    r.points = Math.max(0, Math.min(150, Math.round(pts)));
    r.override = r.points !== r.auto;
    broadcast(e);
    return { ok: true };
  }

  function saveProposal(e, pid, payload = {}) {
    const a = e.aim;
    if (!a || a.phase !== 'write') return { error: 'Proposals are closed' };
    const p = e.players[pid];
    if (!p) return { error: 'Player not found' };
    const prev = a.proposals[p.team] || {};
    const next = {};
    for (const [k, max] of Object.entries(PROPOSAL_FIELDS)) next[k] = str(payload[k] ?? prev[k], max);
    if (next.pillar && !PILLARS.includes(next.pillar)) return { error: 'Choose Faster, Stronger or Better' };
    if (payload.submit) {
      const missing = Object.keys(PROPOSAL_FIELDS).filter(k => !next[k]);
      if (missing.length) return { error: 'Fill in every field before submitting' };
    }
    a.proposals[p.team] = { ...next, by: p.name, at: now(), submitted: !!payload.submit || !!prev.submitted };
    broadcast(e);
    return { ok: true };
  }

  function vote(e, pid, team) {
    const a = e.aim;
    if (!a || a.phase !== 'vote') return { error: 'Voting is closed' };
    const p = e.players[pid];
    if (!p) return { error: 'Player not found' };
    const t = Number(team);
    if (t === p.team) return { error: 'You can’t vote for your own team' };
    if (!a.proposals[t]?.name) return { error: 'That team has no proposal' };
    a.votes[pid] = t;
    broadcast(e);
    return { ok: true };
  }

  function scoreProposal(e, { team, values }) {
    const a = e.aim;
    if (!a || !['vote', 'review', 'roundEnd'].includes(a.phase)) return { error: 'Proposals can be scored during review' };
    const t = Number(team);
    if (!e.teams[t]) return { error: 'Team not found' };
    const rubric = store.rubric5();
    const clean = {};
    let weighted = 0;
    for (const r of rubric) {
      const v = Math.max(0, Math.min(10, Math.round(Number(values?.[r.key]) || 0)));
      clean[r.key] = v;
      weighted += (r.weight * v) / 10;
    }
    a.propScores[t] = { values: clean, points: Math.round((300 * weighted) / 100) };
    broadcast(e);
    return { ok: true };
  }

  function resume(e) {
    const a = e.aim;
    if (!a || !a.deadline) return;
    if (a.phase === 'question') {
      if (a.deadline <= now()) reveal(e);
      else schedule(e, () => reveal(e));
    } else if (a.phase === 'write') {
      if (a.deadline <= now()) closeWriting(e);
      else schedule(e, () => closeWriting(e));
    }
  }

  return { start, stop, next, answer, scoreItem, saveProposal, vote, scoreProposal, publicState, privateState, resume, recompute };
}
