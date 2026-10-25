// The Effects section: an ordered chain of instrument-wide effects, exported
// as <effects> in this order (docs: "The <effects> element"). Effects are
// processed top to bottom.
//
import { addEffectControls, ownerTitle, removeInapplicableControls } from './ui.js';
import { removeMissingModTargets } from './modulators.js';

// Every effect the docs list is described once in EFFECT_KINDS below: its
// Decent Sampler type(s) and its parameters with the docs' ranges and
// defaults. The editor, the export and the checks all read that table.
//
// Each effect has a stable `id` (fx1, fx2…) that is never reused, so UI
// controls can refer to it later.

// Filter types from the docs. "lowpass" is the current name for the legacy
// "lowpass_4pl". lowpass_1pl is a gentler 1-pole lowpass with no resonance.
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'lowpass_1pl'];

// Parameter helpers. `show` (optional) hides a parameter, and leaves it out
// of the export, when it doesn't apply to the effect's current settings.
const number = (key, label, unit, min, max, step, start, show) => ({ kind: 'number', key, label, unit, min, max, step, start, show });
const choice = (key, label, options, start) => ({ kind: 'choice', key, label, options, start });
const toggle = (key, label, start) => ({ kind: 'toggle', key, label, start });
const audioFile = (key, label) => ({ kind: 'file', key, label, start: '' });

const mix = (start) => number('mix', 'Mix', '(0–1)', 0, 1, 0.01, start);
const eqFrequency = (start) => number('frequency', 'Frequency', 'Hz', 60, 22000, 1, start);
const eqQ = number('q', 'Q', '', 0.01, 18, 0.1, 0.7);
const eqGain = number('gain', 'Gain', '(×, 1 = 0 dB)', 0.0001, 10, 0.1, 1);

