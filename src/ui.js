// The Controls section: knobs, sliders, on/off buttons and the articulation
// menu shown in Decent Sampler's own window (docs: "The <ui> element"), each
// bound to a setting (docs: "Appendix B: The <binding> element"). Settings
// are instrument-wide ones, effect parameters and modulator settings.
//
// A control stores only what it targets and how it looks. Its starting value
// is read from the setting it controls, so the project stays the single
// source of truth. Controls are placed automatically (layoutControls):
// Global, Amp envelope and Articulation panels first, then one panel per
// effect in chain order, then one per modulator.

import { EFFECT_BINDINGS, EFFECT_KINDS, visibleParams } from './effects.js';
import { articulationLabel, usedArticulations } from './mapping.js';
import { MODULATOR_BINDINGS, MODULATOR_KINDS, visibleFields } from './modulators.js';

// The docs' recommended window size.
export const UI_WIDTH = 812;
export const UI_HEIGHT = 375;

// Targets with effectId null, in the order they're laid out: the Global
// panel's, then the Amp envelope panel's. `range` is a new control's
// min/max; `valid` is what the setting itself allows (docs give no upper
// limit for envelope times or volume).
const AMP_TARGETS = [
  { key: 'volume', label: 'Volume', parameter: 'AMP_VOLUME', range: [0, 1], valid: [0, Infinity] },
  { key: 'velocityTracking', label: 'Vel track', parameter: 'AMP_VEL_TRACK', range: [0, 1], valid: [0, 1] },
  // The docs give no range for tuning; ±48 matches the Global section's check.
  { key: 'globalTuning', label: 'Tuning', parameter: 'GLOBAL_TUNING', range: [-12, 12], valid: [-48, 48] },
  { key: 'globalPan', label: 'Pan', parameter: 'PAN', range: [-100, 100], valid: [-100, 100] },
  { key: 'attack', label: 'Attack', parameter: 'ENV_ATTACK', range: [0, 10], valid: [0, Infinity] },
  { key: 'decay', label: 'Decay', parameter: 'ENV_DECAY', range: [0, 10], valid: [0, Infinity] },
  { key: 'sustain', label: 'Sustain', parameter: 'ENV_SUSTAIN', range: [0, 1], valid: [0, 1] },
  { key: 'release', label: 'Release', parameter: 'ENV_RELEASE', range: [0, 10], valid: [0, Infinity] },
  { key: 'attackCurve', label: 'Atk curve', parameter: 'ENV_ATTACK_CURVE', range: [-100, 100], valid: [-100, 100] },
  { key: 'decayCurve', label: 'Dec curve', parameter: 'ENV_DECAY_CURVE', range: [-100, 100], valid: [-100, 100] },
  { key: 'releaseCurve', label: 'Rel curve', parameter: 'ENV_RELEASE_CURVE', range: [-100, 100], valid: [-100, 100] },
];

// Starting settings for new controls on some effect parameters: a log
// scale for ones that span a wide range (log needs a min above 0), and a
// narrower range for delay stereo offset. Anything else starts linear over
// the parameter's full range.
const EFFECT_CONTROL_DEFAULTS = {
  frequency: { scale: 'log', min: 20 },
  centerFrequency: { scale: 'log', min: 20 },
  feedbackCutoff: { scale: 'log' },
  delayTime: { scale: 'log', min: 0.01 },
  attack: { scale: 'log' }, // compressor, 0.1–200 ms
  release: { scale: 'log' }, // compressor, 5–2000 ms
  stereoOffset: { min: -1, max: 1 },
};

// Starting settings for new controls on modulator settings whose own range
// has no top (rates and times), or that span a wide range (rates, log).
const MODULATOR_CONTROL_DEFAULTS = {
  frequency: { scale: 'log', min: 0.05, max: 20 },
  delayTime: { max: 5 },
  attack: { max: 10 },
  decay: { max: 10 },
  release: { max: 10 },
};

// How a control's movement maps to the setting. Decent Sampler has no log
// option, so a log control runs 0–1 and its binding uses a translation
// table (docs: Appendix B, "Translation Modes").
export const CONTROL_SCALES = { linear: 'Linear', log: 'Log' };

// Global targets, stored directly on the project (the rest are envelope
// values), with the setting's name in the Global section for messages.
const INSTRUMENT_SETTINGS = {
  volume: 'Volume',
  velocityTracking: 'Velocity tracking',
  globalTuning: 'Tuning',
  globalPan: 'Pan',
};

