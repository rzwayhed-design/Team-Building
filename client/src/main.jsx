import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
import './style.css';

// Same origin by default (server serves this app). Set VITE_SERVER_URL only if the
// backend lives on a different domain.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const socket = io(SERVER_URL || undefined, { reconnectionDelayMax: 4000 });
const request = (name, data = {}) =>
  new Promise(resolve => {
    if (!socket.connected) return resolve({ error: 'Not connected — reconnecting…' });
    socket.timeout(8000).emit(name, data, (err, res) => resolve(err ? { error: 'The server did not respond. Try again.' } : res));
  });

// localStorage can throw (private mode, blocked storage) — never let that break the app.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const SESSION_KEY = 'teamup-session';

const ARENAS = { general: '🤝 Team Building Arena', sales: '🏆 Sales Challenge Arena' };

function App() {
  const params = new URLSearchParams(location.search);
  const joinParam = (params.get('join') || '').toUpperCase();

  const [view, setView] = useState('home'); // home | join | host | player | loading
  const [session, setSessionState] = useState(null);
  const sessionRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [priv, setPriv] = useState({ clues: [] });
  const [games, setGames] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());

  // form fields
  const [code, setCode] = useState(joinParam);
  const [name, setName] = useState(store.get('teamup-name') || '');
  const [title, setTitle] = useState('Team Up Championship');
  const [arena, setArena] = useState('general');
  const [teamCount, setTeamCount] = useState(2);

  const setSession = s => {
    sessionRef.current = s;
    setSessionState(s);
    if (s) store.set(SESSION_KEY, s);
    else store.del(SESSION_KEY);
  };

  const resetToHome = msg => {
    setSession(null);
    setEvent(null);
    setPriv({ clues: [] });
    setView('home');
    if (msg) setNotice(msg);
    history.replaceState(null, '', location.pathname);
  };

  // Re-attach after every (re)connection: Wi-Fi blips, phone sleep, server restarts.
  async function resume(s) {
    if (!s) return;
    if (s.role === 'host') {
      const r = await request('host:resume', { code: s.code, secret: s.secret });
      if (r?.ok) setView('host');
      else if (r?.error && !/connected|respond/.test(r.error)) resetToHome(r.error);
    } else {
      const r = await request('player:join', { code: s.code, playerId: s.playerId });
      if (r?.ok) {
        if (r.playerId !== s.playerId) setSession({ ...s, playerId: r.playerId });
        setView('player');
      } else if (r?.error && !/connected|respond/.test(r.error)) resetToHome(r.error);
    }
  }

  useEffect(() => {
    fetch(`${SERVER_URL}/api/games`)
      .then(r => r.json())
      .then(setGames)
      .catch(() => setError('Cannot reach the TEAM UP server'));

    const onUpdate = e => {
      if (!e) return;
      if (sessionRef.current && e.code !== sessionRef.current.code) return;
      setOffset(e.serverNow - Date.now());
      setEvent(e);
    };
    const onPrivate = p => setPriv(p);
    const onConnect = () => { setConnected(true); resume(sessionRef.current); };
    const onDisconnect = () => setConnected(false);
    const onRemoved = () => resetToHome('The organizer removed you from the event.');
    socket.on('event:update', onUpdate);
    socket.on('player:private', onPrivate);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('player:removed', onRemoved);
    setConnected(socket.connected); // in case the connection opened before these listeners existed

    // Pick up where this device left off.
    const saved = store.get(SESSION_KEY);
    const keepSaved = saved && (!joinParam || (saved.role === 'player' && saved.code === joinParam));
    if (keepSaved) {
      sessionRef.current = saved;
      setSessionState(saved);
      setView('loading');
      if (socket.connected) resume(saved);
    } else if (joinParam) setView('join');

    const t = setInterval(() => setNow(Date.now()), 250);
    const wake = () => { if (document.visibilityState === 'visible' && !socket.connected) socket.connect(); };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', wake);
      socket.off('event:update', onUpdate);
      socket.off('player:private', onPrivate);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('player:removed', onRemoved);
    };
  }, []);

  const call = async (action, data) => {
    setError('');
    const r = await request(action, data);
    if (r?.error) setError(r.error);
    return r || {};
  };

  async function createEvent() {
    const r = await call('host:create', { title, arena, teamCount });
    if (r.ok) {
      setSession({ role: 'host', code: r.code, secret: r.secret });
      setView('host');
    }
  }

  async function joinEvent() {
    const c = code.trim().toUpperCase();
    const prev = store.get(`teamup-player-${c}`);
    const r = await call('player:join', { code: c, name, playerId: prev });
    if (r.ok) {
      store.set('teamup-name', name.trim());
      store.set(`teamup-player-${r.code}`, r.playerId);
      setSession({ role: 'player', code: r.code, playerId: r.playerId });
      setView('player');
      history.replaceState(null, '', location.pathname);
    }
  }

  async function leave() {
    if (session?.role === 'player') await request('player:leave');
    resetToHome();
  }

  const secondsLeft = event?.deadline ? Math.max(0, Math.ceil((event.deadline - (now + offset)) / 1000)) : 0;
  const ready = event && session && event.code === session.code;

  return (
    <main>
      <header>
        <span className="brand">⚡ TEAM UP</span>
        <span className="tagline">Play together · Grow stronger</span>
      </header>
      {!connected && <div className="banner">Reconnecting to the server…</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {notice && view === 'home' && <div className="notice">{notice}</div>}

      {view === 'home' && (
        <section className="hero">
          <h1>Make teamwork a game.</h1>
          <p>Real-time corporate challenges, playable on every phone.</p>
          <div className="cards">
            <article>
              <h2>🎤 Organize an event</h2>
              <label htmlFor="title">Event title</label>
              <input id="title" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
              <label htmlFor="arena">Arena</label>
              <select id="arena" value={arena} onChange={e => setArena(e.target.value)}>
                <option value="general">{ARENAS.general}</option>
                <option value="sales">{ARENAS.sales}</option>
              </select>
              <label htmlFor="teams">Number of teams</label>
              <select id="teams" value={teamCount} onChange={e => setTeamCount(Number(e.target.value))}>
                {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} teams</option>)}
              </select>
              <button onClick={createEvent} disabled={!connected}>Create event →</button>
            </article>
            <article>
              <h2>📱 Join a game</h2>
              <label htmlFor="code">Event code</label>
              <input id="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. 4F2A9C" autoCapitalize="characters" />
              <button onClick={() => setView('join')} disabled={!code.trim()}>Join event →</button>
            </article>
          </div>
        </section>
      )}

      {view === 'join' && (
        <section className="panel narrow">
          <h1>Join your team</h1>
          <label htmlFor="jcode">Event code</label>
          <input id="jcode" value={code} onChange={e => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
          <label htmlFor="jname">Your name</label>
          <input id="jname" value={name} maxLength={30} onChange={e => setName(e.target.value)} placeholder="Your name"
            onKeyDown={e => e.key === 'Enter' && name.trim() && code.trim() && joinEvent()} />
          <button disabled={!name.trim() || !code.trim() || !connected} onClick={joinEvent}>Join game</button>
          <button className="ghost" onClick={() => setView('home')}>Back</button>
        </section>
      )}

      {(view === 'loading' || ((view === 'host' || view === 'player') && !ready)) && (
        <section className="panel center narrow"><p>Connecting to your event…</p><div className="pulse">⏳</div>
          <button className="ghost" onClick={() => resetToHome()}>Cancel</button></section>
      )}

      {view === 'host' && ready && <Host event={event} games={games} call={call} secondsLeft={secondsLeft} onLeave={leave} />}
      {view === 'player' && ready && (
        <Player event={event} me={event.players.find(p => p.id === session.playerId)} priv={priv} call={call}
          secondsLeft={secondsLeft} onLeave={leave} />
      )}

      <footer>TEAM UP · Interactive corporate challenges</footer>
    </main>
  );
}

