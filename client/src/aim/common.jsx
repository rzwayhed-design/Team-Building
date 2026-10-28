import React from 'react';

export const TEAM_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'];
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
export const LEVEL_LABELS = { factual: 'Knowledge', understanding: 'Understanding', application: 'Application', strategic: 'Strategic thinking' };
export const TYPE_LABELS = { mcq: 'Multiple choice', match: 'Matching', puzzle: 'Collaborative puzzle', scenario: 'Coaching scenario', proposal: 'Innovation brief' };
export const STATUS_LABELS = { verified: 'Verified from AIM catalogue', approved: 'Facilitator-approved scenario', pending: 'Pending confirmation' };

export function AimLogo({ size = 44 }) {
  return <img className="aim-logo" src="/aim-logo.png" alt="AIM Academy — Assess, Identify, Master" style={{ height: size }} />;
}

export function TeamAvatar({ team, name, size = 34 }) {
  const initials = String(name || '?')
    .replace(/^team\s+/i, '')
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="aim-avatar" style={{ background: TEAM_COLORS[team % TEAM_COLORS.length], width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials}
    </span>
  );
}

// Circular countdown. `startedAt`/`deadline` are server times; `serverNow` is the client's estimate of server time.
export function Countdown({ startedAt, deadline, serverNow, size = 92 }) {
  if (!deadline) return null;
  const total = Math.max(1, deadline - startedAt);
  const left = Math.max(0, deadline - serverNow);
  const frac = Math.max(0, Math.min(1, left / total));
  const secs = Math.ceil(left / 1000);
  const r = 40;
  const c = 2 * Math.PI * r;
  const label = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}`;
  return (
    <div className={`aim-countdown ${secs <= 10 ? 'low' : ''}`} style={{ width: size, height: size }} role="timer" aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <circle cx="50" cy="50" r={r} className="track" />
        <circle cx="50" cy="50" r={r} className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 50 50)" />
      </svg>
      <span style={{ fontSize: size * (label.length > 3 ? 0.2 : 0.28) }}>{label}</span>
    </div>
  );
}

export function ProgressBar({ value, max, label }) {
  const pct = max ? Math.round((100 * value) / max) : 0;
  return (
    <div className="aim-progress" aria-label={label || `${value} of ${max}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RoundStepper({ plan, current }) {
  return (
    <ol className="aim-stepper">
      {plan.map((r, i) => (
        <li key={r.round} className={i < current ? 'done' : i === current ? 'now' : ''}>
          <b>{r.round}</b>
          <span>{r.title}</span>
        </li>
      ))}
    </ol>
  );
}

export function MiniLeaderboard({ event }) {
  const scores = event.aim?.scores || {};
  const rows = event.teams
    .map((t, i) => ({ ...t, i, total: scores[i]?.total ?? t.score }))
    .filter(t => event.players.some(p => p.team === t.i))
    .sort((a, b) => b.total - a.total);
  const top = Math.max(1, ...rows.map(r => r.total));
  return (
    <div className="aim-mini-board">
      {rows.map((t, rank) => (
        <div key={t.i} className="row">
          <span className="rank">{rank + 1}</span>
          <TeamAvatar team={t.i} name={t.name} size={26} />
          <span className="name">{t.name}</span>
          <span className="barwrap"><span className="bar" style={{ width: `${(100 * t.total) / top}%`, background: TEAM_COLORS[t.i % 6] }} /></span>
          <b>{t.total}</b>
        </div>
      ))}
    </div>
  );
}

export function Confetti() {
  const pieces = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="aim-confetti" aria-hidden="true">
      {pieces.map(i => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 12) * 0.18}s`,
            background: ['#B91C1C', '#18181B', '#f87171', '#fbbf24'][i % 4],
            transform: `rotate(${i * 29}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export const pct = x => `${Math.round(x * 100)}%`;