// Panels for controls with effectId null. A control's panel is its effect's
// id, or one of these.
const SECTION_TITLES = { global: 'Global', amp: 'Amp envelope', articulation: 'Articulation' };
function sectionKey({ effectId, key }) {
  if (effectId !== null) return effectId;
  if (key === 'articulation') return 'articulation';
  return key in INSTRUMENT_SETTINGS ? 'global' : 'amp';
}

// Control looks (docs: the `style` attribute). Sizes are in UI pixels and
// include the built-in label. `style: null` means the docs' default knob.
export const CONTROL_STYLES = {
  knob: { label: 'Knob', style: null, width: 70, height: 80 },
  vertical: { label: 'Vertical slider', style: 'linear_vertical', width: 56, height: 80 },
  horizontal: { label: 'Horizontal slider', style: 'linear_horizontal', width: 130, height: 44 },
};

// Panel layout, in UI pixels. Three rows of panels fit in the window.
const MARGIN = 8; // around and between panels
const PAD = 6; // inside a panel
const GAP = 6; // between controls
const TITLE_HEIGHT = 20;
const ROW_HEIGHT = 80; // tallest control
const PANEL_HEIGHT = PAD + TITLE_HEIGHT + ROW_HEIGHT + PAD;
const BUTTON = { width: 50, height: 18 };
const MENU = { width: 160, height: 26 };
const SNAP = 8; // dragged panels snap to this grid

// The name shown for an effect or modulator, in the plugin's panels and in
// the app: its kind, numbered when there are several of the same kind
// (e.g. "LFO 1", "LFO 2"), in list order.
export function ownerTitle(project, owner) {
  const isEffect = project.effects.includes(owner);
  const label = (isEffect ? EFFECT_KINDS : MODULATOR_KINDS)[owner.kind].label;
  const same = (isEffect ? project.effects : project.modulators).filter((o) => o.kind === owner.kind);
  return same.length > 1 ? `${label} ${same.indexOf(owner) + 1}` : label;
}

// What a control points at, or null if that setting no longer exists.
// `effectId` is null for Global and Amp envelope targets.
export function resolveTarget(project, { effectId, key }) {
  // The articulation menu (key switching). Only there with two or more
  // articulations to choose between.
  if (effectId === null && key === 'articulation') {
    const articulations = usedArticulations(project);
    if (articulations.length < 2) return null;
    return {
      key,
      label: 'Menu',
      order: 0,
      sectionTitle: SECTION_TITLES.articulation,
      options: articulations.map((n) => ({ articulation: n, name: articulationLabel(project, n) })),
      needsEnvelope: false,
      needsValue: null,
      applies: true,
    };
  }
  if (effectId === null) {
    const order = AMP_TARGETS.findIndex((t) => t.key === key);
    if (order < 0) return null;
    const target = AMP_TARGETS[order];
    return {
      ...target,
      order,
      sectionTitle: SECTION_TITLES[sectionKey({ effectId, key })],
      value: key in INSTRUMENT_SETTINGS ? project[key] : project.envelope[key],
      bindingTarget: 'type="amp" level="instrument" position="0"',
      needsEnvelope: !(key in INSTRUMENT_SETTINGS),
      // e.g. velocity tracking has no value until it's set in the Global section.
      needsValue: INSTRUMENT_SETTINGS[key] ?? null,
      applies: true,
      integer: false,
    };
  }
  const modulatorIndex = project.modulators.findIndex((m) => m.id === effectId);
  if (modulatorIndex >= 0) return resolveModulatorTarget(project, project.modulators[modulatorIndex], modulatorIndex, key);
  const effect = project.effects.find((e) => e.id === effectId);
  if (!effect) return null;
  const definition = EFFECT_KINDS[effect.kind];
  const common = {
    sectionTitle: ownerTitle(project, effect),
    bindingTarget: `type="effect" level="instrument" effectTags="${effect.id}"`,
    needsEnvelope: false,
    applies: true,
  };
  if (key === 'enabled') {
    return { ...common, key, label: 'On/off', parameter: 'ENABLED', order: -1, value: effect.enabled };
  }
  const order = definition.params.findIndex((p) => p.key === key);
  const parameter = EFFECT_BINDINGS[effect.kind]?.[key];
  if (order < 0 || !parameter) return null;
  const param = definition.params[order];
  const defaults = EFFECT_CONTROL_DEFAULTS[key] ?? {};
  return {
    ...common,
    key,
    label: param.label,
    parameter,
    order,
    value: effect[key],
    range: [Math.max(param.min, defaults.min ?? param.min), defaults.max ?? param.max],
    defaultScale: defaults.scale ?? 'linear',
    valid: [param.min, param.max],
    // Whole-number settings (e.g. bit depth) get an integer control.
    integer: param.step >= 1,
    // e.g. resonance doesn't apply to lowpass_1pl.
    applies: visibleParams(effect).includes(param),
  };
}

