// The Selected zones box shown under the grid when several zones are selected
// (shift-click): one box per setting that sets it on every sample in those
// zones (all their round-robins) at once. The settings are the same ones the
// single-zone Trim and loop and Level and tuning boxes edit, so nothing new
// is exported. Values are absolute (pan 30 sets every sample to 30). Frame
// values are the same number for every file; where one doesn't fit a sample
// (e.g. past a shorter file's end), the export checks name that sample.

import { setLoopEnabled } from './loops.js';

// key, label, the box's step and range, and what a blank box means:
// `blank` is shown when every sample has no value (trim: the file's own start
// or end); `clearable` fields can be emptied back to that.
const LEVEL_FIELDS = [
  { key: 'volumeDb', label: 'Volume (dB)', step: 0.5 },
  { key: 'pan', label: 'Pan (−100–100)', step: 1, min: -100, max: 100 },
  { key: 'tuning', label: 'Tuning (semitones)', step: 0.01 },
];
const TRIM_FIELDS = [
  { key: 'start', label: 'Trim start', step: 1, min: 0, blank: 'file start', clearable: true },
  { key: 'end', label: 'Trim end', step: 1, min: 0, blank: 'file end', clearable: true },
];
const LOOP_FIELDS = [
  { key: 'loopStart', label: 'Loop start', step: 1, min: 0 },
  { key: 'loopEnd', label: 'Loop end', step: 1, min: 0 },
  { key: 'loopCrossfade', label: 'Crossfade', step: 1, min: 0 },
];

// `onChange` is called after any value changes, so the export can update.
export function renderMultiEditor(box, zones, onChange) {
  const rerender = () => renderMultiEditor(box, zones, onChange);
  const samples = zones.flat();

  const heading = document.createElement('h3');
  heading.textContent = 'Selected zones';
  const summary = document.createElement('p');
  summary.textContent = `${zones.length} zones, ${samples.length} samples selected.`;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Typing a value sets it on every selected sample. "mixed" means they differ; that box changes nothing until you type in it. ' +
    'Frames are the same number for every file. Click a single zone to edit its samples one by one and see the waveform.';

  // The loop boxes only work when every selected sample's loop is on.
  const loopStates = new Set(samples.map((s) => s.loopEnabled));
  const loop = document.createElement('input');
  loop.type = 'checkbox';
  loop.checked = loopStates.has(true) && loopStates.size === 1;
  loop.indeterminate = loopStates.size > 1; // the "–" look: some on, some off
  loop.addEventListener('change', () => {
    for (const sample of samples) setLoopEnabled(sample, loop.checked);
    rerender();
    onChange();
  });
  const loopLabel = document.createElement('label');
  loopLabel.className = 'effect-field';
  loopLabel.append(loop, ' Loop');
  const allLooping = loop.checked;

  const row = (title, ...content) => {
    const p = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${title}: `;
    p.append(strong, ...content);
    return p;
  };

  box.replaceChildren(
    heading,
    summary,
    row('Level and tuning', ...LEVEL_FIELDS.map((f) => field(samples, f, onChange))),
    row('Trim', ...TRIM_FIELDS.map((f) => field(samples, f, onChange))),
    row(
      'Loop',
      loopLabel,
      ...LOOP_FIELDS.map((f) => field(samples, f, onChange, !allLooping)),
      allLooping ? '' : ' (turn the loop on for all of them to edit these)',
    ),
    hint,
  );
}

// One labelled number box for a setting across all `samples`.
function field(samples, { key, label, step, min, max, blank, clearable }, onChange, disabled = false) {
  const values = new Set(samples.map((s) => s[key]));
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.className = 'envelope-input';
  input.disabled = disabled;
  if (values.size > 1) {
    input.placeholder = 'mixed';
  } else {
    const [value] = values;
    input.value = value ?? '';
    if (blank) input.placeholder = blank;
  }

  // "input" fires on every keystroke, so the XML updates as you type. A
  // blank box sets nothing, except for trim, where blank means the file's own
  // start or end (as in the single-zone box).
  input.addEventListener('input', () => {
    if (input.value === '' && !clearable) return;
    const value = input.value === '' ? null : Number(input.value);
    for (const sample of samples) sample[key] = value;
    onChange();
  });

  const element = document.createElement('label');
  element.className = 'effect-field';
  element.append(`${label} `, input);
  return element;
}
