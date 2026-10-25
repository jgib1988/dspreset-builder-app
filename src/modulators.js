// The Modulators section: LFOs, envelopes, MIDI CC, velocity and random
// sources that move instrument settings (docs: "The <modulators> element"
// and its <lfo>, <envelope>, <midiCC>, <midiVelocity> and <random>
// sections, and "How to use <binding>s in conjunction with modulators").
// Exported as <modulators>.
//
// Each modulator has a stable `id` (lfo1, env2…) that is never reused, so UI
// controls can refer to it later, and a list of targets. A target is a
// setting plus how the modulator moves it: `behavior` (docs: modBehavior)
// and the output range (translationOutputMin/Max).
//
// Only some settings can be modulated (docs: "modulatable" parameters):
// effect parameters, and global volume, pan and tuning. Tested in the plugin:
// only shared (global scope) LFOs, MIDI CC and random can move our
// instrument-wide effects, and only when targeted by effectIndex (effectTags
// does nothing for modulators). Envelopes and velocity can't, in any scope.
// Checks on the values happen in export.js (checkModulators).

import { EFFECT_BINDINGS, EFFECT_KINDS, visibleParams } from './effects.js';
import { addModulatorControls, ownerTitle, removeInapplicableControls } from './ui.js';

export const MOD_BEHAVIORS = ['add', 'modulate', 'multiply', 'set'];

// Field helpers. `omit` (optional) leaves the attribute out of the export
// when it returns true (e.g. the docs' default); `show` (optional) hides the
// field, and leaves it out, when it doesn't apply. `above` means the value
// must be more than `min`, not equal to it. `optional` allows blank.
const number = (key, label, unit, min, max, step, start, extra = {}) => ({ kind: 'number', key, label, unit, min, max, step, start, ...extra });
const choice = (key, label, options, start, extra = {}) => ({ kind: 'choice', key, label, options, start, ...extra });

const depth = number('modAmount', 'Depth', '(0–1)', 0, 1, 0.01, 1);
const scope = (start) =>
  choice('scope', '', [['global', 'Shared by all notes'], ['voice', 'One per note']], start, { omit: (v) => v === 'global' });
const curve = (key, label, docsDefault) =>
  number(key, label, '', -100, 100, 1, docsDefault, { omit: (v) => v === docsDefault });
const CHANNELS = [['', 'Default channel'], ['voice', "Note's channel"], ...Array.from({ length: 16 }, (_, i) => [String(i + 1), `Channel ${i + 1}`])];

// Every modulator the docs list (except the MPE ones, which need the
// plugin's MPE mode). `element` is the XML element; `prefix` starts its id;
// `target` is a new one's first target, with an optional starting range.
// The editor, the export and the checks all read this table.
export const MODULATOR_KINDS = {
  lfo: {
    label: 'LFO',
    element: 'lfo',
    prefix: 'lfo',
    target: { key: 'globalTuning' },
    fields: [
      choice('shape', 'Shape', [['sine', 'sine'], ['square', 'square'], ['saw', 'saw']], 'sine'),
      number('frequency', 'Rate', 'Hz', 0, Infinity, 0.01, 5, { above: true }),
      depth,
      number('delayTime', 'Delay', 's', 0, Infinity, 0.01, 0, { omit: (v) => v === 0 }),
      scope('global'),
    ],
  },
  envelope: {
    label: 'Envelope',
    element: 'envelope',
    prefix: 'env',
    target: { key: 'volume' },
    fields: [
      number('attack', 'Attack', 's', 0, Infinity, 0.01, 0.5),
      number('decay', 'Decay', 's', 0, Infinity, 0.01, 0.5),
      number('sustain', 'Sustain', '(0–1)', 0, 1, 0.01, 0.5),
      number('release', 'Release', 's', 0, Infinity, 0.01, 0.5),
      depth,
      // The docs advise one envelope per note for most uses.
      scope('voice'),
      curve('attackCurve', 'Attack curve', -100),
      curve('decayCurve', 'Decay curve', 100),
      curve('releaseCurve', 'Release curve', 100),
    ],
  },
  midiCC: {
    label: 'MIDI CC',
    element: 'midiCC',
    prefix: 'cc',
    target: { key: 'globalTuning' },
    fields: [
      number('number', 'CC number', '(1 = mod wheel)', 0, 127, 1, 1, { integer: true }),
      depth,
      scope('global'),
      // Blank: the docs' default (the note's channel per note, channel 1 shared).
      choice('channel', '', CHANNELS, '', { omit: (v) => v === '' }),
    ],
  },
  midiVelocity: {
    label: 'Velocity',
    element: 'midiVelocity',
    prefix: 'vel',
    target: { key: 'volume' },
    fields: [depth, scope('voice')],
  },
  random: {
    label: 'Random',
    element: 'random',
    prefix: 'rand',
    target: { key: 'globalTuning', range: [-0.1, 0.1] },
    fields: [
      choice('mode', 'New value', [['note_on', 'on each note'], ['periodic', 'at a set rate']], 'note_on'),
      number('frequency', 'Rate', 'Hz', 0, Infinity, 0.01, 5, { above: true, show: (m) => m.mode === 'periodic' }),
      choice('trigger', 'Reset on note', [['attack', 'yes'], ['none', 'no']], 'attack'),
      number('seed', 'Seed', '(blank = none)', 0, Infinity, 1, null, { integer: true, optional: true, omit: (v) => v === null }),
      scope('voice'),
    ],
  },
};