// A modulator setting (docs: type="modulator", found by its place in
// <modulators>, as the docs' examples do).
function resolveModulatorTarget(project, modulator, index, key) {
  const definition = MODULATOR_KINDS[modulator.kind];
  const common = {
    sectionTitle: ownerTitle(project, modulator),
    bindingTarget: `type="modulator" level="instrument" modulatorIndex="${index}"`,
    needsEnvelope: false,
    needsValue: null,
    applies: true,
  };
  if (key === 'enabled') {
    return { ...common, key, label: 'On/off', parameter: 'ENABLED', order: -1, value: modulator.enabled };
  }
  const order = definition.fields.findIndex((f) => f.key === key);
  const parameter = MODULATOR_BINDINGS[modulator.kind]?.[key];
  if (order < 0 || !parameter) return null;
  const field = definition.fields[order];
  const defaults = MODULATOR_CONTROL_DEFAULTS[key] ?? {};
  return {
    ...common,
    key,
    label: field.label,
    parameter,
    order,
    value: modulator[key],
    range: [defaults.min ?? field.min, defaults.max ?? field.max],
    defaultScale: defaults.scale ?? 'linear',
    valid: [field.min, field.max],
    integer: false,
    // e.g. random's rate only applies at a set rate.
    applies: visibleFields(modulator).includes(field),
  };
}

// Everything a control can be added for, grouped by panel, for the Add menu.
function availableTargets(project) {
  const options = (section) =>
    AMP_TARGETS.filter((t) => sectionKey({ effectId: null, key: t.key }) === section).map(({ key, label }) => ({ key, label }));
  const groups = [
    { title: SECTION_TITLES.global, effectId: null, options: options('global') },
    { title: SECTION_TITLES.amp, effectId: null, options: options('amp') },
  ];
  if (usedArticulations(project).length >= 2) {
    groups.push({ title: SECTION_TITLES.articulation, effectId: null, options: [{ key: 'articulation', label: 'Menu' }] });
  }
  project.effects.forEach((effect, index) => {
    const definition = EFFECT_KINDS[effect.kind];
    const bindings = EFFECT_BINDINGS[effect.kind] ?? {};
    const options = [{ key: 'enabled', label: 'On/off button' }];
    for (const param of definition.params) {
      if (bindings[param.key]) options.push({ key: param.key, label: param.label });
    }
    groups.push({ title: `${index + 1}. ${definition.label} (${effect.id})`, effectId: effect.id, options });
  });
  for (const modulator of project.modulators) {
    const definition = MODULATOR_KINDS[modulator.kind];
    const bindings = MODULATOR_BINDINGS[modulator.kind] ?? {};
    const options = [{ key: 'enabled', label: 'On/off button' }];
    for (const field of visibleFields(modulator)) {
      if (bindings[field.key]) options.push({ key: field.key, label: field.label });
    }
    groups.push({ title: `${definition.label} (${modulator.id})`, effectId: modulator.id, options });
  }
  return groups;
}