// In the order they usually appear in a signal chain. `types` is the Decent
// Sampler type; when there are several, the editor shows a menu.
export const EFFECT_KINDS = {
  filter: {
    label: 'Filter',
    types: FILTER_TYPES,
    params: [
      number('frequency', 'Frequency', 'Hz', 0, 22000, 1, 22000),
      number('resonance', 'Resonance', '', 0.001, 5, 0.1, 0.7, (e) => e.type !== 'lowpass_1pl'),
    ],
  },
  notch: { label: 'Notch EQ', types: ['notch'], params: [eqFrequency(10000), eqQ] },
  peak: { label: 'Peak EQ', types: ['peak'], params: [eqFrequency(10000), eqQ, eqGain] },
  low_shelf: { label: 'Low shelf', types: ['low_shelf'], params: [eqFrequency(200), eqQ, eqGain] },
  high_shelf: { label: 'High shelf', types: ['high_shelf'], params: [eqFrequency(5000), eqQ, eqGain] },
  // Docs default is about -6 dB; we start at 0 dB so adding a gain doesn't
  // change the sound until you set it.
  gain: { label: 'Gain', types: ['gain'], params: [number('level', 'Level', 'dB', -100, 24, 0.5, 0)] },
  compressor: {
    label: 'Compressor',
    types: ['compressor'],
    params: [
      number('threshold', 'Threshold', 'dB', -60, 0, 0.5, -12),
      number('ratio', 'Ratio', ':1', 1, 20, 0.1, 4),
      number('attack', 'Attack', 'ms', 0.1, 200, 0.1, 5),
      number('release', 'Release', 'ms', 5, 2000, 1, 100),
      number('inputGain', 'Input gain', 'dB', -24, 24, 0.5, 0),
      number('outputGain', 'Output gain', 'dB', -24, 24, 0.5, 0),
      toggle('autoBypass', 'Auto bypass', false),
    ],
  },
  wave_shaper: {
    label: 'Wave shaper',
    types: ['wave_shaper'],
    params: [
      number('drive', 'Drive', '', 1, 1000, 1, 1),
      number('driveBoost', 'Drive boost', '(0–1)', 0, 1, 0.01, 1),
      number('outputLevel', 'Output level', '(0–1)', 0, 1, 0.01, 0.1),
      toggle('highQuality', 'High quality (oversampling)', false),
    ],
  },
  wave_folder: {
    label: 'Wave folder',
    types: ['wave_folder'],
    params: [number('drive', 'Drive', '', 1, 100, 1, 1), number('threshold', 'Threshold', '', 0, 10, 0.01, 0.25)],
  },
  bit_crusher: {
    label: 'Bit crusher',
    types: ['bit_crusher'],
    params: [
      number('bitDepth', 'Bit depth', 'bits', 1, 24, 1, 24),
      number('sampleRateReduction', 'Sample rate reduction', '×', 1, 32, 1, 1),
      mix(1),
    ],
  },
  // The docs give no default for pitchShift, so it starts at 0 (no shift).
  pitch_shift: {
    label: 'Pitch shifter',
    types: ['pitch_shift'],
    params: [number('pitchShift', 'Shift', 'semitones', -24, 24, 1, 0), mix(0.5)],
  },
  chorus: {
    label: 'Chorus',
    types: ['chorus'],
    params: [mix(0.5), number('modDepth', 'Depth', '(0–1)', 0, 1, 0.01, 0.2), number('modRate', 'Rate', 'Hz', 0, 10, 0.01, 0.2)],
  },
  phaser: {
    label: 'Phaser',
    types: ['phaser'],
    params: [
      mix(0.5),
      number('modDepth', 'Depth', '(0–1)', 0, 1, 0.01, 0.2),
      number('modRate', 'Rate', 'Hz', 0, 10, 0.01, 0.2),
      number('centerFrequency', 'Centre frequency', 'Hz', 0, 22000, 1, 400),
      number('feedback', 'Feedback', '(-1–1)', -1, 1, 0.01, 0.7),
    ],
  },
  // modRate and modDepth only affect the adt algorithm (docs).
  stereo_simulator: {
    label: 'Stereo simulator',
    types: ['stereo_simulator'],
    params: [
      choice('algorithm', 'Algorithm', ['adt', 'lauridsen', 'schroeder'], 'adt'),
      number('width', 'Width', '(0–1)', 0, 1, 0.01, 0.5),
      number('delayTime', 'Delay', 's', 0.001, 0.03, 0.001, 0.005),
      number('modRate', 'Rate', 'Hz', 0.1, 10, 0.1, 0.5, (e) => e.algorithm === 'adt'),
      number('modDepth', 'Depth', '(0–1)', 0, 1, 0.01, 0.3, (e) => e.algorithm === 'adt'),
    ],
  },
  stutter: {
    label: 'Stutter',
    types: ['stutter'],
    params: [number('amount', 'Amount', '(0–1)', 0, 1, 0.01, 0.5), mix(1)],
  },
  // Delay time in seconds only. (Tempo sync, delayTimeFormat="musical_time",
  // needs a UI control and isn't supported yet.)
  delay: {
    label: 'Delay',
    types: ['delay'],
    params: [
      number('delayTime', 'Time', 's', 0, 20, 0.01, 0.7),
      number('feedback', 'Feedback', '(0–1)', 0, 1, 0.01, 0.2),
      number('stereoOffset', 'Stereo offset', 's', -10, 10, 0.001, 0),
      number('feedbackCutoff', 'Feedback cutoff', 'Hz', 20, 22000, 1, 22000),
      number('wetLevel', 'Wet level', '(0–1)', 0, 1, 0.01, 0.5),
    ],
  },
  reverb: {
    label: 'Reverb',
    types: ['reverb'],
    params: [
      number('roomSize', 'Room size', '(0–1)', 0, 1, 0.01, 0.7),
      number('damping', 'Damping', '(0–1)', 0, 1, 0.01, 0.3),
      number('wetLevel', 'Wet level', '(0–1)', 0, 1, 0.01, 0),
    ],
  },
  convolution: {
    label: 'Convolution',
    types: ['convolution'],
    params: [mix(0.5), audioFile('irFile', 'Impulse response')],
  },
};