// Binding parameter names for UI controls, by field (docs: "Bindable
// parameters by modulator type"). Fields missing here can't get a control:
// words like LFO shape, and random's depth (<random> has no modAmount
// attribute, so a knob would have no known starting value).
export const MODULATOR_BINDINGS = {
  lfo: { frequency: 'FREQUENCY', modAmount: 'MOD_AMOUNT', delayTime: 'MOD_DELAY_TIME' },
  envelope: {
    attack: 'ENV_ATTACK',
    decay: 'ENV_DECAY',
    sustain: 'ENV_SUSTAIN',
    release: 'ENV_RELEASE',
    modAmount: 'MOD_AMOUNT',
    attackCurve: 'ENV_ATTACK_CURVE',
    decayCurve: 'ENV_DECAY_CURVE',
    releaseCurve: 'ENV_RELEASE_CURVE',
  },
  midiCC: { modAmount: 'MOD_AMOUNT' },
  midiVelocity: { modAmount: 'MOD_AMOUNT' },
  random: { frequency: 'FREQUENCY' },
};

// The fields that apply to a modulator right now.
export function visibleFields(modulator) {
  return MODULATOR_KINDS[modulator.kind].fields.filter((f) => !f.show || f.show(modulator));
}

// Non-effect targets, with a new target's starting behaviour and range:
// multiply for volume (the docs recommend it for tremolo), modulate (a swing
// either side of the current value) for the rest.
const AMP_TARGETS = {
  volume: { label: 'Volume', parameter: 'AMP_VOLUME', behavior: 'multiply', range: [0, 1] },
  globalTuning: { label: 'Tuning', parameter: 'GLOBAL_TUNING', behavior: 'modulate', range: [-0.2, 0.2] },
  globalPan: { label: 'Pan', parameter: 'PAN', behavior: 'modulate', range: [-50, 50] },
};

// Whether this modulator may target effect parameters (see above).
export function canTargetEffects(modulator) {
  return ['lfo', 'midiCC', 'random'].includes(modulator.kind) && modulator.scope === 'global';
}