// Places every control. Returns { panels, fits, overlaps }. Each panel has a
// `key` ('global', 'amp', 'articulation', or the effect or modulator id), its
// title, an optional on/off button (top right), an optional menu, and its
// knobs/sliders in a row.
//
// Until a panel is dragged (project.ui.positions is null), panels flow left
// to right and wrap. After that, panels sit at their saved positions, and a
// panel without one goes into the first free space that fits it.
export function layoutControls(project) {
  // First work out each panel's contents and width.
  const specs = [];
  const owners = [...project.effects, ...project.modulators];
  for (const section of ['global', 'amp', 'articulation', ...owners.map((o) => o.id)]) {
    const controls = project.ui.controls.filter((c) => sectionKey(c) === section);
    if (controls.length === 0) continue;
    const owner = owners.find((o) => o.id === section);
    const title = SECTION_TITLES[section] ?? ownerTitle(project, owner);
    const button = controls.find((c) => c.kind === 'button') ?? null;
    const menu = controls.find((c) => c.kind === 'menu') ?? null;
    // Knobs in the order their settings appear, not the order they were added.
    const order = (c) => resolveTarget(project, c)?.order ?? Infinity;
    const knobs = controls.filter((c) => c.kind === 'knob').sort((a, b) => order(a) - order(b));
    const knobsWidth = knobs.reduce((sum, c) => sum + CONTROL_STYLES[c.style].width, 0) + GAP * Math.max(knobs.length - 1, 0);
    const titleWidth = title.length * 8 + (button ? BUTTON.width + GAP : 0);
    const width = PAD * 2 + Math.max(knobsWidth, titleWidth, menu ? MENU.width : 0);
    specs.push({ key: section, title, button, menu, knobs, width });
  }

  // Then where each panel goes.
  const positions = project.ui.positions;
  const where = new Map();
  if (positions === null) {
    // Left to right, wrapping to a new row when a panel doesn't fit.
    let x = MARGIN;
    let y = MARGIN;
    for (const spec of specs) {
      if (x > MARGIN && x + spec.width > UI_WIDTH - MARGIN) {
        x = MARGIN;
        y += PANEL_HEIGHT + MARGIN;
      }
      where.set(spec, { x, y });
      x += spec.width + MARGIN;
    }
  } else {
    // Saved positions first, then new panels into the space left over.
    const placed = [];
    for (const spec of specs.filter((s) => positions[s.key])) {
      where.set(spec, positions[spec.key]);
      placed.push({ ...positions[spec.key], width: spec.width, height: PANEL_HEIGHT });
    }
    for (const spec of specs.filter((s) => !positions[s.key])) {
      const spot = findFreeSpace(placed, spec.width) ?? { x: MARGIN, y: MARGIN };
      where.set(spec, spot);
      placed.push({ ...spot, width: spec.width, height: PANEL_HEIGHT });
    }
  }
  const panels = specs.map((spec) => placePanel(spec, where.get(spec)));

  const fits = panels.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.width <= UI_WIDTH && p.y + p.height <= UI_HEIGHT);
  // Pairs of panels that overlap (only possible after dragging).
  const overlaps = [];
  panels.forEach((a, i) => {
    for (const b of panels.slice(i + 1)) if (intersects(a, b, 0)) overlaps.push([a, b]);
  });
  return { panels, fits, overlaps };
}

function placePanel({ key, title, width, button, menu, knobs }, { x, y }) {
  const panel = { key, x, y, width, height: PANEL_HEIGHT, title, button: null, menu: null, knobs: [] };
  if (button) {
    panel.button = { control: button, x: x + width - PAD - BUTTON.width, y: y + PAD + 1, ...BUTTON };
  }
  if (menu) {
    // Just under the title.
    panel.menu = { control: menu, x: x + PAD, y: y + PAD + TITLE_HEIGHT + 4, ...MENU };
  }
  let knobX = x + PAD;
  for (const control of knobs) {
    const { width: w, height: h } = CONTROL_STYLES[control.style];
    // Centre shorter controls (horizontal sliders) in the row.
    const knobY = y + PAD + TITLE_HEIGHT + (ROW_HEIGHT - h) / 2;
    panel.knobs.push({ control, x: knobX, y: knobY, width: w, height: h });
    knobX += w + GAP;
  }
  return panel;
}

// Do two rectangles overlap, counting `gap` pixels of space around them?
function intersects(a, b, gap) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

// The first spot (top to bottom, left to right, on the snap grid) where a
// panel of this width fits inside the window without touching the others.
function findFreeSpace(placed, width) {
  for (let y = MARGIN; y + PANEL_HEIGHT <= UI_HEIGHT - MARGIN; y += SNAP) {
    for (let x = MARGIN; x + width <= UI_WIDTH - MARGIN; x += SNAP) {
      const spot = { x, y, width, height: PANEL_HEIGHT };
      if (!placed.some((p) => intersects(spot, p, MARGIN))) return { x, y };
    }
  }
  return null;
}