// Binding parameter names for UI controls (docs: Appendix B, and each
// effect's own section). Parameters missing here have no documented binding
// name, so they can't get a control: gain level, pitch shift amount, delay
// wet level, and the stereo simulator's delay, rate and depth.
const FILTER_BINDINGS = { frequency: 'FX_FILTER_FREQUENCY', q: 'FX_FILTER_Q', gain: 'FX_FILTER_GAIN' };
const MOD_BINDINGS = { mix: 'FX_MIX', modDepth: 'FX_MOD_DEPTH', modRate: 'FX_MOD_RATE' };
export const EFFECT_BINDINGS = {
  filter: { frequency: 'FX_FILTER_FREQUENCY', resonance: 'FX_FILTER_RESONANCE' },
  notch: FILTER_BINDINGS,
  peak: FILTER_BINDINGS,
  low_shelf: FILTER_BINDINGS,
  high_shelf: FILTER_BINDINGS,
  compressor: {
    threshold: 'FX_THRESHOLD',
    ratio: 'FX_RATIO',
    attack: 'FX_ATTACK',
    release: 'FX_RELEASE',
    inputGain: 'FX_INPUT_GAIN',
    outputGain: 'FX_OUTPUT_GAIN',
  },
  wave_shaper: { drive: 'FX_DRIVE', driveBoost: 'FX_DRIVE_BOOST', outputLevel: 'FX_OUTPUT_LEVEL' },
  wave_folder: { drive: 'FX_DRIVE', threshold: 'FX_THRESHOLD' },
  bit_crusher: { bitDepth: 'FX_BIT_DEPTH', sampleRateReduction: 'FX_SAMPLE_RATE_REDUCTION', mix: 'FX_MIX' },
  pitch_shift: { mix: 'FX_MIX' },
  chorus: MOD_BINDINGS,
  phaser: { ...MOD_BINDINGS, centerFrequency: 'FX_CENTER_FREQUENCY', feedback: 'FX_FEEDBACK' },
  stereo_simulator: { width: 'FX_WIDTH' },
  stutter: { amount: 'FX_STUTTER_AMOUNT', mix: 'FX_MIX' },
  delay: {
    delayTime: 'FX_DELAY_TIME',
    feedback: 'FX_FEEDBACK',
    stereoOffset: 'FX_STEREO_OFFSET',
    feedbackCutoff: 'FX_FEEDBACK_CUTOFF',
  },
  reverb: { roomSize: 'FX_REVERB_ROOM_SIZE', damping: 'FX_REVERB_DAMPING', wetLevel: 'FX_REVERB_WET_LEVEL' },
  convolution: { mix: 'FX_MIX' },
};

// The parameters that apply to an effect right now (some hide depending on
// other settings, e.g. resonance for lowpass_1pl).
export function visibleParams(effect) {
  return EFFECT_KINDS[effect.kind].params.filter((p) => !p.show || p.show(effect));
}

// Impulse responses must be WAV or AIFF (docs: irFile).
export function isImpulseResponseFile(path) {
  return /\.(wav|aif|aiff)$/i.test(path);
}

// `onChange` is called after any effect changes, so the XML preview and
// export checks can update.
export function renderEffectsEditor(container, project, onChange) {
  const rerender = () => renderEffectsEditor(container, project, onChange);
  const effects = project.effects;

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = effects.length === 0 ? 'No effects yet.' : 'Effects are processed top to bottom.';

  const list = document.createElement('ol');
  list.className = 'effects-list';
  effects.forEach((effect, index) => {
    list.append(renderEffect(effect, index, project, rerender, onChange));
  });

  // "Add effect" row: pick a kind, then add it to the end of the chain.
  const addRow = document.createElement('p');
  const kindSelect = document.createElement('select');
  for (const [kind, { label }] of Object.entries(EFFECT_KINDS)) {
    kindSelect.append(new Option(label, kind));
  }
  const addButton = document.createElement('button');
  addButton.textContent = 'Add';
  addButton.addEventListener('click', () => {
    const effect = createEffect(kindSelect.value, `fx${project.nextEffectNumber}`);
    effects.push(effect);
    project.nextEffectNumber += 1;
    addEffectControls(project, effect);
    rerender();
    onChange();
  });
  addRow.append('Add effect: ', kindSelect, ' ', addButton);

  container.replaceChildren(hint, list, addRow);
}