// What a target points at: { label, parameter, bindingTarget, behavior,
// range }, or null if it no longer exists or doesn't apply.
export function resolveModTarget(project, { effectId, key }) {
  if (effectId === null) {
    const target = AMP_TARGETS[key];
    return target ? { ...target, bindingTarget: 'type="amp" level="instrument" position="0"' } : null;
  }
  const index = project.effects.findIndex((e) => e.id === effectId);
  if (index < 0) return null;
  const effect = project.effects[index];
  const param = visibleParams(effect).find((p) => p.key === key);
  const parameter = EFFECT_BINDINGS[effect.kind]?.[key];
  if (!param || !parameter) return null;
  // A swing of a tenth of the parameter's range either side, rounded.
  const swing = Number(((param.max - param.min) / 10).toPrecision(2));
  return {
    label: `${EFFECT_KINDS[effect.kind].label} (${effect.id}) › ${param.label}`,
    parameter,
    // Its place in the chain, which follows reordering.
    bindingTarget: `type="effect" level="instrument" effectIndex="${index}"`,
    behavior: 'modulate',
    range: [-swing, swing],
  };
}

// After an effect is removed or its type changes: drop targets that no
// longer point at anything.
export function removeMissingModTargets(project) {
  for (const modulator of project.modulators) {
    modulator.targets = modulator.targets.filter((t) => resolveModTarget(project, t) !== null);
  }
}

// `onChange` is called after anything changes, so the XML preview and export
// checks can update.
export function renderModulatorsEditor(container, project, onChange) {
  const rerender = () => renderModulatorsEditor(container, project, onChange);
  const modulators = project.modulators;

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    modulators.length === 0
      ? 'No modulators yet.'
      : 'Each modulator moves its targets. Modulate swings either side of the setting, multiply scales it, add adds to it, set replaces it.';

  const list = document.createElement('ol');
  list.className = 'effects-list';
  modulators.forEach((modulator, index) => list.append(renderModulator(modulator, index, project, rerender, onChange)));

  // "Add" row: pick a kind, then add it with its starting settings and target.
  const kindSelect = document.createElement('select');
  for (const [kind, { label }] of Object.entries(MODULATOR_KINDS)) kindSelect.append(new Option(label, kind));
  const add = button('Add', 'Add this modulator', false, () => {
    const modulator = createModulator(project, kindSelect.value);
    modulators.push(modulator);
    addModulatorControls(project, modulator);
    rerender();
    onChange();
  });
  const addRow = document.createElement('p');
  addRow.append('Add modulator: ', kindSelect, ' ', add);

  container.replaceChildren(hint, list, addRow);
}

// A new modulator: the kind's starting settings and first target.
function createModulator(project, kind) {
  const definition = MODULATOR_KINDS[kind];
  const modulator = { id: `${definition.prefix}${project.nextModulatorNumber}`, kind, enabled: true };
  for (const field of definition.fields) modulator[field.key] = field.start;
  const target = createTarget(project, null, definition.target.key);
  if (definition.target.range) [target.min, target.max] = definition.target.range;
  modulator.targets = [target];
  project.nextModulatorNumber += 1;
  return modulator;
}

function createTarget(project, effectId, key) {
  const { behavior, range } = resolveModTarget(project, { effectId, key });
  return { effectId, key, behavior, min: range[0], max: range[1] };
}

function renderModulator(modulator, index, project, rerender, onChange) {
  const item = document.createElement('li');
  item.className = 'effect';
  const title = document.createElement('strong');
  title.textContent = ownerTitle(project, modulator);
  item.append(title, ' ');

  // On/off (docs: enabled, DecentSampler 1.34.0).
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'effect-field';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = modulator.enabled;
  enabled.addEventListener('change', () => {
    modulator.enabled = enabled.checked;
    onChange();
  });
  enabledLabel.append(enabled, ' On');
  item.append(enabledLabel);

  for (const field of visibleFields(modulator)) {
    if (field.kind === 'number') {
      item.append(numberField(modulator, field, onChange));
    } else {
      item.append(
        selectField(field.label, field.options, modulator[field.key], (v) => {
          modulator[field.key] = v;
          // e.g. random's rate knob goes when it's set to "on each note".
          removeInapplicableControls(project, modulator);
          rerender(); // some fields show or hide (e.g. random's rate)
          onChange();
        }),
      );
    }
  }
  item.append(
    button('Remove', 'Remove this modulator and its controls', false, () => {
      project.modulators.splice(index, 1);
      project.ui.controls = project.ui.controls.filter((c) => c.effectId !== modulator.id);
      rerender();
      onChange();
    }),
  );

  // Targets: one row each, then an Add row.
  const table = document.createElement('table');
  table.className = 'controls-table';
  for (const target of modulator.targets) table.append(renderTarget(modulator, target, project, rerender, onChange));
  const addTarget = button('Add target', 'Add another setting for this modulator to move', false, () => {
    modulator.targets.push(createTarget(project, null, 'globalTuning'));
    rerender();
    onChange();
  });
  const targets = document.createElement('div');
  targets.append(table, addTarget);
  item.append(targets);
  return item;
}