// Saves every panel's current position, so the layout stops being automatic
// and panels stay put. Also drops positions of panels that no longer exist.
function freezePositions(project) {
  const positions = {};
  for (const { key, x, y } of layoutControls(project).panels) positions[key] = { x, y };
  project.ui.positions = positions;
}

// `onChange` is called after any control changes, so the XML preview and
// export checks can update.
export function renderControlsEditor(container, project, onChange) {
  const rerender = () => renderControlsEditor(container, project, onChange);
  const controls = project.ui.controls;
  const preview = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  preview.classList.add('ui-preview');
  // Label edits only need the picture redrawn (a full rerender would lose
  // the text box's focus while typing).
  // After a drag, rebuild everything: the hint and Reset button depend on
  // whether the layout is manual, and the export uses the new positions.
  const afterDrag = () => {
    rerender();
    onChange();
  };
  const redrawPreview = () => drawPreview(preview, project, afterDrag);
  // Once the layout is manual, pin every panel (including newly added ones)
  // so later changes don't move them.
  if (project.ui.positions !== null) freezePositions(project);

  // Background colour (docs: bgColor, 8-digit ARGB). The picker has no
  // transparency, so the alpha is always FF (solid).
  const colourRow = document.createElement('p');
  const colour = document.createElement('input');
  colour.type = 'color';
  colour.value = `#${project.ui.bgColor.slice(2).toLowerCase()}`;
  colour.addEventListener('input', () => {
    project.ui.bgColor = `FF${colour.value.slice(1).toUpperCase()}`;
    redrawPreview();
    onChange();
  });
  const colourLabel = document.createElement('label');
  colourLabel.append('Background colour ', colour);
  colourRow.append(colourLabel);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    controls.length === 0
      ? 'No controls yet. Without controls, the preset has no custom window.'
      : project.ui.positions === null
        ? 'Controls are placed automatically: Global, Amp envelope, Articulation, each effect in chain order, then each modulator. Drag a panel in the preview to move it.'
        : 'Drag a panel in the preview to move it. New panels go into the first free space.';

  // One row per control, in layout order.
  const table = document.createElement('table');
  table.className = 'controls-table';
  const { panels } = layoutControls(project);
  for (const panel of panels) {
    const rows = [panel.button, panel.menu, ...panel.knobs].filter(Boolean).map(({ control }) => control);
    for (const control of rows) table.append(renderControlRow(control, panel.title, project, rerender, redrawPreview, onChange));
  }

  // "Add control" row. Settings that already have a control are greyed out.
  const addRow = document.createElement('p');
  const targetSelect = document.createElement('select');
  for (const group of availableTargets(project)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.title;
    for (const { key, label } of group.options) {
      const option = new Option(label, JSON.stringify({ effectId: group.effectId, key }));
      option.disabled = controls.some((c) => c.effectId === group.effectId && c.key === key);
      optgroup.append(option);
    }
    targetSelect.append(optgroup);
  }
  const firstFree = [...targetSelect.options].find((o) => !o.disabled);
  if (firstFree) targetSelect.value = firstFree.value;
  const addButton = document.createElement('button');
  addButton.textContent = 'Add';
  addButton.disabled = !firstFree;
  addButton.addEventListener('click', () => {
    const { effectId, key } = JSON.parse(targetSelect.value);
    addControl(project, effectId, key);
    rerender();
    onChange();
  });
  addRow.append('Add control: ', targetSelect, ' ', addButton);

  // Back to the automatic layout.
  const resetRow = document.createElement('p');
  const reset = document.createElement('button');
  reset.textContent = 'Reset layout';
  reset.disabled = project.ui.positions === null;
  reset.addEventListener('click', () => {
    project.ui.positions = null;
    rerender();
    onChange();
  });
  resetRow.append(reset);

  redrawPreview();
  container.replaceChildren(colourRow, hint, table, addRow, preview, resetRow);
}

