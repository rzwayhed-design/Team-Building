// AIM question bank storage: starts from bank.json (in the repo) and keeps organizer
// edits in a separate file next to the event data. Export the bank from the
// Question Bank page and commit it as bank.json to make edits permanent.

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BANK_PATH = path.join(__dirname, 'bank.json');

export const TYPES = ['mcq', 'match', 'puzzle', 'scenario', 'proposal'];
export const LEVELS = ['factual', 'understanding', 'application', 'strategic'];
export const STATUSES = ['verified', 'approved', 'pending'];
export const STATUS_LABELS = {
  verified: 'Verified from AIM catalogue',
  approved: 'Facilitator-approved scenario',
  pending: 'Pending confirmation',
};
export const MODES = ['individual', 'consensus', 'collaborative', 'proposal'];

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

class ValidationError extends Error {}
const fail = msg => {
  throw new ValidationError(msg);
};

// Returns a clean question or throws ValidationError with a readable message.
export function validateQuestion(input, { keepId = true } = {}) {
  if (!input || typeof input !== 'object') fail('Question must be an object');
  const type = input.type;
  if (!TYPES.includes(type)) fail(`Type must be one of ${TYPES.join(', ')}`);
  const q = {
    id: keepId && /^[a-z0-9-]{2,40}$/i.test(input.id || '') ? input.id : `${type}-${randomBytes(4).toString('hex')}`,
    round: int(input.round, 1, 5, null),
    type,
    level: LEVELS.includes(input.level) ? input.level : fail('Difficulty must be factual, understanding, application or strategic'),
    status: STATUSES.includes(input.status) ? input.status : 'pending',
    active: input.active !== false,
    area: str(input.area, 60),
    prompt: str(input.prompt, 600),
    explanation: str(input.explanation, 800),
    source: str(input.source, 120) || (type === 'scenario' || type === 'proposal' ? 'Hypothetical scenario' : ''),
  };
  if (!q.round) fail('Round must be 1–5');
  if (input.timer !== undefined && input.timer !== '' && input.timer !== null) q.timer = int(input.timer, 10, 1200, undefined);
  if (q.timer === undefined) delete q.timer;
  if (type !== 'proposal' && !q.prompt) fail('Question text is required');

  if (type === 'mcq' || type === 'puzzle' || type === 'scenario') {
    if (!Array.isArray(input.choices) || input.choices.length !== 4) fail('Exactly four answer choices are required');
    q.choices = input.choices.map(c => str(c, 300));
    if (q.choices.some(c => !c)) fail('Answer choices cannot be empty');
    if (new Set(q.choices).size !== 4) fail('Answer choices must be different');
    q.answer = int(input.answer, 0, 3, null);
    if (q.answer === null) fail('Pick the correct answer (1–4)');
  }
  if (type === 'puzzle') {
    if (!Array.isArray(input.clues) || input.clues.length < 2 || input.clues.length > 8) fail('Puzzles need 2–8 clues');
    q.clues = input.clues.map(c => str(c, 300)).filter(Boolean);
    if (q.clues.length < 2) fail('Puzzles need at least 2 clues');
  }
  if (type === 'scenario') {
    if (!Array.isArray(input.points) || input.points.length !== 4) fail('Scenarios need points for each of the 4 responses');
    q.points = input.points.map(p => int(p, 0, 150, 0));
    q.answer = q.points.indexOf(Math.max(...q.points));
    q.topic = str(input.topic, 60);
    q.discussion = !!input.discussion;
    q.rubric = (Array.isArray(input.rubric) ? input.rubric : [])
      .map(r => ({ label: str(r?.label, 80), points: int(r?.points, 0, 150, 0) }))
      .filter(r => r.label);
    if (!q.rubric.length) fail('Scenarios need a rubric with at least one criterion');
    const total = q.rubric.reduce((a, r) => a + r.points, 0);
    if (total !== 150) fail(`Rubric points must add up to 150 (currently ${total})`);
  }
  if (type === 'match') {
    if (!Array.isArray(input.items) || input.items.length < 2 || input.items.length > 8) fail('Matching needs 2–8 items');
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) fail('Matching needs 2–8 options');
    q.items = input.items.map(i => str(i, 200));
    q.options = input.options.map(o => str(o, 200));
    if (q.items.some(i => !i) || q.options.some(o => !o)) fail('Matching items and options cannot be empty');
    if (!Array.isArray(input.answers) || input.answers.length !== q.items.length) fail('Each item needs a correct option');
    q.answers = input.answers.map(a => int(a, 0, q.options.length - 1, null));
    if (q.answers.some(a => a === null)) fail('Each item needs a valid correct option');
  }
  if (type === 'proposal') {
    q.title = str(input.title, 80) || fail('Brief title is required');
    q.budget = str(input.budget, 40) || fail('Budget is required');
    q.constraints = (Array.isArray(input.constraints) ? input.constraints : []).map(c => str(c, 160)).filter(Boolean);
    q.focus = str(input.focus, 80) || 'Any pillar';
    q.prompt = q.prompt || 'AIM has the opportunity to introduce one new initiative next year. Design a proposal aligned with Faster, Stronger or Better.';
  }
  return q;
}

