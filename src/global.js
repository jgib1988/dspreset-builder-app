// The Global section: instrument-wide settings on <groups> (docs: "The
// <groups> element"): volume, velocity tracking, tuning, pan and glide, and
// whether the instrument is monophonic (docs: tag polyphony) and returns to
// a held note (docs: returnToHeldNote) and glides smoothly (docs: glideRetrigger).
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
  { key: 'glideTime', label: 'Glide time', unit: 's (0 = no glide)', min: 0, step: 0.05 },
];

const GLIDE_MODES = [
  ['legato', 'Legato: only from a held note'],
  ['always', 'Always: from the last note played'],
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
  // Glide mode: one setting, radio buttons.
  const modeRow = document.createElement('p');
  modeRow.append('Glide mode: ');
  for (const [mode, text] of GLIDE_MODES) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'glide-mode';
    radio.checked = project.glideMode === mode;
    radio.addEventListener('change', () => {
      project.glideMode = mode;
      onChange();
    });
    label.append(radio, ` ${text}`);
    modeRow.append(label);
  }

  const mono = document.createElement('input');
  mono.type = 'checkbox';
  mono.checked = project.monophonic;
  mono.addEventListener('change', () => {
    project.monophonic = mono.checked;
    onChange();
  });
  const monoRow = document.createElement('p');
  const monoLabel = document.createElement('label');
  monoLabel.append(mono, ' Monophonic: one note at a time (each mix layer on its own). Glide sounds best with this on.');
  monoRow.append(monoLabel);

  const back = document.createElement('input');
  back.type = 'checkbox';
  back.checked = project.returnToHeldNote;
  back.addEventListener('change', () => {
    project.returnToHeldNote = back.checked;
    onChange();
  });
  const backRow = document.createElement('p');
  const backLabel = document.createElement('label');
  backLabel.append(
    back,
    ' Return to held note: releasing a key plays a key you are still holding again, like a mono synth ' +
      '(needs Monophonic or Choking; Decent Sampler 1.41 or later)',
  );
  backRow.append(backLabel);

  const smooth = document.createElement('input');
  smooth.type = 'checkbox';
  smooth.checked = project.smoothLegato;
  smooth.addEventListener('change', () => {
    project.smoothLegato = smooth.checked;
    onChange();
  });
  const smoothRow = document.createElement('p');
  const smoothLabel = document.createElement('label');
  smoothLabel.append(
    smooth,
    ' Smooth legato: gliding to a new key carries on the note instead of restarting it ' +
      '(needs Monophonic or Choking, and a glide time; Decent Sampler 1.41 or later)',
  );
  smoothRow.append(smoothLabel);

  container.replaceChildren(...rows, modeRow, monoRow, backRow, smoothRow);
}
