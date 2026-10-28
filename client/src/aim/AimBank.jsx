import React, { useEffect, useMemo, useState } from 'react';
import { AimLogo, LETTERS, LEVEL_LABELS, TYPE_LABELS, STATUS_LABELS } from './common.jsx';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const KEY_STORE = 'aim-bank-key';
const ROUND_NAMES = { 1: 'Know Your AIM', 2: 'Inside AIM', 3: 'The AIM Mission Quest', 4: 'Think Like an AIM Coach', 5: 'Build AIM’s Future' };
const session = {
  get() { try { return sessionStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(KEY_STORE, v); } catch {} },
};

async function api(path, { method = 'GET', body, key } = {}) {
  const res = await fetch(`${SERVER_URL}/api/aim${path}`, {
    method,
    headers: { 'x-aim-key': key || '', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const blank = type => ({
  type, round: type === 'scenario' ? 4 : type === 'puzzle' ? 3 : type === 'proposal' ? 5 : 1,
  level: type === 'scenario' ? 'application' : type === 'proposal' ? 'strategic' : 'factual',
  status: 'pending', active: true, area: '', prompt: '', explanation: '', source: '',
  choices: ['', '', '', ''], answer: 0, clues: ['', '', '', ''], points: [150, 90, 45, 0],
  rubric: [{ label: '', points: 150 }], topic: '', discussion: false,
  items: ['', ''], options: ['', ''], answers: [0, 1], title: '', budget: '', constraints: [''], focus: 'Any pillar',
});

export function AimBank() {
  const [key, setKey] = useState(session.get());
  const [keyInput, setKeyInput] = useState('');
  const [bank, setBank] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('questions');

  async function load(k = key) {
    setErr('');
    try {
      const b = await api('/bank', { key: k });
      setBank(b);
      session.set(k);
      setKey(k);
    } catch (e) {
      setErr(e.message);
      setBank(null);
    }
  }
  useEffect(() => { if (key) load(key); }, []);
  useEffect(() => { document.body.classList.add('aim'); return () => document.body.classList.remove('aim'); }, []);

  const flash = m => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <main className="aim-bank">
      <header>
        <span className="brand"><AimLogo size={36} /> AIM Question Bank</span>
        <a href="/">← Back to TEAM UP</a>
      </header>
      {!bank && (
        <section className="panel narrow">
          <h1>Organizer access</h1>
          <p>Enter the question bank key (the <code>AIM_ADMIN_KEY</code> set on the server).</p>
          <label htmlFor="aim-key">Question bank key</label>
          <input id="aim-key" type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(keyInput)} />
          <button onClick={() => load(keyInput)} disabled={!keyInput}>Open question bank</button>
          {err && <p className="error">{err}</p>}
        </section>
      )}
      {bank && (
        <>
          <nav className="aim-tabs">
            {[['questions', `Questions (${bank.questions.length})`], ['facts', 'Academy facts'], ['configs', 'Game configurations'], ['io', 'Import / export']].map(([k, l]) => (
              <button key={k} className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>
          {msg && <div className="notice">{msg}</div>}
          {err && <div className="error">{err}</div>}
          {tab === 'questions' && <QuestionsTab bank={bank} keyv={key} reload={load} flash={flash} setErr={setErr} />}
          {tab === 'facts' && <FactsTab bank={bank} keyv={key} reload={load} flash={flash} setErr={setErr} />}
          {tab === 'configs' && <ConfigsTab bank={bank} keyv={key} reload={load} flash={flash} setErr={setErr} />}
          {tab === 'io' && <ImportTab bank={bank} keyv={key} reload={load} flash={flash} setErr={setErr} />}
          <p className="hint aim-persist-note">
            Edits are saved on the server. On hosting without a persistent disk (for example Render’s free plan) they are lost when the server restarts —
            use <b>Import / export → Download bank JSON</b> and commit it as <code>server/aim/bank.json</code> to make them permanent.
          </p>
        </>
      )}
    </main>
  );
}

function QuestionsTab({ bank, keyv, reload, flash, setErr }) {
  const [f, setF] = useState({ round: '', status: '', type: '', q: '', active: '' });
  const [sel, setSel] = useState([]);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const list = useMemo(() => bank.questions.filter(q =>
    (!f.round || q.round === Number(f.round)) && (!f.status || q.status === f.status) && (!f.type || q.type === f.type) &&
    (f.active === '' || String(q.active) === f.active) &&
    (!f.q || JSON.stringify(q).toLowerCase().includes(f.q.toLowerCase()))), [bank, f]);
  const pendingScenarios = bank.questions.filter(q => (q.round === 4 || q.round === 5) && q.status === 'pending').length;

  async function bulk(status, active) {
    try {
      const r = await api('/status', { method: 'POST', key: keyv, body: { ids: sel, status, active } });
      flash(`Updated ${r.updated} item(s)`);
      setSel([]);
      reload();
    } catch (e) { setErr(e.message); }
  }
  async function del(id) {
    try {
      await api(`/questions/${encodeURIComponent(id)}`, { method: 'DELETE', key: keyv });
      flash('Deleted');
      setConfirmDel(null);
      reload();
    } catch (e) { setErr(e.message); }
  }

  if (editing) return <Editor initial={editing} keyv={keyv} onDone={saved => { setEditing(null); if (saved) { flash('Saved'); reload(); } }} />;

  return (
    <section className="panel">
      {pendingScenarios > 0 && (
        <div className="aim-note">
          <b>{pendingScenarios} hypothetical scenarios and briefs are pending confirmation</b> and won’t be played until a facilitator approves them.
          Review them (filter: status “Pending”), select, and choose “Mark facilitator-approved”.
        </div>
      )}
      <div className="aim-filters">
        <select aria-label="Round" value={f.round} onChange={e => setF({ ...f, round: e.target.value })}>
          <option value="">All rounds</option>
          {[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>Round {r}: {ROUND_NAMES[r]}</option>)}
        </select>
        <select aria-label="Status" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Type" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Active" value={f.active} onChange={e => setF({ ...f, active: e.target.value })}>
          <option value="">Active and inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
        <input aria-label="Search" placeholder="Search…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
      </div>
      <div className="aim-bulk">
        <span>{sel.length} selected</span>
        <button className="small" disabled={!sel.length} onClick={() => bulk('approved')}>Mark facilitator-approved</button>
        <button className="small ghost" disabled={!sel.length} onClick={() => bulk('verified')}>Mark verified</button>
        <button className="small ghost" disabled={!sel.length} onClick={() => bulk('pending')}>Mark pending</button>
        <button className="small ghost" disabled={!sel.length} onClick={() => bulk(undefined, true)}>Activate</button>
        <button className="small ghost" disabled={!sel.length} onClick={() => bulk(undefined, false)}>Deactivate</button>
        <span className="grow" />
        <select aria-label="New question type" onChange={e => { if (e.target.value) setEditing(blank(e.target.value)); e.target.value = ''; }} defaultValue="">
          <option value="">+ New question…</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="aim-table-wrap">
        <table className="aim-table aim-qtable">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all" checked={list.length > 0 && list.every(q => sel.includes(q.id))}
                onChange={e => setSel(e.target.checked ? [...new Set([...sel, ...list.map(q => q.id)])] : sel.filter(id => !list.some(q => q.id === id)))} /></th>
              <th>R</th><th>Question</th><th>Type · level</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map(q => (
              <tr key={q.id} className={q.active ? '' : 'inactive'}>
                <td><input type="checkbox" aria-label={`Select ${q.id}`} checked={sel.includes(q.id)} onChange={e => setSel(e.target.checked ? [...sel, q.id] : sel.filter(x => x !== q.id))} /></td>
                <td>{q.round}</td>
                <td>
                  <div className="qtext">{q.prompt || q.title}</div>
                  <small className="hint">{q.id} · {q.source}{q.area ? ` · ${q.area}` : ''}{q.active ? '' : ' · inactive'}</small>
                </td>
                <td>{TYPE_LABELS[q.type]}<br /><small className="hint">{LEVEL_LABELS[q.level]}</small></td>
                <td><span className={`aim-status ${q.status}`}>{STATUS_LABELS[q.status]}</span></td>
                <td className="actions">
                  <button className="small ghost" onClick={() => setPreview(q)}>Preview</button>
                  <button className="small ghost" onClick={() => setEditing(structuredClone({ ...blank(q.type), ...q }))}>Edit</button>
                  {confirmDel === q.id ? (
                    <>
                      <button className="small" onClick={() => del(q.id)}>Confirm delete</button>
                      <button className="small ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                    </>
                  ) : <button className="small ghost" onClick={() => setConfirmDel(q.id)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview && <Preview q={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

function Preview({ q, onClose }) {
  return (
    <div className="aim-modal" role="dialog" aria-label="Question preview" onClick={onClose}>
      <div className="aim-phone-frame" onClick={e => e.stopPropagation()}>
        <small>{TYPE_LABELS[q.type]} · Round {q.round} · {LEVEL_LABELS[q.level]}</small>
        <h3>{q.prompt || q.title}</h3>
        {q.type === 'puzzle' && <div className="aim-clues"><b>Clues (split across teammates)</b><ul>{q.clues.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        {q.choices && q.choices.map((c, i) => (
          <div key={i} className={`aim-option ${i === q.answer ? 'correct' : ''}`}>
            <span className="letter">{LETTERS[i]}</span><span>{c}</span>{q.points && <span className="pts">{q.points[i]}</span>}
          </div>
        ))}
        {q.type === 'match' && q.items.map((x, i) => <p key={i}>{x} → <b>{q.options[q.answers[i]]}</b></p>)}
        {q.type === 'proposal' && <><p>Budget: <b>{q.budget}</b></p><ul>{q.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
        {q.rubric && <><b>Rubric</b><ul>{q.rubric.map((r, i) => <li key={i}>{r.label} — {r.points}</li>)}</ul></>}
        {q.explanation && <p className="aim-explain">{q.explanation}</p>}
        <p className="hint">Source: {q.source} · Answer order is shuffled in live games.</p>
        <button onClick={onClose}>Close preview</button>
      </div>
    </div>
  );
}

function ListEditor({ label, values, onChange, min = 1, max = 8, placeholder }) {
  return (
    <div className="aim-listedit">
      <label>{label}</label>
      {values.map((v, i) => (
        <div key={i} className="row">
          <input value={v} placeholder={placeholder} aria-label={`${label} ${i + 1}`} onChange={e => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          {values.length > min && <button className="small ghost" onClick={() => onChange(values.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {values.length < max && <button className="small ghost" onClick={() => onChange([...values, ''])}>+ Add</button>}
    </div>
  );
}

function Editor({ initial, keyv, onDone }) {
  const [q, setQ] = useState(initial);
  const [err, setErr] = useState('');
  const set = (k, v) => setQ(x => ({ ...x, [k]: v }));
  const isNew = !initial.id;
  async function save() {
    setErr('');
    const body = { ...q, round: Number(q.round), answer: Number(q.answer), timer: q.timer ? Number(q.timer) : undefined };
    if (q.type === 'scenario') body.points = q.points.map(Number);
    if (q.type === 'match') body.answers = q.answers.map(Number);
    try {
      if (isNew) await api('/questions', { method: 'POST', key: keyv, body });
      else await api(`/questions/${encodeURIComponent(q.id)}`, { method: 'PUT', key: keyv, body });
      onDone(true);
    } catch (e) { setErr(e.message); }
  }
  const hasChoices = ['mcq', 'puzzle', 'scenario'].includes(q.type);
  return (
    <section className="panel aim-editor">
      <h2>{isNew ? 'New' : 'Edit'} {TYPE_LABELS[q.type].toLowerCase()} {q.id ? <small className="hint">{q.id}</small> : null}</h2>
      <div className="aim-form-grid">
        <label>Round<select value={q.round} onChange={e => set('round', Number(e.target.value))}>{[1, 2, 3, 4, 5].map(r => <option key={r} value={r}>{r}. {ROUND_NAMES[r]}</option>)}</select></label>
        <label>Difficulty<select value={q.level} onChange={e => set('level', e.target.value)}>{Object.entries(LEVEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Verification<select value={q.status} onChange={e => set('status', e.target.value)}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Timer (seconds, blank = default)<input type="number" min="10" max="1200" value={q.timer || ''} onChange={e => set('timer', e.target.value)} /></label>
        <label>Area / topic<input value={q.area || ''} onChange={e => set('area', e.target.value)} /></label>
        <label className="aim-check"><input type="checkbox" checked={q.active} onChange={e => set('active', e.target.checked)} /> Active</label>
      </div>
      {q.type === 'proposal' ? (
        <>
          <label>Brief title<input value={q.title} onChange={e => set('title', e.target.value)} /></label>
          <label>Budget<input value={q.budget} onChange={e => set('budget', e.target.value)} placeholder="$5,000" /></label>
          <ListEditor label="Resource constraints" values={q.constraints} onChange={v => set('constraints', v)} />
        </>
      ) : (
        <label>Question<textarea value={q.prompt} onChange={e => set('prompt', e.target.value)} /></label>
      )}
      {q.type === 'puzzle' && <ListEditor label="Clues (split between teammates — each should be needed)" values={q.clues} onChange={v => set('clues', v)} min={2} />}
      {hasChoices && (
        <div className="aim-listedit">
          <label>Answer choices — {q.type === 'scenario' ? 'points per response (the highest is the strongest)' : 'select the one correct answer'}</label>
          {q.choices.map((c, i) => (
            <div key={i} className="row">
              {q.type !== 'scenario' && <input type="radio" name="correct" aria-label={`Choice ${LETTERS[i]} is correct`} checked={Number(q.answer) === i} onChange={() => set('answer', i)} />}
              <span className="letter">{LETTERS[i]}</span>
              <input value={c} aria-label={`Choice ${LETTERS[i]}`} onChange={e => set('choices', q.choices.map((x, j) => (j === i ? e.target.value : x)))} />
              {q.type === 'scenario' && (
                <input type="number" className="pts" min="0" max="150" aria-label={`Points for ${LETTERS[i]}`} value={q.points[i]}
                  onChange={e => set('points', q.points.map((x, j) => (j === i ? e.target.value : x)))} />
              )}
            </div>
          ))}
        </div>
      )}
      {q.type === 'scenario' && (
        <>
          <label>Topic<input value={q.topic} onChange={e => set('topic', e.target.value)} /></label>
          <label className="aim-check"><input type="checkbox" checked={!!q.discussion} onChange={e => set('discussion', e.target.checked)} /> Team discussion challenge (team must agree on one answer)</label>
          <div className="aim-listedit">
            <label>Rubric (points must add up to 150)</label>
            {q.rubric.map((r, i) => (
              <div key={i} className="row">
                <input value={r.label} aria-label={`Criterion ${i + 1}`} onChange={e => set('rubric', q.rubric.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input type="number" className="pts" aria-label={`Points for criterion ${i + 1}`} value={r.points} onChange={e => set('rubric', q.rubric.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) } : x)))} />
                {q.rubric.length > 1 && <button className="small ghost" onClick={() => set('rubric', q.rubric.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            <button className="small ghost" onClick={() => set('rubric', [...q.rubric, { label: '', points: 0 }])}>+ Add criterion</button>
            <p className="hint">Total: {q.rubric.reduce((s, r) => s + (Number(r.points) || 0), 0)} / 150</p>
          </div>
        </>
      )}
      {q.type === 'match' && (
        <>
          <ListEditor label="Options (right-hand side)" values={q.options} onChange={v => set('options', v)} min={2} />
          <div className="aim-listedit">
            <label>Items and their correct option</label>
            {q.items.map((it, i) => (
              <div key={i} className="row">
                <input value={it} aria-label={`Item ${i + 1}`} onChange={e => set('items', q.items.map((x, j) => (j === i ? e.target.value : x)))} />
                <select aria-label={`Correct option for item ${i + 1}`} value={q.answers[i] ?? 0} onChange={e => set('answers', q.answers.map((x, j) => (j === i ? Number(e.target.value) : x)))}>
                  {q.options.map((o, j) => <option key={j} value={j}>{o || `Option ${j + 1}`}</option>)}
                </select>
                {q.items.length > 2 && <button className="small ghost" onClick={() => { set('items', q.items.filter((_, j) => j !== i)); set('answers', q.answers.filter((_, j) => j !== i)); }}>Remove</button>}
              </div>
            ))}
            {q.items.length < 8 && <button className="small ghost" onClick={() => { set('items', [...q.items, '']); set('answers', [...q.answers, 0]); }}>+ Add item</button>}
          </div>
        </>
      )}
      {q.type !== 'proposal' && <label>Explanation (shown after the answer)<textarea value={q.explanation} onChange={e => set('explanation', e.target.value)} /></label>}
      <label>Source (catalogue page, or “Hypothetical scenario”)<input value={q.source} onChange={e => set('source', e.target.value)} /></label>
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button onClick={save}>Save</button>
        <button className="ghost" onClick={() => onDone(false)}>Cancel</button>
      </div>
    </section>
  );
}

function FactsTab({ bank, keyv, reload, flash, setErr }) {
  const p = bank.profile;
  const [act, setAct] = useState(p.activationDate);
  const [cv, setCv] = useState(p.coreValues);
  async function save() {
    try {
      await api('/profile', { method: 'PUT', key: keyv, body: { activationDate: act, coreValues: cv } });
      flash('Academy facts saved');
      reload();
    } catch (e) { setErr(e.message); }
  }
  return (
    <section className="panel">
      <h2>{p.name} — {p.meaning}</h2>
      <dl className="aim-facts">
        <dt>Established</dt><dd>{p.established} · began as a {p.origin.toLowerCase()}</dd>
        <dt>Founder</dt><dd>{p.founder}</dd>
        <dt>Mission</dt><dd>{p.mission}</dd>
        <dt>Vision</dt><dd>{p.vision}</dd>
        <dt>Figures</dt><dd>{p.figuresNote}</dd>
      </dl>
      <h3>Facts to confirm</h3>
      <p className="hint">These are not stated in the catalogue. Fill them in only once confirmed; no questions use them until you add some.</p>
      <div className="aim-form-grid">
        <label>AIM activation date<input value={act.value} onChange={e => setAct({ ...act, value: e.target.value })} placeholder="Not confirmed" /></label>
        <label>Status<select value={act.status} onChange={e => setAct({ ...act, status: e.target.value })}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label>AIM’s five core values</label>
      <div className="aim-form-grid">
        {cv.values.map((v, i) => (
          <input key={i} aria-label={`Core value ${i + 1}`} placeholder={`Core value ${i + 1}`} value={v} onChange={e => setCv({ ...cv, values: cv.values.map((x, j) => (j === i ? e.target.value : x)) })} />
        ))}
        <label>Status<select value={cv.status} onChange={e => setCv({ ...cv, status: e.target.value })}>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <button onClick={save}>Save academy facts</button>
    </section>
  );
}

function ConfigsTab({ bank, keyv, reload, flash, setErr }) {
  const [edit, setEdit] = useState(null);
  async function save() {
    try {
      await api('/configs', { method: 'POST', key: keyv, body: edit });
      flash('Configuration saved');
      setEdit(null);
      reload();
    } catch (e) { setErr(e.message); }
  }
  async function del(id) {
    try {
      await api(`/configs/${encodeURIComponent(id)}`, { method: 'DELETE', key: keyv });
      reload();
    } catch (e) { setErr(e.message); }
  }
  const newCfg = () => ({ name: 'New configuration', rounds: structuredClone(bank.configs[0]?.rounds || {}), randomize: true, includePending: false, proposalMinutes: 10 });
  if (edit) {
    const setR = (r, patch) => setEdit(c => ({ ...c, rounds: { ...c.rounds, [r]: { ...c.rounds[r], ...patch } } }));
    return (
      <section className="panel">
        <h2>{edit.id ? 'Edit' : 'New'} configuration</h2>
        <label>Name<input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
        <table className="aim-table">
          <thead><tr><th>Round</th><th>Questions per event</th><th>Mode</th></tr></thead>
          <tbody>
            {[1, 2, 3, 4, 5].map(r => (
              <tr key={r}>
                <td>{r}. {ROUND_NAMES[r]}</td>
                <td><input type="number" min="0" max="60" value={edit.rounds[r]?.count ?? 0} aria-label={`Questions in round ${r}`} onChange={e => setR(r, { count: Number(e.target.value) })} /></td>
                <td>
                  {r === 3 ? 'Collaborative puzzle' : r === 5 ? 'Team proposal' : (
                    <select value={edit.rounds[r]?.mode || 'individual'} aria-label={`Mode for round ${r}`} onChange={e => setR(r, { mode: e.target.value })}>
                      <option value="individual">Individual answers</option>
                      <option value="consensus">Team consensus</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label>Proposal writing time (minutes)<input type="number" min="3" max="30" value={edit.proposalMinutes || 10} onChange={e => setEdit({ ...edit, proposalMinutes: Number(e.target.value) })} /></label>
        <label className="aim-check"><input type="checkbox" checked={edit.randomize !== false} onChange={e => setEdit({ ...edit, randomize: e.target.checked })} /> Randomize question selection</label>
        <label className="aim-check"><input type="checkbox" checked={!!edit.includePending} onChange={e => setEdit({ ...edit, includePending: e.target.checked })} /> Include items pending confirmation</label>
        <div className="row"><button onClick={save}>Save configuration</button><button className="ghost" onClick={() => setEdit(null)}>Cancel</button></div>
      </section>
    );
  }
  return (
    <section className="panel">
      <h2>Reusable game configurations</h2>
      {bank.configs.map(c => (
        <div key={c.id} className="team">
          <div className="teamhead">
            <b>{c.name}</b>
            <span>{[1, 2, 3, 4, 5].map(r => `R${r}: ${c.rounds[r]?.count ?? 0}`).join(' · ')}</span>
          </div>
          <div className="row">
            <button className="small ghost" onClick={() => setEdit(structuredClone(c))}>Edit</button>
            {c.id !== 'standard' && <button className="small ghost" onClick={() => del(c.id)}>Delete</button>}
          </div>
        </div>
      ))}
      <button onClick={() => setEdit(newCfg())}>+ New configuration</button>
    </section>
  );
}

function ImportTab({ bank, keyv, reload, flash, setErr }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const download = () => {
    const { statusLabels, ...clean } = bank;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bank.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  async function doImport() {
    setResult(null);
    try {
      const parsed = JSON.parse(text);
      const r = await api('/import', { method: 'POST', key: keyv, body: { questions: Array.isArray(parsed) ? parsed : parsed.questions, replace } });
      setResult(r);
      reload();
    } catch (e) { setErr(e instanceof SyntaxError ? 'That is not valid JSON' : e.message); }
  }
  async function reset() {
    try {
      await api('/reset', { method: 'POST', key: keyv });
      setConfirmReset(false);
      flash('Restored the catalogue question bank');
      reload();
    } catch (e) { setErr(e.message); }
  }
  return (
    <section className="panel">
      <h2>Export</h2>
      <p>Download the whole bank (questions, academy facts and configurations). Commit it as <code>server/aim/bank.json</code> in GitHub to make your edits permanent.</p>
      <button onClick={download}>Download bank JSON</button>
      <h2>Import questions from JSON</h2>
      <p className="hint">Paste a JSON array of questions (or a full bank file). Each item is checked; invalid ones are listed and skipped. Items with an existing id replace that question.</p>
      <input type="file" accept="application/json,.json" aria-label="Choose JSON file" onChange={async e => { const file = e.target.files?.[0]; if (file) setText(await file.text()); }} />
      <textarea className="aim-json" value={text} onChange={e => setText(e.target.value)} placeholder='[{"type":"mcq","round":1,"level":"factual","prompt":"…","choices":["…","…","…","…"],"answer":0,"explanation":"…","source":"Catalogue p.3","status":"verified"}]' />
      <label className="aim-check"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} /> Replace the whole question list (instead of adding/updating)</label>
      <button disabled={!text.trim()} onClick={doImport}>Import</button>
      {result && (
        <div className="notice">
          Imported {result.imported} question(s).
          {result.errors.length > 0 && <ul>{result.errors.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </div>
      )}
      <h2>Restore</h2>
      {confirmReset ? (
        <div className="row"><button onClick={reset}>Yes, restore the catalogue bank</button><button className="ghost" onClick={() => setConfirmReset(false)}>Cancel</button></div>
      ) : <button className="ghost" onClick={() => setConfirmReset(true)}>Restore the original catalogue question bank…</button>}
    </section>
  );
}