export function validateConfig(input = {}, fallback) {
  const base = fallback || { rounds: {}, randomize: true, includePending: false };
  const rounds = {};
  for (const r of [1, 2, 3, 4, 5]) {
    const src = input.rounds?.[r] || base.rounds?.[r] || {};
    let mode = src.mode;
    if (r === 3) mode = 'collaborative';
    else if (r === 5) mode = 'proposal';
    else if (!['individual', 'consensus'].includes(mode)) mode = r === 4 ? 'consensus' : 'individual';
    rounds[r] = { count: int(src.count, 0, 60, r === 3 ? 3 : r === 5 ? 4 : 6), mode };
  }
  return {
    id: /^[a-z0-9-]{1,40}$/i.test(input.id || '') ? input.id : undefined,
    name: str(input.name, 60) || 'Custom',
    rounds,
    randomize: input.randomize !== false,
    includePending: !!input.includePending,
    proposalMinutes: int(input.proposalMinutes, 3, 30, 10),
  };
}

export function createAimStore({ file } = {}) {
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_BANK_PATH, 'utf8'));
  let bank = structuredClone(defaults);
  if (file && fs.existsSync(file)) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && Array.isArray(saved.questions)) bank = { ...structuredClone(defaults), ...saved };
    } catch (err) {
      console.error('Could not read saved AIM bank, using defaults:', err.message);
    }
  }

  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(bank, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error('Could not save AIM bank:', err.message);
    }
  }

  const eligible = (q, includePending) => q.active && (q.status !== 'pending' || includePending);

  return {
    STATUS_LABELS,
    getBank: () => bank,
    questions: () => bank.questions,
    profile: () => bank.profile,
    rubric5: () => bank.rubric5,
    configs: () => bank.configs,
    getConfig: id => bank.configs.find(c => c.id === id),
    pool: (round, includePending) => bank.questions.filter(q => q.round === round && eligible(q, includePending)),

    overview() {
      const rounds = {};
      for (const r of [1, 2, 3, 4, 5]) {
        const qs = bank.questions.filter(q => q.round === r);
        rounds[r] = {
          total: qs.length,
          ready: qs.filter(q => eligible(q, false)).length,
          pending: qs.filter(q => q.active && q.status === 'pending').length,
          inactive: qs.filter(q => !q.active).length,
        };
      }
      const p = bank.profile;
      return {
        profile: { name: p.name, meaning: p.meaning, mission: p.mission, vision: p.vision },
        rounds,
        configs: bank.configs,
        rubric5: bank.rubric5,
      };
    },

    upsertQuestion(input) {
      const q = validateQuestion(input);
      const i = bank.questions.findIndex(x => x.id === q.id);
      if (i >= 0) bank.questions[i] = q;
      else bank.questions.push(q);
      save();
      return q;
    },

    deleteQuestion(id) {
      const before = bank.questions.length;
      bank.questions = bank.questions.filter(q => q.id !== id);
      save();
      return before !== bank.questions.length;
    },

    setStatus(ids, status, active) {
      let n = 0;
      for (const q of bank.questions) {
        if (!ids.includes(q.id)) continue;
        if (status && STATUSES.includes(status)) q.status = status;
        if (typeof active === 'boolean') q.active = active;
        n++;
      }
      save();
      return n;
    },

    importQuestions(list, { replace = false } = {}) {
      if (!Array.isArray(list)) throw new ValidationError('Expected a JSON array of questions (or an object with a "questions" array)');
      const ok = [];
      const errors = [];
      list.forEach((item, i) => {
        try {
          ok.push(validateQuestion(item));
        } catch (err) {
          errors.push(`#${i + 1}${item?.id ? ` (${item.id})` : ''}: ${err.message}`);
        }
      });
      if (replace) bank.questions = ok;
      else {
        for (const q of ok) {
          const i = bank.questions.findIndex(x => x.id === q.id);
          if (i >= 0) bank.questions[i] = q;
          else bank.questions.push(q);
        }
      }
      save();
      return { imported: ok.length, errors };
    },

    setProfile(input = {}) {
      const p = bank.profile;
      if (input.activationDate !== undefined) {
        p.activationDate = {
          ...p.activationDate,
          value: str(input.activationDate.value ?? input.activationDate, 60),
          status: STATUSES.includes(input.activationDate.status) ? input.activationDate.status : p.activationDate.status,
        };
      }
      if (input.coreValues !== undefined) {
        const vals = Array.isArray(input.coreValues.values) ? input.coreValues.values : input.coreValues;
        p.coreValues = {
          ...p.coreValues,
          values: [0, 1, 2, 3, 4].map(i => str(vals?.[i], 80)),
          status: STATUSES.includes(input.coreValues.status) ? input.coreValues.status : p.coreValues.status,
        };
      }
      save();
      return p;
    },

    saveConfig(input) {
      const c = validateConfig(input);
      c.id = c.id || `cfg-${randomBytes(3).toString('hex')}`;
      const i = bank.configs.findIndex(x => x.id === c.id);
      if (i >= 0) bank.configs[i] = c;
      else bank.configs.push(c);
      save();
      return c;
    },

    deleteConfig(id) {
      bank.configs = bank.configs.filter(c => c.id !== id);
      save();
    },

    resetToDefaults() {
      bank = structuredClone(defaults);
      save();
    },
  };
}

export { ValidationError };
