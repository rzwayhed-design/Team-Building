import React, { useEffect, useState } from 'react';
import { AimLogo, Countdown, ProgressBar, TeamAvatar, Confetti, LETTERS, TYPE_LABELS } from './common.jsx';

const MODE_HELP = {
  individual: 'Answer on your own. Your points are averaged into your team’s score.',
  consensus: 'Agree as a team. One teammate submits the answer for everyone.',
  collaborative: 'Each teammate gets different clues. Share yours out loud and solve it together.',
  proposal: 'Design one new initiative with your team, then vote for another team’s idea.',
};
const PILLARS = ['Faster', 'Stronger', 'Better'];
const FIELDS = [
  ['name', 'Initiative name', 'input'],
  ['audience', 'Target audience', 'input'],
  ['pillar', 'AIM pillar supported', 'pillar'],
  ['impact', 'Expected impact', 'text'],
  ['resources', 'Resources required (within your budget)', 'text'],
  ['measure', 'How success will be measured', 'text'],
];

export function AimPlayer({ event, me, priv, call, serverNow, onLeave }) {
  const a = event.aim;
  const p = priv?.aim || {};
  const team = event.teams[me.team];
  if (!a) return null;
  return (
    <div className="aim-phone">
      <div className="aim-phone-head">
        <AimLogo size={34} />
        <div className="grow">
          <b>{me.name}</b>
          <span><TeamAvatar team={me.team} name={team?.name} size={18} /> {team?.name} · {a.scores?.[me.team]?.total ?? 0} pts</span>
        </div>
        {a.round && a.phase !== 'final' && <span className="aim-badge">R{a.round.round}</span>}
      </div>

      {a.phase === 'intro' && (
        <section className="panel center aim-intro small">
          <small>Round {a.roundIndex + 1} of {a.roundCount}</small>
          <h1>{a.round.title}</h1>
          <p>{a.round.desc}</p>
          <p className="aim-note">{MODE_HELP[a.round.mode]}</p>
          <p className="hint">Get ready — the organizer will start the round.</p>
        </section>
      )}

      {(a.phase === 'question' || a.phase === 'reveal') && a.item && (
        <PlayerQuestion key={p.key} a={a} p={p} call={call} serverNow={serverNow} />
      )}

      {a.phase === 'roundEnd' && (
        <section className="panel center">
          <small>Round complete</small>
          <h2>{a.round.title}</h2>
          <p>Your team earned <b>{a.scores?.[me.team]?.[a.round.round] ?? 0}</b> points this round.</p>
          <TeamRank event={event} team={me.team} />
          <p className="hint">Waiting for the organizer…</p>
        </section>
      )}

      {a.phase === 'write' && <ProposalForm a={a} p={p} me={me} call={call} serverNow={serverNow} />}
      {a.phase === 'vote' && <VoteList a={a} p={p} me={me} event={event} call={call} />}
      {a.phase === 'review' && (
        <section className="panel center">
          <h2>Proposals under review</h2>
          <p>The organizer is scoring each proposal for alignment, feasibility, impact and creativity.</p>
          {a.voteCounts && <p>Your team received <b>{a.voteCounts[me.team] || 0}</b> peer votes.</p>}
        </section>
      )}

      {a.phase === 'final' && <PlayerFinal a={a} event={event} me={me} p={p} />}
    </div>
  );
}

function TeamRank({ event, team }) {
  const scores = event.aim.scores || {};
  const ranked = event.teams
    .map((t, i) => ({ i, total: scores[i]?.total || 0 }))
    .filter(t => event.players.some(p => p.team === t.i))
    .sort((x, y) => y.total - x.total);
  const pos = ranked.findIndex(t => t.i === team) + 1;
  return <p>Your team is <b>#{pos}</b> of {ranked.length}.</p>;
}

