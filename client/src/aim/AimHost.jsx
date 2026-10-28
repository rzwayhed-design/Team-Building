import React, { useEffect, useState } from 'react';
import {
  AimLogo, Countdown, ProgressBar, RoundStepper, MiniLeaderboard, TeamAvatar, Confetti, LETTERS, LEVEL_LABELS, TYPE_LABELS, pct,
} from './common.jsx';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const ROUND_NAMES = { 1: 'Know Your AIM', 2: 'Inside AIM', 3: 'The AIM Mission Quest', 4: 'Think Like an AIM Coach', 5: 'Build AIM’s Future' };

// ---------------------------------------------------------------- setup
export function AimSetup({ call, onCancel, game }) {
  const [ov, setOv] = useState(null);
  const [err, setErr] = useState('');
  const [configId, setConfigId] = useState('standard');
  const [rounds, setRounds] = useState(null);
  const [includePending, setIncludePending] = useState(false);
  const [randomize, setRandomize] = useState(true);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  const apply = (o, id) => {
    const c = o.configs.find(x => x.id === id) || o.configs[0];
    if (!c) return;
    setConfigId(c.id);
    setRounds(structuredClone(c.rounds));
    setIncludePending(!!c.includePending);
    setRandomize(c.randomize !== false);
    setMinutes(c.proposalMinutes || 10);
  };

  useEffect(() => {
    fetch(`${SERVER_URL}/api/aim/overview`)
      .then(r => r.json())
      .then(o => {
        setOv(o);
        apply(o, 'standard');
      })
      .catch(() => setErr('Could not load the AIM question bank.'));
  }, []);

  if (err) return <section className="panel"><p className="error">{err}</p><button className="ghost" onClick={onCancel}>Back</button></section>;
  if (!ov || !rounds) return <section className="panel center"><p>Loading AIM Academy Challenge…</p></section>;

  const avail = r => (includePending ? ov.rounds[r].ready + ov.rounds[r].pending : ov.rounds[r].ready);
  const setR = (r, patch) => setRounds(x => ({ ...x, [r]: { ...x[r], ...patch } }));
  const totalItems = [1, 2, 3, 4, 5].reduce((s, r) => s + Math.min(rounds[r].count, avail(r)), 0);

  async function start() {
    setBusy(true);
    const clean = {};
    for (const r of [1, 2, 3, 4, 5]) clean[r] = { count: Math.min(Number(rounds[r].count) || 0, avail(r)), mode: rounds[r].mode };
    await call('host:start', { gameId: 'aim', options: { configId, rounds: clean, includePending, randomize, proposalMinutes: minutes } });
    setBusy(false);
  }

  return (
    <section className="panel aim-setup">
      <div className="aim-setup-head">
        <AimLogo size={64} />
        <div>
          <small>ACADEMY TEAM BUILDING</small>
          <h2>{game?.name || 'AIM Academy Challenge'}</h2>
          <p className="aim-tagline">Faster. Stronger. Better. Together.</p>
        </div>
      </div>
      <p>{game?.description}</p>
      <div className="aim-chips">
        <span>👥 {game?.audience}</span><span>⏱ {game?.duration}</span><span>🏆 {game?.modeLabel}</span><span>📈 {game?.difficulty}</span>
      </div>

      <div className="aim-field-row">
        <label htmlFor="aim-config">Saved configuration</label>
        <select id="aim-config" value={configId} onChange={e => apply(ov, e.target.value)}>
          {ov.configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="aim-table-wrap">
        <table className="aim-table">
          <thead>
            <tr><th>Round</th><th>Ready</th><th>Questions</th><th>Mode</th></tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map(r => (
              <tr key={r}>
                <td><b>{r}. {ROUND_NAMES[r]}</b></td>
                <td>
                  {ov.rounds[r].ready}
                  {ov.rounds[r].pending > 0 && <span className="aim-pending"> +{ov.rounds[r].pending} pending</span>}
                </td>
                <td>
                  <input type="number" min="0" max={avail(r)} value={Math.min(rounds[r].count, avail(r))} aria-label={`Questions in round ${r}`}
                    onChange={e => setR(r, { count: Math.max(0, Math.min(avail(r), Number(e.target.value) || 0)) })} />
                </td>
                <td>
                  {r === 3 ? 'Collaborative puzzle' : r === 5 ? (
                    <span className="aim-inline">Team proposal ·
                      <input type="number" min="3" max="30" value={minutes} aria-label="Minutes to write proposals" onChange={e => setMinutes(Number(e.target.value) || 10)} /> min
                    </span>
                  ) : (
                    <select value={rounds[r].mode} aria-label={`Answer mode for round ${r}`} onChange={e => setR(r, { mode: e.target.value })}>
                      <option value="individual">Individual answers</option>
                      <option value="consensus">Team consensus</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(ov.rounds[4].ready === 0 || ov.rounds[5].ready === 0) && !includePending && (
        <p className="aim-note">
          Rounds 4 and 5 use hypothetical scenarios that need a facilitator’s approval before they are played. Review and approve them in the{' '}
          <a href="/?aim-bank" target="_blank" rel="noreferrer">AIM Question Bank</a>. Rounds with nothing approved are skipped.
        </p>
      )}
      <label className="aim-check"><input type="checkbox" checked={randomize} onChange={e => setRandomize(e.target.checked)} /> Pick questions at random from the bank</label>
      <label className="aim-check"><input type="checkbox" checked={includePending} onChange={e => setIncludePending(e.target.checked)} /> Include items pending confirmation (not recommended for live events)</label>
      <ul className="aim-modes">
        <li><b>Individual answers:</b> everyone answers on their own phone; team points are averaged over the players present, so bigger teams get no advantage.</li>
        <li><b>Team consensus:</b> the team discusses and one player submits the agreed answer.</li>
        <li><b>Collaborative puzzle:</b> each player gets different clues; only by combining them can the team solve it.</li>
      </ul>
      <div className="row">
        <button disabled={busy || totalItems === 0} onClick={start}>Start AIM Academy Challenge ({totalItems} items) →</button>
        <button className="ghost" onClick={onCancel}>Back to game library</button>
      </div>
      <p className="hint"><a href="/?aim-bank" target="_blank" rel="noreferrer">Open the AIM Question Bank</a> to add, edit or approve questions.</p>
    </section>
  );
}

// ---------------------------------------------------------------- stage
export function AimStage({ event, call, serverNow, onLeave }) {
  const a = event.aim;
  if (!a) return null;
  const teamsInPlay = event.teams.map((t, i) => ({ ...t, i })).filter(t => event.players.some(p => p.team === t.i));
  const nextLabel = {
    intro: a.round?.mode === 'proposal' ? 'Open proposal writing →' : 'Start round →',
    question: 'Reveal answer now',
    reveal: a.itemIndex + 1 < (a.round?.count || 0) ? 'Next question →' : 'Round results →',
    write: 'Close writing & start voting →',
    vote: 'Close voting & review →',
    review: 'Round results →',
    roundEnd: a.roundIndex + 1 < a.roundCount ? 'Next round →' : 'Final results →',
  }[a.phase];

  return (
    <div className="aim-stage">
      <div className="aim-topbar">
        <AimLogo size={46} />
        <div className="grow">
          <b>AIM Academy Challenge</b>
          <span>Faster. Stronger. Better. Together.</span>
        </div>
        <div className="code">PIN: {event.code}</div>
      </div>
      <RoundStepper plan={a.plan} current={a.phase === 'final' ? a.plan.length : a.roundIndex} />

      <div className="aim-grid">
        <div className="aim-main">
          {a.phase === 'intro' && <IntroCard a={a} />}
          {(a.phase === 'question' || a.phase === 'reveal') && a.item && (
            <QuestionStage a={a} event={event} call={call} serverNow={serverNow} teamsInPlay={teamsInPlay} />
          )}
          {a.phase === 'roundEnd' && <RoundEnd a={a} event={event} teamsInPlay={teamsInPlay} />}
          {['write', 'vote', 'review'].includes(a.phase) && <ProposalStage a={a} event={event} call={call} serverNow={serverNow} teamsInPlay={teamsInPlay} />}
          {a.phase === 'final' && <FinalStage a={a} event={event} call={call} />}

          {nextLabel && (
            <div className="aim-controls">
              <button onClick={() => call('aim:next')}>{nextLabel}</button>
            </div>
          )}
        </div>
        <aside className="aim-side">
          <h3>Live leaderboard</h3>
          <MiniLeaderboard event={event} />
          <p className="hint">{event.players.filter(p => p.connected).length} of {event.players.length} players online</p>
          {a.phase !== 'final' && <button className="link" onClick={() => call('host:lobby')}>Stop challenge and return to library</button>}
        </aside>
      </div>
    </div>
  );
}

function IntroCard({ a }) {
  const r = a.round;
  return (
    <div className="aim-intro" key={`${a.roundIndex}`}>
      <small>Round {a.roundIndex + 1} of {a.roundCount}</small>
      <h1>{r.title}</h1>
      <p>{r.desc}</p>
      <div className="aim-chips">
        <span>{a.modeLabels[r.mode]}</span>
        <span>{r.mode === 'proposal' ? `${r.count} brief${r.count > 1 ? 's' : ''}` : `${r.count} question${r.count > 1 ? 's' : ''}`}</span>
      </div>
    </div>
  );
}

function QuestionStage({ a, event, call, serverNow, teamsInPlay }) {
  const it = a.item;
  const rv = a.phase === 'reveal' ? a.reveal : null;
  return (
    <div className="aim-qcard" key={`${a.roundIndex}-${a.itemIndex}`}>
      <div className="aim-qhead">
        <div className="grow">
          <small>{a.round.title} · Question {a.itemIndex + 1}/{a.round.count} · {TYPE_LABELS[it.type]} · {LEVEL_LABELS[it.level] || ''}</small>
          <ProgressBar value={a.itemIndex + (rv ? 1 : 0)} max={a.round.count} />
        </div>
        {!rv && <Countdown startedAt={a.startedAt} deadline={a.deadline} serverNow={serverNow} />}
      </div>
      <div className="aim-badges">
        <span className="aim-badge">{a.modeLabels[it.mode]}</span>
        {it.discussion && <span className="aim-badge red">Team discussion</span>}
        {it.topic && <span className="aim-badge">{it.topic}</span>}
      </div>
      <h2 className="aim-prompt">{it.prompt}</h2>
      {it.type === 'puzzle' && !rv && <p className="aim-note">Each player has different clues on their phone ({it.clueCount} in total per team). Talk it through and combine them!</p>}

      {it.choices && (
        <ol className="aim-choices">
          {it.choices.map((c, i) => {
            const cls = rv ? (i === rv.answer ? 'correct' : rv.points && rv.points[i] > 0 ? 'partial' : 'dim') : '';
            return (
              <li key={i} className={cls}>
                <span className="letter">{LETTERS[i]}</span>
                <span className="txt">{c}</span>
                {rv?.points && <span className="pts">{rv.points[i]} pts</span>}
              </li>
            );
          })}
        </ol>
      )}
      {it.type === 'match' && (
        <div className="aim-match">
          {it.items.map((x, i) => (
            <div key={i} className="aim-match-row">
              <span className="item">{x}</span>
              <span className="arrow">→</span>
              <span className={`opt ${rv ? 'correct' : ''}`}>{rv ? it.options[rv.answers[i]] : '?'}</span>
            </div>
          ))}
          {!rv && <p className="hint">Options: {it.options.join(' · ')}</p>}
        </div>
      )}

      {!rv && a.progress && (
        <div className="aim-answered">
          {a.progress.kind === 'players' ? (
            <p><b>{a.progress.done}</b> of {a.progress.of} players answered</p>
          ) : (
            <div className="aim-teamchips">
              {teamsInPlay.map(t => (
                <span key={t.i} className={a.progress.teamsDone.includes(t.i) ? 'done' : ''}>
                  <TeamAvatar team={t.i} name={t.name} size={24} /> {t.name} {a.progress.teamsDone.includes(t.i) ? '✓' : '…'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {rv && (
        <div className="aim-reveal">
          <p className="aim-explain"><b>Why:</b> {rv.explanation}</p>
          <p className="hint">Source: {rv.source}</p>
          <div className="aim-results">
            {teamsInPlay.map(t => {
              const r = rv.perTeam[t.i];
              if (!r) return null;
              return (
                <div key={t.i} className={`aim-result ${r.correct ? 'ok' : ''}`}>
                  <TeamAvatar team={t.i} name={t.name} />
                  <div className="grow">
                    <b>{t.name}</b>
                    <span>
                      {r.answered ? r.answerText : 'No answer'}
                      {r.by ? ` — by ${r.by}` : ''}
                    </span>
                    {r.rationale && <em>“{r.rationale}”</em>}
                    {it.type === 'scenario' && <RubricScorer it={it} r={r} hi={rv.historyIndex} team={t.i} call={call} />}
                  </div>
                  <strong>+{r.points}{r.override ? ' ✎' : ''}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RubricScorer({ it, r, hi, team, call }) {
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState(r.checks || it.rubric.map(() => false));
  if (!it.rubric?.length) return null;
  const total = it.rubric.reduce((s, c, i) => s + (checks[i] ? c.points : 0), 0);
  return (
    <div className="aim-rubric">
      <button className="link" onClick={() => setOpen(!open)}>{open ? 'Hide rubric' : 'Review with rubric'}</button>
      {open && (
        <div>
          {it.rubric.map((c, i) => (
            <label key={i} className="aim-check">
              <input type="checkbox" checked={!!checks[i]} onChange={e => setChecks(x => x.map((v, j) => (j === i ? e.target.checked : v)))} />
              {c.label} <span className="hint">({c.points})</span>
            </label>
          ))}
          <div className="row">
            <button className="small" onClick={() => call('aim:scoreItem', { historyIndex: hi, team, checks })}>Award {total} pts</button>
            <button className="ghost small" onClick={() => call('aim:scoreItem', { historyIndex: hi, team, points: r.auto })}>Reset to {r.auto}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoundEnd({ a, event, teamsInPlay }) {
  const rn = a.round.round;
  const rows = teamsInPlay.map(t => ({ ...t, pts: a.scores[t.i]?.[rn] || 0, total: a.scores[t.i]?.total || 0 })).sort((x, y) => y.pts - x.pts);
  const top = Math.max(1, ...rows.map(r => r.pts));
  return (
    <div className="aim-roundend">
      <small>Round {a.roundIndex + 1} complete</small>
      <h1>{a.round.title}</h1>
      <div className="aim-bars">
        {rows.map(t => (
          <div key={t.i} className="aim-barrow">
            <TeamAvatar team={t.i} name={t.name} />
            <span className="name">{t.name}</span>
            <span className="barwrap"><span className="bar" style={{ width: `${(100 * t.pts) / top}%` }} /></span>
            <b>+{t.pts}</b>
          </div>
        ))}
      </div>
      {a.roundResults?.length > 0 && (
        <table className="aim-table">
          <thead><tr><th>Question</th><th>Correct</th></tr></thead>
          <tbody>
            {a.roundResults.map((q, i) => (
              <tr key={i}>
                <td>{q.prompt}</td>
                <td>{q.type === 'scenario' ? '—' : q.stats.eligible ? pct(q.stats.correct / q.stats.eligible) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProposalStage({ a, event, call, serverNow, teamsInPlay }) {
  const rubric = a.rubric5 || [];
  return (
    <div className="aim-qcard">
      <div className="aim-qhead">
        <div className="grow">
          <small>Build AIM’s Future · {a.phase === 'write' ? 'Teams are writing' : a.phase === 'vote' ? 'Peer voting' : 'Organizer review'}</small>
          <h2 className="aim-prompt">AIM can introduce one new initiative next year. Each team designs a proposal aligned with Faster, Stronger or Better.</h2>
        </div>
        {a.phase === 'write' && <Countdown startedAt={a.startedAt} deadline={a.deadline} serverNow={serverNow} />}
      </div>
      <div className="aim-proposals">
        {teamsInPlay.map(t => {
          const b = a.briefs?.[t.i];
          const p = a.proposals?.[t.i];
          const s = a.propScores?.[t.i];
          return (
            <div key={t.i} className="aim-proposal">
              <div className="head">
                <TeamAvatar team={t.i} name={t.name} />
                <b>{t.name}</b>
                {a.phase === 'write' && (
                  <span className="aim-badge">{a.submitted?.includes(t.i) ? 'Submitted ✓' : a.drafting?.includes(t.i) ? 'Drafting…' : 'Not started'}</span>
                )}
                {a.voteCounts && <span className="aim-badge red">{a.voteCounts[t.i] || 0} votes</span>}
              </div>
              {b && (
                <p className="hint">Brief “{b.title}”: budget {b.budget} · {b.constraints.join(' · ')}</p>
              )}
              {p && a.phase !== 'write' && (
                <dl>
                  <dt>Initiative</dt><dd>{p.name || '—'}</dd>
                  <dt>Pillar</dt><dd>{p.pillar || '—'}</dd>
                  <dt>Audience</dt><dd>{p.audience || '—'}</dd>
                  <dt>Expected impact</dt><dd>{p.impact || '—'}</dd>
                  <dt>Resources</dt><dd>{p.resources || '—'}</dd>
                  <dt>Success measures</dt><dd>{p.measure || '—'}</dd>
                </dl>
              )}
              {!p && a.phase !== 'write' && <p className="hint">No proposal submitted.</p>}
              {p && ['vote', 'review'].includes(a.phase) && <ProposalScorer team={t.i} rubric={rubric} saved={s} call={call} />}
            </div>
          );
        })}
      </div>
      {a.phase === 'vote' && <p className="hint">{a.votesCast || 0} votes cast. Players cannot vote for their own team.</p>}
    </div>
  );
}

function ProposalScorer({ team, rubric, saved, call }) {
  const [vals, setVals] = useState(saved?.values || Object.fromEntries(rubric.map(r => [r.key, 5])));
  const pts = Math.round((300 * rubric.reduce((s, r) => s + (r.weight * (vals[r.key] || 0)) / 10, 0)) / 100);
  return (
    <div className="aim-scorer">
      {rubric.map(r => (
        <label key={r.key}>
          <span>{r.label} ({r.weight}%)</span>
          <input type="range" min="0" max="10" value={vals[r.key] ?? 0} onChange={e => setVals(v => ({ ...v, [r.key]: Number(e.target.value) }))} />
          <b>{vals[r.key] ?? 0}/10</b>
        </label>
      ))}
      <div className="row">
        <button className="small" onClick={() => call('aim:scoreProposal', { team, values: vals })}>Save score: {pts} / 300</button>
        {saved && <span className="hint">Saved: {saved.points} pts</span>}
      </div>
    </div>
  );
}

function summaryText(event, a) {
  const s = a.summary;
  const name = t => event.teams[t]?.name || `Team ${t + 1}`;
  const lines = [
    `AIM Academy Challenge — ${event.title}`,
    `Participants: ${s.participants}`,
    `Teams: ${s.teams.filter(t => t.members).map(t => `${t.name} (${t.members})`).join(', ')}`,
    '',
    'Awards:',
    ...a.awards.map(w => `- ${w.label}: ${w.teams.length ? w.teams.map(name).join(' & ') : '—'}`),
    '',
    'Scores by round (R1/R2/R3/R4/R5 = total):',
    ...s.teams.filter(t => t.members).map(t => {
      const sc = s.scoresByRound[t.team];
      return `- ${t.name}: ${sc[1]}/${sc[2]}/${sc[3]}/${sc[4]}/${sc[5]} = ${sc.total}`;
    }),
    '',
    'Most frequently missed:',
    ...(s.mostMissed.length ? s.mostMissed.map(m => `- (${pct(m.missRate)} missed) ${m.prompt} → ${m.correctText}`) : ['- none']),
    '',
    `Areas needing greater awareness: ${s.needsAwareness.join(', ') || 'none'}`,
    '',
    'Innovation proposals:',
    ...(s.proposals.length ? s.proposals.map(p => `- ${name(p.team)}: ${p.name} (${p.pillar}) — score ${p.score ?? 'not scored'}, ${p.votes} votes`) : ['- none']),
    '',
    s.note,
  ];
  return lines.join('\n');
}

function FinalStage({ a, event, call }) {
  const [copied, setCopied] = useState(false);
  const s = a.summary;
  const name = t => event.teams[t]?.name;
  const overall = a.awards.find(w => w.key === 'overall');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(event, a));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="aim-final">
      <Confetti />
      <small>Faster. Stronger. Better. Together.</small>
      <h1>AIM Academy Champions</h1>
      {overall?.teams.length ? (
        <div className="aim-winner">
          {overall.teams.map(t => <TeamAvatar key={t} team={t} name={name(t)} size={72} />)}
          <h2>{overall.teams.map(name).join(' & ')}</h2>
          <p>{overall.score} points</p>
        </div>
      ) : <p>No points scored.</p>}
      <div className="aim-awards">
        {a.awards.filter(w => w.key !== 'overall').map(w => (
          <div key={w.key} className="aim-award">
            <small>{w.label}</small>
            <b>{w.teams.length ? w.teams.map(name).join(' & ') : '—'}</b>
          </div>
        ))}
      </div>

      <h3>Organizer summary</h3>
      <p className="hint">{s.note}</p>
      <p><b>{s.participants}</b> participants in <b>{s.teams.filter(t => t.members).length}</b> teams.</p>
      <div className="aim-table-wrap">
        <table className="aim-table">
          <thead><tr><th>Team</th>{a.plan.map(r => <th key={r.round}>R{r.round}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {s.teams.filter(t => t.members).map(t => (
              <tr key={t.team}>
                <td>{t.name} ({t.members})</td>
                {a.plan.map(r => <td key={r.round}>{s.scoresByRound[t.team]?.[r.round] ?? 0}</td>)}
                <td><b>{s.scoresByRound[t.team]?.total ?? 0}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.mostMissed.length > 0 && (
        <>
          <h4>Most frequently missed</h4>
          <ol className="aim-missed">
            {s.mostMissed.map(m => (
              <li key={m.qid}><b>{pct(m.missRate)}</b> of {m.basis} missed: {m.prompt} <span className="hint">→ {m.correctText}</span></li>
            ))}
          </ol>
        </>
      )}
      {s.areas.length > 0 && (
        <>
          <h4>Knowledge by area</h4>
          <div className="aim-areas">
            {s.areas.map(x => (
              <div key={x.area} className={x.accuracy < 0.6 ? 'weak' : ''}>
                <span>{x.area}</span>
                <span className="barwrap"><span className="bar" style={{ width: pct(x.accuracy) }} /></span>
                <b>{pct(x.accuracy)}</b>
              </div>
            ))}
          </div>
          {s.needsAwareness.length > 0 && <p className="aim-note">Areas needing greater awareness: {s.needsAwareness.join(', ')}</p>}
        </>
      )}
      {s.proposals.length > 0 && (
        <>
          <h4>Innovation proposals</h4>
          <ul className="aim-missed">
            {s.proposals.map(p => (
              <li key={p.team}><b>{name(p.team)}:</b> {p.name} ({p.pillar}) — {p.score ?? 'not scored'} pts, {p.votes} votes</li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <button onClick={copy}>{copied ? 'Summary copied ✓' : 'Copy organizer summary'}</button>
        <button className="ghost" onClick={() => call('host:lobby')}>Back to game library</button>
        <button className="ghost" onClick={() => call('host:endEvent')}>End event for everyone</button>
      </div>
    </div>
  );
}