// A new effect with every parameter at its starting value.
function createEffect(kind, id) {
  const definition = EFFECT_KINDS[kind];
  // `enabled: false` bypasses the effect (docs: the enabled attribute).
  const effect = { id, kind, type: definition.types[0], enabled: true };
  for (const param of definition.params) effect[param.key] = param.start;
  return effect;
}

function renderEffect(effect, index, project, rerender, onChange) {
  const effects = project.effects;
  const definition = EFFECT_KINDS[effect.kind];
  const item = document.createElement('li');
  item.className = 'effect';

  const title = document.createElement('strong');
  title.textContent = ownerTitle(project, effect);
  item.append(title, ' ');

  // On/off: also the starting state of an on/off button in the Controls.
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'effect-field';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = effect.enabled;
  enabled.addEventListener('change', () => {
    effect.enabled = enabled.checked;
    onChange();
  });
  enabledLabel.append(enabled, ' On');
  item.append(enabledLabel);

  // A type menu only when the kind has several Decent Sampler types (filter).
  if (definition.types.length > 1) {
    const typeSelect = document.createElement('select');
    for (const type of definition.types) typeSelect.append(new Option(type, type));
    typeSelect.value = effect.type;
    typeSelect.addEventListener('change', () => {
      effect.type = typeSelect.value;
      removeInapplicableControls(project, effect);
      removeMissingModTargets(project);
      rerender(); // some parameters show or hide
      onChange();
    });
    item.append(typeSelect);
  }

  for (const param of visibleParams(effect)) {
    item.append(renderParam(effect, param, project, rerender, onChange));
  }

  // Reorder and remove. Order matters: it's the order the sound passes through.
  const move = (offset) => {
    const [moved] = effects.splice(index, 1);
    effects.splice(index + offset, 0, moved);
    rerender();
    onChange();
  };
  item.append(
    button('↑', 'Move up', index === 0, () => move(-1)),
    button('↓', 'Move down', index === effects.length - 1, () => move(1)),
    button('Remove', 'Remove this effect and its controls', false, () => {
      effects.splice(index, 1);
      project.ui.controls = project.ui.controls.filter((c) => c.effectId !== effect.id);
      removeMissingModTargets(project);
      rerender();
      onChange();
    }),
  );
  return item;
}

function renderParam(effect, param, project, rerender, onChange) {
  const wrapper = document.createElement('label');
  wrapper.className = 'effect-field';

  if (param.kind === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = param.min;
    input.max = param.max;
    input.step = param.step;
    input.className = 'effect-input';
    input.value = effect[param.key] ?? '';
    // "input" fires on every keystroke, so the XML updates as you type.
    input.addEventListener('input', () => {
      effect[param.key] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    wrapper.append(`${param.label} `, input, param.unit ? ` ${param.unit}` : '');
  } else if (param.kind === 'choice') {
    const select = document.createElement('select');
    for (const option of param.options) select.append(new Option(option, option));
    select.value = effect[param.key];
    select.addEventListener('change', () => {
      effect[param.key] = select.value;
      removeMissingModTargets(project);
      rerender(); // some parameters show or hide
      onChange();
    });
    wrapper.append(`${param.label} `, select);
  } else if (param.kind === 'toggle') {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = effect[param.key];
    checkbox.addEventListener('change', () => {
      effect[param.key] = checkbox.checked;
      onChange();
    });
    wrapper.append(checkbox, ` ${param.label}`);
  } else if (param.kind === 'file') {
    // Pick from the WAV/AIFF files in the instrument folder.
    const select = document.createElement('select');
    select.append(new Option('(choose a WAV or AIFF file)', ''));
    for (const sample of project.samples) {
      if (isImpulseResponseFile(sample.path)) select.append(new Option(sample.path, sample.path));
    }
    select.value = effect[param.key];
    select.addEventListener('change', () => {
      effect[param.key] = select.value;
      onChange();
    });
    wrapper.append(`${param.label} `, select);
  }
  return wrapper;
}

function button(text, title, disabled, onClick) {
  const element = document.createElement('button');
  element.textContent = text;
  element.title = title;
  element.disabled = disabled;
  element.className = 'effect-button';
  element.addEventListener('click', onClick);
  return element;
}