function PlayerQuestion({ a, p, call, serverNow }) {
  const it = a.item;
  const rv = a.phase === 'reveal';
  const [choice, setChoice] = useState(null);
  const [matches, setMatches] = useState(() => (it.items ? it.items.map(() => -1) : []));
  const [rationale, setRationale] = useState('');
  const [sending, setSending] = useState(false);
  const locked = !!p.locked;
  const teamMode = it.mode !== 'individual';
  const mine = p.answer;

  async function submit() {
    setSending(true);
    const payload = it.type === 'match' ? { matches } : { choice };
    if (teamMode && it.type === 'scenario') payload.rationale = rationale;
    await call('aim:answer', payload);
    setSending(false);
  }
  const ready = it.type === 'match' ? matches.every(m => m >= 0) : choice !== null;
  const shown = mine?.choice ?? choice;

  return (
    <section className="panel aim-qcard phone">
      <div className="aim-qhead">
        <div className="grow">
          <small>{a.round.title} · {a.itemIndex + 1}/{a.round.count}</small>
          <ProgressBar value={a.itemIndex + (rv ? 1 : 0)} max={a.round.count} />
        </div>
        {!rv && <Countdown startedAt={a.startedAt} deadline={a.deadline} serverNow={serverNow} size={64} />}
      </div>
      <div className="aim-badges">
        <span className="aim-badge">{TYPE_LABELS[it.type]}</span>
        {a.modeLabels[it.mode] !== TYPE_LABELS[it.type] && <span className="aim-badge">{a.modeLabels[it.mode]}</span>}
        {it.discussion && <span className="aim-badge red">Agree as a team</span>}
      </div>
      <h2 className="aim-prompt">{it.prompt}</h2>

      {it.type === 'puzzle' && !rv && (
        <div className="aim-clues">
          <b>🔐 Your private clue{(p.clues || []).length > 1 ? 's' : ''}</b>
          {(p.clues || []).length ? <ul>{p.clues.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>You joined after the clues were handed out — help your teammates combine theirs.</p>}
          <small>Read them out loud. Don’t show your screen!</small>
        </div>
      )}

      {!rv && p.eligible === false && it.mode === 'individual' && (
        <p className="aim-note">You joined during this question — you can answer the next one.</p>
      )}

      {it.choices && (
        <div className="aim-options">
          {it.choices.map((c, i) => {
            let cls = shown === i ? 'picked' : '';
            if (rv) cls = i === a.reveal.answer ? 'correct' : shown === i ? 'wrong' : 'dim';
            return (
              <button key={i} className={`aim-option ${cls}`} disabled={locked || rv || (p.eligible === false && !teamMode)} onClick={() => setChoice(i)}>
                <span className="letter">{LETTERS[i]}</span>
                <span>{c}</span>
                {rv && a.reveal.points && <span className="pts">{a.reveal.points[i]}</span>}
              </button>
            );
          })}
        </div>
      )}

      {it.type === 'match' && (
        <div className="aim-matchform">
          {it.items.map((x, i) => {
            const val = mine?.matches ? mine.matches[i] : matches[i];
            const ok = rv ? a.reveal.answers[i] === val : null;
            return (
              <label key={i} className={rv ? (ok ? 'ok' : 'bad') : ''}>
                <span>{x}</span>
                <select value={val} disabled={locked || rv} onChange={e => setMatches(m => m.map((v, j) => (j === i ? Number(e.target.value) : v)))}>
                  <option value={-1}>Choose…</option>
                  {it.options.map((o, j) => <option key={j} value={j}>{o}</option>)}
                </select>
                {rv && !ok && <small>✓ {it.options[a.reveal.answers[i]]}</small>}
              </label>
            );
          })}
        </div>
      )}

      {!rv && teamMode && it.type === 'scenario' && !locked && (
        <>
          <label htmlFor="aim-rationale">Why did your team choose this? (optional, shown to the facilitator)</label>
          <textarea id="aim-rationale" maxLength={300} value={rationale} onChange={e => setRationale(e.target.value)} />
        </>
      )}

      {!rv && !locked && (
        <button className="aim-submit" disabled={!ready || sending || (p.eligible === false && !teamMode)} onClick={submit}>
          {teamMode ? 'Submit for my team' : 'Submit answer'}
        </button>
      )}
      {!rv && locked && (
        <p className="success">
          {teamMode ? `✓ Your team answered${mine?.by ? ` (submitted by ${mine.by})` : ''}.` : '✓ Answer submitted.'} Waiting for the others…
        </p>
      )}

      {rv && (
        <div className="aim-reveal phone">
          <ResultLine it={it} p={p} />
          <p><b>Answer:</b> {a.reveal.correctText}</p>
          <p className="aim-explain">{a.reveal.explanation}</p>
          <p className="hint">Source: {a.reveal.source}</p>
        </div>
      )}
    </section>
  );
}

function ResultLine({ it, p }) {
  const mineRes = p.answer?.result;
  const team = p.teamResult;
  if (it.mode === 'individual') {
    if (!p.answer) return <h3>⏱ No answer this time</h3>;
    return (
      <h3>
        {mineRes?.correct ? '🎉 Correct!' : it.type === 'scenario' ? '📝 Answer scored' : '❌ Not quite'} +{mineRes?.points ?? 0}
        <span className="hint"> · team +{team?.points ?? 0}</span>
      </h3>
    );
  }
  if (!team?.answered) return <h3>⏱ Your team didn’t answer</h3>;
  return <h3>{team.correct ? '🎉 Your team got it!' : it.type === 'scenario' ? '📝 Team answer scored' : '❌ Not this time'} +{team.points}</h3>;
}

function ProposalForm({ a, p, me, call, serverNow }) {
  const brief = a.briefs?.[me.team];
  const saved = p.proposal;
  const [form, setForm] = useState(() => ({ ...emptyForm(), ...(saved || {}) }));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!dirty && saved) setForm(f => ({ ...f, ...pick(saved) }));
  }, [saved?.at]);
  const set = (k, v) => {
    setDirty(true);
    setForm(f => ({ ...f, [k]: v }));
  };
  async function save(submit) {
    const r = await call('aim:proposal', { ...form, submit });
    if (r.ok) {
      setDirty(false);
      setMsg(submit ? 'Submitted ✓ You can still improve it until time runs out.' : 'Draft saved ✓');
    }
  }
  return (
    <section className="panel aim-qcard phone">
      <div className="aim-qhead">
        <div className="grow">
          <small>Build AIM’s Future</small>
          <h2 className="aim-prompt">Design one new initiative for AIM</h2>
        </div>
        <Countdown startedAt={a.startedAt} deadline={a.deadline} serverNow={serverNow} size={64} />
      </div>
      {brief && (
        <div className="aim-brief">
          <b>Your brief: {brief.title}</b>
          <p>Budget: <b>{brief.budget}</b></p>
          <ul>{brief.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
      <p className="hint">Anyone on your team can edit. {saved ? `Last saved by ${saved.by}${saved.submitted ? ' · submitted' : ''}.` : 'Nothing saved yet.'}</p>
      {FIELDS.map(([k, label, kind]) => (
        <div key={k}>
          <label htmlFor={`aim-${k}`}>{label}</label>
          {kind === 'pillar' ? (
            <select id={`aim-${k}`} value={form[k]} onChange={e => set(k, e.target.value)}>
              <option value="">Choose a pillar…</option>
              {PILLARS.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          ) : kind === 'text' ? (
            <textarea id={`aim-${k}`} maxLength={500} value={form[k]} onChange={e => set(k, e.target.value)} />
          ) : (
            <input id={`aim-${k}`} maxLength={k === 'name' ? 80 : 160} value={form[k]} onChange={e => set(k, e.target.value)} />
          )}
        </div>
      ))}
      <div className="row">
        <button className="ghost" onClick={() => save(false)}>Save draft</button>
        <button onClick={() => save(true)}>Submit proposal</button>
      </div>
      {msg && <p className="success">{msg}</p>}
    </section>
  );
}
const emptyForm = () => ({ name: '', audience: '', pillar: '', impact: '', resources: '', measure: '' });
const pick = s => ({ name: s.name, audience: s.audience, pillar: s.pillar, impact: s.impact, resources: s.resources, measure: s.measure });

function VoteList({ a, p, me, event, call }) {
  const entries = Object.entries(a.proposals || {}).filter(([, x]) => x.name);
  return (
    <section className="panel">
      <h2>Vote for the most promising initiative</h2>
      <p className="hint">You can’t vote for your own team. You can change your vote until voting closes.</p>
      {entries.map(([t, x]) => {
        const ti = Number(t);
        const own = ti === me.team;
        return (
          <div key={t} className={`aim-proposal ${p.myVote === ti ? 'voted' : ''}`}>
            <div className="head">
              <TeamAvatar team={ti} name={event.teams[ti]?.name} />
              <b>{x.name}</b>
              <span className="aim-badge">{x.pillar}</span>
            </div>
            <p><b>For:</b> {x.audience}</p>
            <p><b>Impact:</b> {x.impact}</p>
            <p><b>Resources:</b> {x.resources}</p>
            <p><b>Success measure:</b> {x.measure}</p>
            {own ? <p className="hint">Your team’s proposal</p> : (
              <button className={p.myVote === ti ? '' : 'ghost'} onClick={() => call('aim:vote', { team: ti })}>
                {p.myVote === ti ? '✓ Your vote' : 'Vote for this'}
              </button>
            )}
          </div>
        );
      })}
      {!entries.length && <p>No proposals were submitted.</p>}
    </section>
  );
}

function PlayerFinal({ a, event, me, p }) {
  const name = t => event.teams[t]?.name;
  const mine = a.awards.filter(w => w.teams.includes(me.team));
  const overall = a.awards.find(w => w.key === 'overall');
  return (
    <section className="panel center aim-final phone">
      <Confetti />
      <small>Faster. Stronger. Better. Together.</small>
      <h1>AIM Academy Champions</h1>
      {overall?.teams.length > 0 && <h2>🏆 {overall.teams.map(name).join(' & ')}</h2>}
      <TeamRank event={event} team={me.team} />
      {mine.length > 0 && (
        <div className="aim-awards">
          {mine.map(w => <div key={w.key} className="aim-award"><small>Your team won</small><b>{w.label}</b></div>)}
        </div>
      )}
      <p className="hint">{a.summary?.note}</p>
    </section>
  );
}