function renderTarget(modulator, target, project, rerender, onChange) {
  const row = document.createElement('tr');
  const cell = (...content) => {
    const td = document.createElement('td');
    td.append(...content);
    row.append(td);
  };

  // Which setting. Picking another one resets the behaviour and range to its defaults.
  const select = document.createElement('select');
  const global = document.createElement('optgroup');
  global.label = 'Global';
  for (const [key, { label }] of Object.entries(AMP_TARGETS)) global.append(new Option(label, JSON.stringify({ effectId: null, key })));
  select.append(global);
  // Effect parameters only for modulators that can move them; a target left
  // over from before (e.g. after switching to one per note) stays listed so
  // the export check can explain it.
  project.effects.forEach((effect, index) => {
    if (!canTargetEffects(modulator) && target.effectId !== effect.id) return;
    const group = document.createElement('optgroup');
    group.label = `${index + 1}. ${EFFECT_KINDS[effect.kind].label} (${effect.id})`;
    for (const param of visibleParams(effect)) {
      if (EFFECT_BINDINGS[effect.kind]?.[param.key]) group.append(new Option(param.label, JSON.stringify({ effectId: effect.id, key: param.key })));
    }
    if (group.children.length > 0) select.append(group);
  });
  select.value = JSON.stringify({ effectId: target.effectId, key: target.key });
  select.addEventListener('change', () => {
    const { effectId, key } = JSON.parse(select.value);
    Object.assign(target, createTarget(project, effectId, key));
    rerender();
    onChange();
  });
  cell('Target ', select);

  const behavior = document.createElement('select');
  for (const b of MOD_BEHAVIORS) behavior.append(new Option(b, b));
  behavior.value = target.behavior;
  behavior.addEventListener('change', () => {
    target.behavior = behavior.value;
    onChange();
  });
  cell(behavior);

  for (const key of ['min', 'max']) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'control-input';
    input.value = target[key] ?? '';
    input.addEventListener('input', () => {
      target[key] = input.value === '' ? null : Number(input.value);
      onChange();
    });
    cell(key === 'min' ? 'From ' : 'To ', input);
  }

  cell(
    button('Remove', 'Remove this target', false, () => {
      modulator.targets.splice(modulator.targets.indexOf(target), 1);
      rerender();
      onChange();
    }),
  );
  return row;
}

function numberField(modulator, { key, label, unit, min, max, step }, onChange) {
  const wrapper = document.createElement('label');
  wrapper.className = 'effect-field';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = min;
  if (max !== Infinity) input.max = max;
  input.step = step;
  input.className = 'effect-input';
  input.value = modulator[key] ?? '';
  // "input" fires on every keystroke, so the XML updates as you type.
  input.addEventListener('input', () => {
    modulator[key] = input.value === '' ? null : Number(input.value);
    onChange();
  });
  wrapper.append(`${label} `, input, unit ? ` ${unit}` : '');
  return wrapper;
}

function selectField(label, options, value, onSelect) {
  const wrapper = document.createElement('label');
  wrapper.className = 'effect-field';
  const select = document.createElement('select');
  for (const [optionValue, text] of options) select.append(new Option(text, optionValue));
  select.value = value;
  select.addEventListener('change', () => onSelect(select.value));
  wrapper.append(label ? `${label} ` : '', select);
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