function Host({ event, games, call, secondsLeft, onLeave }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const game = games.find(g => g.id === event.gameId);
  const available = games.filter(g => g.arena === event.arena);
  const joinUrl = `${location.origin}/?join=${event.code}`;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const result = event.results.at(-1);
  const teamsWithPlayers = event.teams.filter((_, i) => event.players.some(p => p.team === i)).length;
  const s = event.scenario;

  const copy = async () => {
    try { await navigator.clipboard.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const saveName = async i => {
    if (draft.trim() && draft.trim() !== event.teams[i].name) await call('host:renameTeam', { team: i, name: draft });
    setEditing(null);
  };

  return (
    <>
      <div className="heading">
        <div>
          <small>ORGANIZER</small>
          <h1>{event.title}</h1>
          <p>{ARENAS[event.arena]}</p>
        </div>
        <div className="code">PIN: {event.code}</div>
      </div>

      {event.status === 'lobby' && (
        <div className="hostgrid">
          <article className="panel center">
            <h2>Scan to join</h2>
            <div className="qr"><QRCodeSVG value={joinUrl} size={200} /></div>
            <p className="url">{joinUrl}</p>
            <button className="ghost small" onClick={copy}>{copied ? 'Copied ✓' : 'Copy join link'}</button>
            {isLocal && <p className="hint">You opened this page via “localhost”, so phones can’t use this QR code. Open the app using the computer’s network address or the online URL instead.</p>}
            <b>{event.players.length} participant{event.players.length === 1 ? '' : 's'} joined</b>
          </article>
          <article className="panel">
            <h2>Teams</h2>
            {event.teams.map((t, i) => (
              <div className={`team t${i}`} key={i}>
                <div className="teamhead">
                  {editing === i ? (
                    <input autoFocus value={draft} maxLength={30} onChange={e => setDraft(e.target.value)}
                      onBlur={() => saveName(i)} onKeyDown={e => e.key === 'Enter' && saveName(i)} />
                  ) : (
                    <b onClick={() => { setEditing(i); setDraft(t.name); }} title="Click to rename" className="rename">{t.name} ✎</b>
                  )}
                  <span>{event.players.filter(p => p.team === i).length} players · {t.score} pts</span>
                </div>
                <div className="names">
                  {event.players.filter(p => p.team === i).map(p => (
                    <span key={p.id} className={p.connected ? '' : 'offline'}>
                      {p.name}
                      <select aria-label={`Move ${p.name}`} value={p.team}
                        onChange={e => call('host:movePlayer', { playerId: p.id, team: Number(e.target.value) })}>
                        {event.teams.map((tt, j) => <option key={j} value={j}>{tt.name}</option>)}
                      </select>
                      <button className="x" aria-label={`Remove ${p.name}`} onClick={() => call('host:removePlayer', { playerId: p.id })}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <p className="hint">Click a team name to rename it. Use the menu on a name to move a player.</p>
          </article>
        </div>
      )}

      {event.status === 'lobby' && (
        <section className="panel">
          <h2>Choose a game</h2>
          {teamsWithPlayers < 2 && <p className="hint">Waiting for players in at least 2 teams…</p>}
          <div className="gamegrid">
            {available.map(g => (
              <article className="game" key={g.id}>
                <small>{g.skill} · {g.rounds} rounds · {g.duration}s each</small>
                <h3>{g.name}</h3>
                <p>{g.description}</p>
                <button disabled={teamsWithPlayers < 2} onClick={() => call('host:start', { gameId: g.id })}>Start game →</button>
              </article>
            ))}
          </div>
          <button className="ghost" onClick={() => { if (confirm('End this event for everyone?')) call('host:endEvent'); }}>End event</button>
        </section>
      )}

      {(event.status === 'playing' || event.status === 'review') && s && (
        <section className="panel center stage">
          <small>{game?.skill} · Round {event.round + 1}/{event.roundTotal}</small>
          <h2>{game?.name}</h2>
          <h3 className="question">{s.question}</h3>
          {event.status === 'playing' && (
            <>
              <div className={`timer ${secondsLeft <= 10 ? 'low' : ''}`}>{secondsLeft}s</div>
              {s.hasClues && <p>Each player has private clues on their phone. Teams must combine them!</p>}
              <ol className="choices">{s.choices.map((c, i) => <li key={i}>{c}</li>)}</ol>
              <p><b>{event.answeredTeams.length} of {teamsWithPlayers}</b> teams answered</p>
              <div className="answered">
                {event.teams.map((t, i) => <span key={i} className={`chip t${i} ${event.answeredTeams.includes(i) ? 'done' : ''}`}>{t.name} {event.answeredTeams.includes(i) ? '✓' : '…'}</span>)}
              </div>
              <button className="ghost small" onClick={() => call('host:endRound')}>End round now</button>
            </>
          )}
          {event.status === 'review' && result && (
            <>
              <h3 className="correct">✅ {result.answer}</h3>
              <p>{result.explanation}</p>
              <div className="review">
                {result.answers.filter(a => event.players.some(p => p.team === a.team)).map(a => (
                  <div key={a.team} className={`team t${a.team}`}>
                    <b>{event.teams[a.team].name}</b>
                    <span>{a.answered ? `${a.correct ? '✅' : '❌'} ${a.answer} — by ${a.by}` : '⏱ No answer'}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => call('host:next')}>{event.round + 1 >= event.roundTotal ? 'See results →' : 'Next round →'}</button>
            </>
          )}
        </section>
      )}

      {event.status === 'gameover' && (
        <section className="panel center">
          <h2>🏆 {game?.name} complete!</h2>
          <Winner event={event} />
          <div className="row">
            <button onClick={() => call('host:lobby')}>Play another game →</button>
            <button className="ghost" onClick={() => { if (confirm('End this event for everyone?')) call('host:endEvent'); }}>End event</button>
          </div>
        </section>
      )}

      {event.status === 'finished' && (
        <section className="panel center">
          <h2>🎉 Event finished</h2>
          <Winner event={event} />
          <button onClick={onLeave}>Create a new event</button>
        </section>
      )}

      <Leaderboard event={event} />
      {event.status !== 'finished' && <p className="center"><button className="link" onClick={onLeave}>Leave organizer screen</button></p>}
    </>
  );
}

function Player({ event, me, priv, call, secondsLeft, onLeave }) {
  if (!me) {
    return (
      <section className="panel center narrow">
        <p>Rejoining…</p>
        <button className="ghost" onClick={onLeave}>Back to start</button>
      </section>
    );
  }
  const team = event.teams[me.team];
  const s = event.scenario;
  const teamAnswered = event.answeredTeams.includes(me.team);
  const result = event.results.at(-1);
  const myResult = result?.answers.find(a => a.team === me.team);
  const clues = priv?.code === event.code && priv.round === event.round ? priv.clues : [];
  const teammates = event.players.filter(p => p.team === me.team && p.id !== me.id);

  return (
    <>
      <div className="heading">
        <div>
          <small>PLAYER</small>
          <h1>Hi, {me.name} 👋</h1>
          <p>{event.title}</p>
        </div>
        <div className={`code t${me.team}`}>{team?.name}</div>
      </div>

      {event.status === 'lobby' && (
        <section className="panel center">
          <h2>You're in!</h2>
          <p>Wait for the organizer to start the challenge.</p>
          <div className="pulse">🎮</div>
          {teammates.length > 0 && <p>Your teammates: {teammates.map(p => p.name).join(', ')}</p>}
        </section>
      )}

      {event.status === 'playing' && s && (
        <section className="panel">
          <small>Round {event.round + 1}/{event.roundTotal}</small>
          <div className={`timer ${secondsLeft <= 10 ? 'low' : ''}`}>{secondsLeft}s</div>
          <h2>{s.question}</h2>
          {s.hasClues && (
            <div className="clue">
              <b>🔐 Your private clue{clues.length > 1 ? 's' : ''}</b>
              {clues.length ? <ul>{clues.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p>You joined mid-round — help your team with their clues.</p>}
              <small>Share them out loud with your team — don't show your screen!</small>
            </div>
          )}
          <p>Discuss with your teammates. The first answer from your team counts.</p>
          <div className="options">
            {s.choices.map((c, i) => (
              <button className="option" disabled={teamAnswered} key={i} onClick={() => call('player:answer', { choice: i })}>{c}</button>
            ))}
          </div>
          {teamAnswered && <p className="success">✓ Your team has answered. Waiting for the other teams…</p>}
        </section>
      )}

      {event.status === 'review' && result && (
        <section className="panel center">
          <h2>{myResult?.correct ? '🎉 Correct! +100' : myResult?.answered ? '❌ Not this time' : '⏱ Time ran out'}</h2>
          <p>Correct answer: <b>{result.answer}</b></p>
          <p>{result.explanation}</p>
          <p className="hint">Waiting for the next round…</p>
        </section>
      )}

      {(event.status === 'gameover' || event.status === 'finished') && (
        <section className="panel center">
          <h1>{event.status === 'finished' ? '🎉 Event finished!' : '🏁 Game complete!'}</h1>
          <Winner event={event} />
          <h2>{team?.name}: {team?.score} points</h2>
          {event.status === 'gameover' && <p className="hint">The organizer may start another game.</p>}
        </section>
      )}

      <Leaderboard event={event} myTeam={me.team} />
      <p className="center"><button className="link" onClick={onLeave}>Leave event</button></p>
    </>
  );
}

function Winner({ event }) {
  const playing = event.teams.map((t, i) => ({ ...t, i })).filter(t => event.players.some(p => p.team === t.i));
  if (!playing.length) return null;
  const top = Math.max(...playing.map(t => t.score));
  const winners = playing.filter(t => t.score === top);
  return <h2 className="winner">{winners.length > 1 ? `🤝 It's a tie: ${winners.map(w => w.name).join(' & ')}` : `🥇 ${winners[0].name} leads!`}</h2>;
}

function Leaderboard({ event, myTeam }) {
  const rows = event.teams.map((t, i) => ({ ...t, i })).sort((a, b) => b.score - a.score);
  return (
    <section className="panel">
      <h2>🏅 Leaderboard</h2>
      {rows.map((t, rank) => (
        <div className={`leader t${t.i} ${t.i === myTeam ? 'mine' : ''}`} key={t.i}>
          <b>{rank + 1}. {t.name}</b>
          <strong>{t.score} pts</strong>
        </div>
      ))}
    </section>
  );
}

createRoot(document.getElementById('root')).render(<App />);