// Controls are added automatically (and can then be removed in the list):
// - adding an effect adds its on/off button and a control for every
//   parameter that can be bound and applies to its current type;
// - adding a modulator adds its on/off button and its main settings
//   (AUTO_MODULATOR_KEYS);
// - ticking the envelope adds attack, decay, sustain and release (curves
//   only from the Add menu); unticking removes all envelope controls;
// - a new project starts with a Volume control;
// - a second articulation (key switching) adds the articulation menu, and
//   going back to fewer than two removes it.
// Controls that stop applying (e.g. resonance on lowpass_1pl) are removed.
const AUTO_ENVELOPE_KEYS = ['attack', 'decay', 'sustain', 'release'];
const AUTO_MODULATOR_KEYS = {
  lfo: ['frequency', 'modAmount'],
  envelope: ['attack', 'decay', 'sustain', 'release'],
  midiCC: ['modAmount'],
  midiVelocity: ['modAmount'],
  random: ['frequency'],
};

// Adds a control for a setting, unless it already has one.
export function addControl(project, effectId, key) {
  const controls = project.ui.controls;
  if (controls.some((c) => c.effectId === effectId && c.key === key)) return;
  controls.push(createControl(project, effectId, key));
}

export function addEffectControls(project, effect) {
  addControl(project, effect.id, 'enabled');
  const bindings = EFFECT_BINDINGS[effect.kind] ?? {};
  for (const param of visibleParams(effect)) {
    if (bindings[param.key]) addControl(project, effect.id, param.key);
  }
}

export function removeArticulationMenu(project) {
  project.ui.controls = project.ui.controls.filter((c) => c.kind !== 'menu');
}

export function addModulatorControls(project, modulator) {
  addControl(project, modulator.id, 'enabled');
  for (const key of AUTO_MODULATOR_KEYS[modulator.kind]) {
    if (resolveTarget(project, { effectId: modulator.id, key })?.applies) addControl(project, modulator.id, key);
  }
}

export function addEnvelopeControls(project) {
  for (const key of AUTO_ENVELOPE_KEYS) addControl(project, null, key);
}

export function removeEnvelopeControls(project) {
  project.ui.controls = project.ui.controls.filter((c) => !(c.effectId === null && !(c.key in INSTRUMENT_SETTINGS)));
}

// After an effect's type (or a modulator's setting) changes, drop controls
// for parameters it no longer has. `owner` is the effect or modulator.
export function removeInapplicableControls(project, owner) {
  project.ui.controls = project.ui.controls.filter(
    (c) => c.effectId !== owner.id || resolveTarget(project, c)?.applies,
  );
}

// A new control for a setting. Its label and range start from the setting.
function createControl(project, effectId, key) {
  const target = resolveTarget(project, { effectId, key });
  if (key === 'enabled') return { kind: 'button', effectId, key };
  if (key === 'articulation') return { kind: 'menu', effectId, key };
  return {
    kind: 'knob',
    effectId,
    key,
    label: target.label,
    style: 'knob',
    scale: target.defaultScale ?? 'linear',
    minValue: target.range[0],
    maxValue: target.range[1],
  };
}

function renderControlRow(control, panelTitle, project, rerender, redrawPreview, onChange) {
  const row = document.createElement('tr');
  const target = resolveTarget(project, control);
  const cell = (...content) => {
    const td = document.createElement('td');
    td.append(...content);
    row.append(td);
  };
  cell(`${panelTitle} › ${target ? target.label : '(missing)'}`);

  if (control.kind === 'button' || control.kind === 'menu') {
    cell(control.kind === 'button' ? 'On/off button' : 'Menu (one option per articulation)');
    cell('');
    cell('');
    cell('');
    cell('');
  } else {
    const label = document.createElement('input');
    label.value = control.label;
    label.className = 'control-label';
    label.addEventListener('input', () => {
      control.label = label.value;
      redrawPreview();
      onChange();
    });
    cell(label);

    const style = document.createElement('select');
    for (const [value, { label: text }] of Object.entries(CONTROL_STYLES)) style.append(new Option(text, value));
    style.value = control.style;
    style.addEventListener('change', () => {
      control.style = style.value;
      rerender(); // the layout changes
      onChange();
    });
    cell(style);

    const scale = document.createElement('select');
    for (const [value, text] of Object.entries(CONTROL_SCALES)) scale.append(new Option(text, value));
    scale.value = control.scale;
    scale.addEventListener('change', () => {
      control.scale = scale.value;
      onChange();
    });
    cell(scale);

    for (const key of ['minValue', 'maxValue']) {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'control-input';
      input.value = control[key] ?? '';
      input.addEventListener('input', () => {
        control[key] = input.value === '' ? null : Number(input.value);
        onChange();
      });
      cell(key === 'minValue' ? 'Min ' : 'Max ', input);
    }
  }

  const remove = document.createElement('button');
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    project.ui.controls.splice(project.ui.controls.indexOf(control), 1);
    rerender();
    onChange();
  });
  cell(remove);
  return row;
}

