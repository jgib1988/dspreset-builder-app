// The Sequences section: note patterns the instrument plays by itself (docs:
// "The <noteSequences> element"), each edited on a step grid and started by a
// range of keys (docs: note sequences tutorial, "Triggering sequences using
// MIDI"). Pressing a key in the range plays the pattern transposed by the
// key's distance from the root key (seqTransposeWithRootNote).
//
// Tested in the plugin: `rate` is steps per beat (16 steps at rate 4 = one
// bar of 16ths), and the timing follows the DAW tempo (120 BPM standalone).
// Checks on the values happen in export.js (checkSequences) and validate.js.

import { midiToNoteName } from './filename.js';

// Loop modes (docs: seqLoopMode).
export const LOOP_MODES = [
  ['forward', 'Loop forwards'],
  ['reverse', 'Loop backwards'],
  ['random', 'Random order'],
  ['random_no_repeat', 'Random order, no repeats'],
  ['no_loop', 'Play once'],
];

// Common step sizes: steps per beat, with a name for each.
const STEP_SIZES = [
  [1, '1/4 notes'],
  [2, '1/8 notes'],
  [3, '1/8 triplets'],
  [4, '1/16 notes'],
  [6, '1/16 triplets'],
  [8, '1/32 notes'],
];

const MAX_STEPS = 128;

// A new sequence: one bar of 16ths, rows for every note from C3 up to C4,
// no notes yet.
// The first one is started by the octave C-1–B-1 (12–23), below where
// samples and keyswitches usually go; later ones need their keys picked.
export function createSequence(project) {
  const number = project.nextSequenceNumber++;
  const first = project.sequences.length === 0;
  return {
    id: `seq${number}`,
    name: `Sequence ${number}`,
    steps: 16,
    stepsPerBeat: 4,
    loopMode: 'forward',
    followTempo: true,
    triggerLow: first ? 12 : null,
    triggerHigh: first ? 23 : null,
    rootKey: first ? 12 : null,
    // Pitch rows shown in the grid, highest first, so empty rows stay.
    rows: Array.from({ length: 13 }, (_, i) => 72 - i),
    // e.g. { step: 0, note: 60, length: 1, velocity: 1 } (velocity 0–1).
    notes: [],
  };
}

// Whether a sequence has a key trigger: any of the three keys filled in.
// (export.js checks that then all three are.)
export function hasTrigger(sequence) {
  return sequence.triggerLow !== null || sequence.triggerHigh !== null || sequence.rootKey !== null;
}

// `onChange` is called after anything changes, so the XML preview and
// export checks can update.
export function renderSequencesEditor(container, project, onChange) {
  const rerender = () => renderSequencesEditor(container, project, onChange);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    project.sequences.length === 0
      ? 'No sequences yet.'
      : 'Click a grid cell to add a note, click a note to remove it. Pressing a trigger key plays the sequence, transposed by how far the key is from the root key.';

  const list = document.createElement('ol');
  list.className = 'effects-list';
  project.sequences.forEach((sequence, index) => list.append(renderSequence(sequence, index, project, rerender, onChange)));

  const add = document.createElement('button');
  add.textContent = 'Add sequence';
  add.addEventListener('click', () => {
    project.sequences.push(createSequence(project));
    rerender();
    onChange();
  });
  const addRow = document.createElement('p');
  addRow.append(add);

  container.replaceChildren(hint, list, addRow);
}

function renderSequence(sequence, index, project, rerender, onChange) {
  const item = document.createElement('li');
  item.className = 'effect';

  // Name (shown only in the app and Decent Sampler's own sequence editor).
  const name = document.createElement('input');
  name.value = sequence.name;
  name.className = 'control-label';
  // "change" (Return or leaving the box): the Controls section redraws with
  // the new name, which would interrupt typing.
  name.addEventListener('change', () => {
    sequence.name = name.value;
    onChange();
  });
  item.append(name, ' ');

  item.append(
    numberField('Steps', sequence.steps, 1, MAX_STEPS, 1, (value) => {
      sequence.steps = value;
      // Notes past the new end are dropped; ones running past it are shortened.
      if (Number.isInteger(value) && value >= 1) {
        sequence.notes = sequence.notes.filter((n) => n.step < value);
        for (const n of sequence.notes) n.length = Math.min(n.length, value - n.step);
      }
      rerender();
      onChange();
    }),
  );

  const size = select(
    STEP_SIZES.map(([value, text]) => [String(value), text]),
    String(sequence.stepsPerBeat),
    (value) => {
      sequence.stepsPerBeat = Number(value);
      rerender();
      onChange();
    },
  );
  item.append(label('Step size ', size));

  const loop = select(LOOP_MODES, sequence.loopMode, (value) => {
    sequence.loopMode = value;
    onChange();
  });
  item.append(label('', loop));

  const tempo = document.createElement('input');
  tempo.type = 'checkbox';
  tempo.checked = sequence.followTempo;
  tempo.addEventListener('change', () => {
    sequence.followTempo = tempo.checked;
    onChange();
  });
  item.append(label('', tempo, ' Follow the DAW tempo (off: always 120 BPM)'));

  // Trigger keys: blank all three for no key trigger.
  const keys = document.createElement('p');
  keys.append(
    'Trigger keys ',
    noteField(sequence, 'triggerLow', onChange),
    ' to ',
    noteField(sequence, 'triggerHigh', onChange),
    ', root key ',
    noteField(sequence, 'rootKey', onChange),
    ' (the key that plays it at its written pitch; blank all three for no key trigger)',
  );
  item.append(keys);

  item.append(renderGrid(sequence, rerender, onChange));

  // New note settings, and adding a pitch row.
  const tools = document.createElement('p');
  tools.append(
    numberField('New notes: length (steps)', newNote.length, 1, MAX_STEPS, 1, (value) => {
      newNote.length = value;
    }),
    numberField('velocity (0–1)', newNote.velocity, 0, 1, 0.05, (value) => {
      newNote.velocity = value;
    }),
  );
  const rowSelect = select(
    Array.from({ length: 128 }, (_, note) => [String(note), `${midiToNoteName(note)} (${note})`]),
    '60',
    () => {},
  );
  const addRow = button('Add row', 'Add a pitch row to the grid', () => {
    const note = Number(rowSelect.value);
    if (!sequence.rows.includes(note)) sequence.rows = [...sequence.rows, note].sort((a, b) => b - a);
    rerender();
  });
  tools.append(' Row: ', rowSelect, ' ', addRow);
  item.append(tools);

  item.append(
    button('Remove sequence', 'Remove this sequence', () => {
      project.sequences.splice(index, 1);
      // Its Play button goes too, and the Play menu once no sequences are left.
      project.ui.controls = project.ui.controls.filter(
        (c) => c.effectId !== sequence.id && !(c.key === 'sequenceMenu' && project.sequences.length === 0),
      );
      rerender();
      onChange();
    }),
  );
  return item;
}

