// The Global section: instrument-wide settings on <groups> (docs: "The
// <groups> element"): volume, velocity tracking, tuning and pan.
// Checks on the values happen in export.js (checkPreset).

// `blank` (optional) is what an empty field means, shown as a placeholder.
const FIELDS = [
  { key: 'volume', label: 'Volume', unit: '(linear, 1 = unchanged)', min: 0, step: 0.01 },
  {
    key: 'velocityTracking',
    label: 'Velocity tracking',
    unit: '(0 = ignore velocity, 1 = fully velocity-sensitive, blank = default)',
    min: 0,
    max: 1,
    step: 0.05,
    blank: 'default',
  },
  { key: 'globalTuning', label: 'Tuning', unit: 'semitones (0.01 = 1 cent)', step: 0.01 },
  { key: 'globalPan', label: 'Pan', unit: '(−100 left, 100 right)', min: -100, max: 100, step: 1 },
];

// `onChange` is called after any value changes, so the XML preview and export
// checks can update.
export function renderGlobalEditor(container, project, onChange) {
  const rows = FIELDS.map(({ key, label, unit, min, max, step, blank }) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'envelope-field';
    const input = document.createElement('input');
    input.type = 'number';
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.step = step;
    input.className = 'envelope-input';
    input.value = project[key] ?? '';
    if (blank) input.placeholder = blank;
    // "input" fires on every keystroke, so the XML updates as you type.
    input.addEventListener('input', () => {
      project[key] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    wrapper.append(`${label} `, input, ` ${unit}`);
    const row = document.createElement('p');
    row.append(wrapper);
    return row;
  });
  container.replaceChildren(...rows);
}