// A rough picture of the Decent Sampler window: panels, titles, controls.
// Panels can be dragged; overlapping ones are outlined in red.
function drawPreview(svg, project, onDragEnd) {
  const ns = 'http://www.w3.org/2000/svg';
  const make = (tag, attributes, text) => {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  svg.setAttribute('viewBox', `0 0 ${UI_WIDTH} ${UI_HEIGHT}`);
  const children = [make('rect', { x: 0, y: 0, width: UI_WIDTH, height: UI_HEIGHT, fill: `#${project.ui.bgColor.slice(2)}` })];
  const { panels, fits, overlaps } = layoutControls(project);
  const overlapping = new Set(overlaps.flat());
  for (const panel of panels) {
    // One group per panel, so the whole panel is the drag handle.
    const group = make('g', { class: 'preview-panel-group' });
    group.addEventListener('pointerdown', (event) => startDrag(event, svg, project, panel, onDragEnd));
    const className = overlapping.has(panel) ? 'preview-panel preview-overlap' : 'preview-panel';
    group.append(make('rect', { x: panel.x, y: panel.y, width: panel.width, height: panel.height, class: className }));
    group.append(make('text', { x: panel.x + PAD, y: panel.y + PAD + 14, class: 'preview-title' }, panel.title));
    if (panel.button) {
      const b = panel.button;
      group.append(make('rect', { x: b.x, y: b.y, width: b.width, height: b.height, class: 'preview-control' }));
      const on = resolveTarget(project, b.control)?.value;
      group.append(make('text', { x: b.x + b.width / 2, y: b.y + 13, class: 'preview-label' }, on ? 'On' : 'Off'));
    }
    if (panel.menu) {
      const m = panel.menu;
      const first = resolveTarget(project, m.control)?.options[0]?.name ?? '';
      group.append(make('rect', { x: m.x, y: m.y, width: m.width, height: m.height, class: 'preview-control' }));
      group.append(make('text', { x: m.x + 6, y: m.y + 17, class: 'preview-title' }, `${first} ▾`));
    }
    for (const k of panel.knobs) {
      const style = k.control.style;
      if (style === 'knob') {
        group.append(make('circle', { cx: k.x + k.width / 2, cy: k.y + 46, r: 22, class: 'preview-control' }));
      } else if (style === 'vertical') {
        group.append(make('rect', { x: k.x + k.width / 2 - 4, y: k.y + 20, width: 8, height: 56, class: 'preview-control' }));
      } else {
        group.append(make('rect', { x: k.x + 4, y: k.y + 24, width: k.width - 8, height: 8, class: 'preview-control' }));
      }
      group.append(make('text', { x: k.x + k.width / 2, y: k.y + 12, class: 'preview-label' }, k.control.label));
    }
    children.push(group);
  }
  if (!fits) children.push(make('text', { x: UI_WIDTH / 2, y: UI_HEIGHT - 12, class: 'preview-warning' }, "Controls don't fit"));
  svg.replaceChildren(...children);
}

// Dragging a panel: the first drag pins every panel where it is (so nothing
// else moves), then this panel follows the pointer, snapped to the grid and
// kept inside the window. Listeners are on window so fast drags don't escape.
function startDrag(event, svg, project, panel, onDragEnd) {
  event.preventDefault();
  if (project.ui.positions === null) freezePositions(project);
  // Screen pixels → UI pixels (the preview is scaled to fit the page).
  const toUi = (e) => {
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { x: point.x, y: point.y };
  };
  const start = toUi(event);
  const origin = { x: panel.x, y: panel.y };
  const clamp = (value, max) => Math.min(Math.max(value, 0), max);

  const move = (e) => {
    const now = toUi(e);
    project.ui.positions[panel.key] = {
      x: clamp(Math.round((origin.x + now.x - start.x) / SNAP) * SNAP, UI_WIDTH - panel.width),
      y: clamp(Math.round((origin.y + now.y - start.y) / SNAP) * SNAP, UI_HEIGHT - panel.height),
    };
    drawPreview(svg, project, onDragEnd);
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    onDragEnd();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
}