// Length and velocity for notes added by clicking. Screen-only, shared by
// all grids, so it isn't in the project data.
const newNote = { length: 1, velocity: 1 };

// The step grid: one row per pitch (highest first), one column per step.
// A note fills the cells it lasts for; its velocity sets how solid it looks.
function renderGrid(sequence, rerender, onChange) {
  const table = document.createElement('table');
  table.className = 'seq-grid';
  const steps = Number.isInteger(sequence.steps) && sequence.steps >= 1 ? sequence.steps : 0;

  const header = document.createElement('tr');
  header.append(document.createElement('th'));
  for (let step = 0; step < steps; step++) {
    const th = document.createElement('th');
    // Beat numbers on each beat's first step.
    if (step % sequence.stepsPerBeat === 0) th.textContent = step / sequence.stepsPerBeat + 1;
    header.append(th);
  }
  table.append(header);

  for (const note of sequence.rows) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.className = 'seq-row-name';
    name.textContent = midiToNoteName(note);
    // A row with no notes can be removed.
    if (!sequence.notes.some((n) => n.note === note)) {
      name.append(
        ' ',
        button('×', 'Remove this row', () => {
          sequence.rows = sequence.rows.filter((r) => r !== note);
          rerender();
        }),
      );
    }
    row.append(name);

    for (let step = 0; step < steps; step++) {
      const cell = document.createElement('td');
      cell.className = 'seq-cell';
      if (step % sequence.stepsPerBeat === 0) cell.classList.add('seq-beat');
      const covering = sequence.notes.find((n) => n.note === note && n.step <= step && step < n.step + n.length);
      if (covering) {
        cell.classList.add(covering.step === step ? 'seq-note-start' : 'seq-note-tail');
        cell.style.opacity = 0.35 + 0.65 * (covering.velocity ?? 1);
        cell.title = `${midiToNoteName(note)}, step ${covering.step + 1}, ${covering.length} step(s), velocity ${covering.velocity}`;
      }
      cell.addEventListener('click', () => {
        if (covering) {
          sequence.notes = sequence.notes.filter((n) => n !== covering);
        } else {
          // As long as asked for, but stopping before the next note on this row and the end.
          const next = sequence.notes.filter((n) => n.note === note && n.step > step).map((n) => n.step);
          const room = Math.min(sequence.steps, ...next) - step;
          const length = Number.isInteger(newNote.length) && newNote.length >= 1 ? newNote.length : 1;
          const velocity = Number.isFinite(newNote.velocity) ? Math.min(Math.max(newNote.velocity, 0), 1) : 1;
          sequence.notes.push({ step, note, length: Math.min(length, room), velocity });
        }
        rerender();
        onChange();
      });
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

// A MIDI note number box with its name, for the trigger keys.
function noteField(sequence, key, onChange) {
  const wrapper = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.max = 127;
  input.step = 1;
  input.className = 'envelope-input';
  input.value = sequence[key] ?? '';
  const name = document.createElement('span');
  const showName = () => {
    const value = sequence[key];
    name.textContent = Number.isInteger(value) && value >= 0 && value <= 127 ? ` ${midiToNoteName(value)}` : '';
  };
  showName();
  input.addEventListener('input', () => {
    sequence[key] = input.value === '' ? null : Number(input.value);
    showName();
    onChange();
  });
  wrapper.append(input, name);
  return wrapper;
}

function numberField(text, value, min, max, step, onInput) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = min;
  input.max = max;
  input.step = step;
  input.className = 'envelope-input';
  input.value = value ?? '';
  // "change" (Return or leaving the box), so the grid isn't redrawn mid-typing.
  input.addEventListener('change', () => onInput(input.value === '' ? null : Number(input.value)));
  return label(`${text} `, input);
}

function select(options, value, onSelect) {
  const element = document.createElement('select');
  for (const [optionValue, text] of options) element.append(new Option(text, optionValue));
  element.value = value;
  element.addEventListener('change', () => onSelect(element.value));
  return element;
}

function label(...content) {
  const element = document.createElement('label');
  element.className = 'effect-field';
  element.append(...content);
  return element;
}

function button(text, title, onClick) {
  const element = document.createElement('button');
  element.textContent = text;
  element.title = title;
  element.className = 'effect-button';
  element.addEventListener('click', onClick);
  return element;
}
