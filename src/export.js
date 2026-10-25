// Builds the .dspreset XML from the project data, and checks it before download.
//
// Structure (see docs, "The <groups> element"): one <group> per velocity layer,
// each holding that layer's samples with their key and velocity ranges.
//
// Round-robin (docs, "Round Robins"): only added when some zone has more than
// one round-robin. Then <groups> gets seqMode, and every sample gets a
// seqPosition (its place within its zone, counted 1, 2, 3… so gaps like
// rr1/rr3 don't leave a silent slot). If zones have different numbers of
// round-robins, every sample also gets seqLength, as the docs advise.
//
// Release samples (docs: trigger="release" on <group>) get their own group per
// velocity layer, after the normal ones, as in the Wurlitzer example.
//
// Choke groups (docs: Appendix D, hi-hats) go on each <sample>, since our
// groups are velocity layers: tags="chokeN" silencedByTags="chokeN".
//
// Key switching follows the docs' sound selector: each articulation's groups
// get tags="artN", and each keyswitch is a <midi><note> that sets TAG_ENABLED
// on every articulation. All but the first articulation start off through
// <tags><tag enabled="false">: enabled="false" on the group (as in the docs'
// example) can't be turned back on by TAG_ENABLED (tested in the plugin).

import { articulationOf, getZones, isExportable, isRelease, usedArticulations } from './mapping.js';
import { midiToNoteName } from './filename.js';
import { CURVE_DEFAULTS } from './project.js';
import { EFFECT_KINDS, isImpulseResponseFile, visibleParams } from './effects.js';
import { CONTROL_STYLES, UI_HEIGHT, UI_WIDTH, layoutControls, resolveTarget } from './ui.js';
import { MODULATOR_KINDS, MOD_BEHAVIORS, canTargetEffects, resolveModTarget, visibleFields } from './modulators.js';

const ROUND_ROBIN_MODES = ['round_robin', 'random', 'true_random'];

export function buildPresetXml(project) {
  const zones = getZones(project);
  const usesRoundRobin = zones.some((zone) => zone.length > 1);
  const needsLength = usesRoundRobin && new Set(zones.map((zone) => zone.length)).size > 1;

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DecentSampler>',
  ];
  // The window with controls. Left out when there are none.
  if (project.ui.controls.length > 0) lines.push(...uiLines(project));
  const articulations = usedArticulations(project);
  if (articulations.length > 1) {
    lines.push('  <tags>');
    for (const articulation of articulations.slice(1)) lines.push(`    <tag name="art${articulation}" enabled="false"/>`);
    lines.push('  </tags>');
  }
  lines.push(`  <groups${groupsAttributes(project, usesRoundRobin)}>`);
  const releaseAttributes =
    ' trigger="release"' +
    (project.releaseDecay !== null ? ` releaseTriggerDecay="${project.releaseDecay}dB"` : '') +
    (project.releaseIgnoresEnvelope ? ' ampEnvEnabled="false"' : '');
  // Normal groups, then release groups; within each, no articulation first,
  // then articulations in order.
  const groups = [];
  for (const release of [false, true]) {
    for (const articulation of [0, ...articulations]) {
      const inSet = zones.filter(
        (zone) => isRelease(project, zone[0]) === release && articulationOf(project, zone[0]) === articulation,
      );
      let suffix = release ? ' release' : '';
      let attributes = release ? releaseAttributes : '';
      if (articulation > 0) {
        suffix = ` art${articulation}${suffix}`;
        attributes = ` tags="art${articulation}"${attributes}`;
      }
      groups.push(...layerGroups(inSet, suffix, attributes));
    }
  }
  for (const { name, attributes, zones: inLayer } of groups) {
    lines.push(`    <group name="${name}"${attributes}>`);
    for (const zone of inLayer) {
      zone.forEach((s, index) => {
        let line =
          `      <sample path="${escapeXml(s.path)}" rootNote="${s.rootNote}"` +
          ` loNote="${s.loNote}" hiNote="${s.hiNote}" loVel="${s.loVel}" hiVel="${s.hiVel}"`;
        if (usesRoundRobin) line += ` seqPosition="${index + 1}"`;
        if (needsLength) line += ` seqLength="${zone.length}"`;
        if (s.start !== null) line += ` start="${s.start}"`;
        if (s.end !== null) line += ` end="${s.end}"`;
        if (s.loopEnabled) {
          line += ` loopEnabled="true" loopStart="${s.loopStart}" loopEnd="${s.loopEnd}"`;
          if (s.loopCrossfade > 0) line += ` loopCrossfade="${s.loopCrossfade}"`;
        }
        line += chokeAttributes(project, s);
        lines.push(line + '/>');
      });
    }
    lines.push('    </group>');
  }
  lines.push('  </groups>');

  // Instrument-wide effects, in processing order. Left out when there are none.
  if (project.effects.length > 0) {
    lines.push('  <effects>');
    for (const effect of project.effects) lines.push(`    ${effectElement(effect, project)}`);
    lines.push('  </effects>');
  }

  if (project.modulators.length > 0) lines.push(...modulatorLines(project));
  if (articulations.length > 0) lines.push(...keyswitchLines(project, articulations));

  lines.push('</DecentSampler>', '');
  return lines.join('\n');
}

// One group per velocity layer, its zones sorted by root note. `suffix` is
// added to the group name and `attributes` to the element.
function layerGroups(zones, suffix, attributes) {
  const layers = [...new Set(zones.map((zone) => zone[0].velocityLayer))].sort((a, b) => a - b);
  return layers.map((layer) => ({
    name: `v${layer}${suffix}`,
    attributes,
    zones: zones.filter((zone) => zone[0].velocityLayer === layer).sort((a, b) => a[0].rootNote - b[0].rootNote),
  }));
}

// For a sample in a choke group: its tag, cut off by the same tag, and how it
// stops ('fast' is the docs' default, so it isn't written).
function chokeAttributes(project, s) {
  const group = project.chokeGroups[s.name];
  if (!group) return '';
  let attributes = ` tags="choke${group}" silencedByTags="choke${group}"`;
  if (project.chokeMode === 'normal') attributes += ' silencingMode="normal"';
  if (project.chokeMode === 'decay') attributes += ` silencingDecay="${project.chokeDecay}"`;
  return attributes;
}

// The <midi> element: one <note> per keyswitch. swallowNotes stops the key
// from also playing a sample. Each enables its own articulation's tag and
// disables the others (docs: "The <note> element", TAG_ENABLED).
function keyswitchLines(project, articulations) {
  const hasMenu = project.ui.controls.some((c) => c.kind === 'menu');
  const lines = ['  <midi>'];
  for (const articulation of articulations) {
    const note = project.keyswitches[articulation];
    lines.push(`    <note note="${note}" eventType="note_on" swallowNotes="true">`);
    for (const other of articulations) lines.push(`      ${tagEnabledBinding(other, other === articulation)}`);
    // Keep the menu (if there is one) showing the chosen articulation, as the
    // docs advise when MIDI and a UI control change the same thing.
    if (hasMenu) {
      lines.push(
        `      <binding type="control" level="ui" tags="${ARTICULATION_MENU_TAG}" parameter="VALUE"` +
          ` translation="fixed_value" translationValue="${articulations.indexOf(articulation) + 1}"/>`,
      );
    }
    lines.push('    </note>');
  }
  lines.push('  </midi>');
  return lines;
}

// The <modulators> element: one element per modulator (<lfo>, <envelope>…)
// with a binding per target. Each field is written in the order
// MODULATOR_KINDS lists it, except where it says to leave it out (e.g. the
// docs' default); enabled only when off.
function modulatorLines(project) {
  const lines = ['  <modulators>'];
  for (const modulator of project.modulators) {
    const { element } = MODULATOR_KINDS[modulator.kind];
    let line = `    <${element}`;
    for (const field of visibleFields(modulator)) {
      const value = modulator[field.key];
      if (field.omit?.(value)) continue;
      line += ` ${field.key}="${escapeXml(String(value))}"`;
    }
    if (!modulator.enabled) line += ' enabled="false"';
    lines.push(line + '>');
    for (const target of modulator.targets) {
      const resolved = resolveModTarget(project, target);
      if (!resolved) continue; // reported by checkModulators
      const { bindingTarget, parameter } = resolved;
      lines.push(
        `      <binding ${bindingTarget} parameter="${parameter}" modBehavior="${target.behavior}"` +
          ` translation="linear" translationOutputMin="${target.min}" translationOutputMax="${target.max}"/>`,
      );
    }
    lines.push(`    </${element}>`);
  }
  lines.push('  </modulators>');
  return lines;
}

const ARTICULATION_MENU_TAG = 'articulation-menu';

// Turns an articulation's tag on or off.
function tagEnabledBinding(articulation, on) {
  return (
    `<binding type="amp" level="tag" identifier="art${articulation}" parameter="TAG_ENABLED"` +
    ` translation="fixed_value" translationValue="${on}"/>`
  );
}

// One <effect> element (docs: "The <effect> element"): the type, then each
// parameter that applies, in the order EFFECT_KINDS lists them. `enabled` is
// only written when off; `tags` (its id) only when a control targets it.
function effectElement(effect, project) {
  let element = `<effect type="${effect.type}"`;
  for (const param of visibleParams(effect)) {
    element += ` ${param.key}="${escapeXml(String(effect[param.key]))}"`;
  }
  if (!effect.enabled) element += ' enabled="false"';
  if (project.ui.controls.some((c) => c.effectId === effect.id)) element += ` tags="${effect.id}"`;
  return element + '/>';
}

// The <ui> element: one tab with a panel (rectangle + title label) per
// section, holding its on/off button and knobs/sliders (docs: "The <ui>
// element"; bindings: Appendix B). Positions come from layoutControls.
function uiLines(project) {
  const lines = [
    `  <ui width="${UI_WIDTH}" height="${UI_HEIGHT}" bgColor="${project.ui.bgColor}">`,
    '    <tab name="main">',
  ];
  for (const panel of layoutControls(project).panels) {
    const titleWidth = panel.width - 12 - (panel.button ? panel.button.width + 6 : 0);
    lines.push(
      `      <rectangle x="${panel.x}" y="${panel.y}" width="${panel.width}" height="${panel.height}"` +
        ' fillColor="#FF333333" borderColor="#FF555555" borderThickness="1"/>',
      `      <label x="${panel.x + 6}" y="${panel.y + 6}" width="${titleWidth}" height="20"` +
        ` text="${escapeXml(panel.title)}" textColor="FFFFFFFF" textSize="14" hAlign="left"/>`,
    );
    if (panel.button) {
      // Two states: On (index 0) and Off (index 1). Each sets the effect's
      // ENABLED to a fixed value. It starts in the effect's current state.
      const { control, x, y, width, height } = panel.button;
      const target = resolveTarget(project, control);
      const state = (name, on) =>
        `        <state name="${name}"><binding ${target.bindingTarget} parameter="ENABLED"` +
        ` translation="fixed_value" translationValue="${on}"/></state>`;
      lines.push(
        `      <button x="${x}" y="${y}" width="${width}" height="${height}" style="text" value="${target.value ? 0 : 1}">`,
        state('On', true),
        state('Off', false),
        '      </button>',
      );
    }
    // Later elements are drawn on top, so controls come after their panel.
    if (panel.menu) lines.push(...menuLines(project, panel.menu));
    for (const { control, x, y, width, height } of panel.knobs) {
      const target = resolveTarget(project, control);
      const style = CONTROL_STYLES[control.style].style;
      // The DAW lists automatable parameters by name, so include the panel.
      const parameterName = `${panel.title} ${control.label}`;
      const { min, max, value, valueType, translation } =
        control.scale === 'log' ? logControl(control, target) : linearControl(control, target);
      lines.push(
        `      <labeled-knob x="${x}" y="${y}" width="${width}" height="${height}"` +
          ` label="${escapeXml(control.label)}" parameterName="${escapeXml(parameterName)}"` +
          ` valueType="${valueType}" minValue="${min}" maxValue="${max}" value="${value}"` +
          ` textColor="FFFFFFFF"${style ? ` style="${style}"` : ''}>`,
        `        <binding ${target.bindingTarget} parameter="${target.parameter}" ${translation}/>`,
        '      </labeled-knob>',
      );
    }
  }
  lines.push('    </tab>', '  </ui>');
  return lines;
}

// The articulation menu: one option per articulation, each enabling its own
// tag and disabling the others (docs: <menu>, <option>, and the sound
// selector example). It starts on the first, which is on when the preset
// loads. Keyswitches find it by its tag to keep it in step.
function menuLines(project, { control, x, y, width, height }) {
  const { options } = resolveTarget(project, control);
  const lines = [
    `      <menu x="${x}" y="${y}" width="${width}" height="${height}" value="1" tags="${ARTICULATION_MENU_TAG}"` +
      ' textColor="FFFFFFFF" backgroundColor="FF222222">',
  ];
  for (const { articulation, name } of options) {
    lines.push(`        <option name="${escapeXml(name)}">`);
    for (const other of options) lines.push(`          ${tagEnabledBinding(other.articulation, other.articulation === articulation)}`);
    lines.push('        </option>');
  }
  lines.push('      </menu>');
  return lines;
}

// A linear control shows the setting's own values and passes them straight on.
function linearControl(control, target) {
  const { minValue: min, maxValue: max } = control;
  return {
    min,
    max,
    value: target.value,
    valueType: target.integer ? 'integer' : 'float',
    translation: `translation="linear" translationOutputMin="${min}" translationOutputMax="${max}"`,
  };
}

// A log control runs 0–1. Its translation table maps evenly spaced positions
// to values spaced evenly in ratio (e.g. 20, 40, 80… Hz), so each part of the
// knob covers the same number of octaves. Decent Sampler draws straight lines
// between the points. The last input is 1.0001, as in the docs' example.
const LOG_POINTS = 24;
function logControl(control, target) {
  const { minValue: min, maxValue: max } = control;
  const ratio = max / min;
  const points = [];
  for (let i = 0; i <= LOG_POINTS; i++) {
    const position = i / LOG_POINTS;
    const output = i === LOG_POINTS ? max : Number((min * ratio ** position).toPrecision(4));
    points.push(`${i === LOG_POINTS ? '1.0001' : Number(position.toFixed(4))},${output}`);
  }
  // Start where the current setting sits on the curve.
  const value = Number((Math.log(target.value / min) / Math.log(ratio)).toFixed(4));
  return {
    min: 0,
    max: 1,
    value: Math.min(Math.max(value, 0), 1),
    valueType: 'float',
    translation: `translation="table" translationTable="${points.join(';')}"`,
  };
}

// Attributes on <groups>: the instrument-wide envelope (if switched on) and
// the round-robin mode (if there are round-robins).
function groupsAttributes(project, usesRoundRobin) {
  let attributes = project.volume !== 1 ? ` volume="${project.volume}"` : '';
  // Velocity tracking is only written when set (the docs give no default).
  if (project.velocityTracking !== null) attributes += ` ampVelTrack="${project.velocityTracking}"`;
  if (project.globalTuning !== 0) attributes += ` globalTuning="${project.globalTuning}"`;
  if (project.globalPan !== 0) attributes += ` globalPan="${project.globalPan}"`;
  const envelope = project.envelope;
  if (envelope.enabled) {
    attributes +=
      ` attack="${envelope.attack}" decay="${envelope.decay}"` +
      ` sustain="${envelope.sustain}" release="${envelope.release}"`;
    // Curves are only written when changed from the docs' defaults.
    for (const key of Object.keys(CURVE_DEFAULTS)) {
      if (envelope[key] !== CURVE_DEFAULTS[key]) attributes += ` ${key}="${envelope[key]}"`;
    }
  }
  if (usesRoundRobin) attributes += ` seqMode="${project.roundRobinMode}"`;
  return attributes;
}

// Returns a list of problems (empty if the preset is OK to download).
export function checkPreset(project, xml) {
  const problems = [];
  const samples = project.samples.filter(isExportable);
  if (samples.length === 0) problems.push('No samples to export');
  if (!ROUND_ROBIN_MODES.includes(project.roundRobinMode)) {
    problems.push(`Unknown round-robin mode "${project.roundRobinMode}"`);
  }

  if (!Number.isFinite(project.volume) || project.volume < 0) problems.push('Volume must be a number, 0 or more');
  const tracking = project.velocityTracking;
  if (tracking !== null && (!Number.isFinite(tracking) || tracking < 0 || tracking > 1)) {
    problems.push('Velocity tracking must be a number from 0 to 1 (or blank)');
  }
  // The docs give no range for tuning; ±48 semitones (4 octaves) is a sanity limit.
  if (!Number.isFinite(project.globalTuning) || Math.abs(project.globalTuning) > 48) {
    problems.push('Tuning must be a number of semitones from -48 to 48');
  }
  if (!Number.isFinite(project.globalPan) || Math.abs(project.globalPan) > 100) {
    problems.push('Pan must be a number from -100 to 100');
  }
  const decay = project.releaseDecay;
  if (decay !== null && (!Number.isFinite(decay) || decay < 0)) {
    problems.push('Release decay must be a number of dB per second, 0 or more (or blank)');
  }
  if (!['fast', 'normal', 'decay'].includes(project.chokeMode)) problems.push(`Unknown choke mode "${project.chokeMode}"`);
  if (project.chokeMode === 'decay' && (!Number.isFinite(project.chokeDecay) || project.chokeDecay <= 0)) {
    problems.push('Choke fade must be a number of seconds, above 0');
  }
  problems.push(...checkKeyswitches(project));
  problems.push(...checkModulators(project));
  if (project.envelope.enabled) problems.push(...checkEnvelope(project.envelope));
  project.effects.forEach((effect, index) => {
    for (const problem of checkEffect(effect, project)) problems.push(`Effect ${index + 1} (${effect.kind}): ${problem}`);
  });
  problems.push(...checkControls(project));

  for (const s of samples) {
    if (!isValidRange(s.loNote, s.hiNote)) {
      problems.push(`${s.path}: invalid key range ${s.loNote}–${s.hiNote}`);
    }
    if (!isValidRange(s.loVel, s.hiVel)) {
      problems.push(`${s.path}: invalid velocity range ${s.loVel}–${s.hiVel}`);
    }
    for (const problem of checkTrim(s)) problems.push(`${s.path}: ${problem}`);
    if (s.loopEnabled) {
      for (const problem of checkLoop(s)) problems.push(`${s.path}: ${problem}`);
    }
  }

  // Let the browser read the XML back. If it can't, the file is broken.
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) problems.push(`XML is not well-formed: ${parseError.textContent}`);

  return problems;
}

// Trim rules: whole numbers, 0 or more; start before end; end inside the file
// (only checked when the length is known, i.e. WAV). Either may be blank.
function checkTrim(s) {
  const isFrame = (n) => n === null || (Number.isInteger(n) && n >= 0);
  if (!isFrame(s.start) || !isFrame(s.end)) return ['trim start and end must be whole numbers, 0 or more (or blank)'];
  const problems = [];
  if (s.start !== null && s.end !== null && s.start >= s.end) problems.push('trim start must be before trim end');
  if (s.end !== null && s.frames !== null && s.end > s.frames - 1) {
    problems.push(`trim end is past the end of the file (last frame is ${s.frames - 1})`);
  }
  if (s.start !== null && s.frames !== null && s.start > s.frames - 1) {
    problems.push(`trim start is past the end of the file (last frame is ${s.frames - 1})`);
  }
  return problems;
}

// Loop rules: whole numbers; start before end; end inside the file (only
// checked when the length is known, i.e. WAV); the crossfade is taken from
// the audio before the loop start, so it can't be longer than that, or than
// the loop itself.
function checkLoop(s) {
  const isFrame = (n) => Number.isInteger(n) && n >= 0;
  if (!isFrame(s.loopStart) || !isFrame(s.loopEnd) || !isFrame(s.loopCrossfade)) {
    return ['loop start, end and crossfade must be whole numbers, 0 or more'];
  }
  const problems = [];
  if (s.loopStart >= s.loopEnd) problems.push('loop start must be before loop end');
  if (s.frames !== null && s.loopEnd > s.frames - 1) {
    problems.push(`loop end is past the end of the file (last frame is ${s.frames - 1})`);
  }
  if (s.loopCrossfade > s.loopStart) {
    problems.push('crossfade is longer than the audio before the loop start');
  }
  if (s.loopCrossfade > s.loopEnd - s.loopStart) {
    problems.push('crossfade is longer than the loop');
  }
  // The loop has to sit inside the part that plays (our assumption: the docs
  // don't say how trim and loop interact).
  if (s.start !== null && s.loopStart < s.start) problems.push('loop start is before the trim start');
  if (s.end !== null && s.loopEnd > s.end) problems.push('loop end is after the trim end');
  return problems;
}

// Modulator settings: ranges and options come from MODULATOR_KINDS (taken
// from the docs). Each target must exist, with a known behaviour and two
// different numbers for its range.
function checkModulators(project) {
  const problems = [];
  for (const modulator of project.modulators) {
    const definition = MODULATOR_KINDS[modulator.kind];
    if (!definition) {
      problems.push(`Modulator ${modulator.id}: unknown kind "${modulator.kind}"`);
      continue;
    }
    const name = `${definition.label} ${modulator.id}`;
    for (const field of visibleFields(modulator)) {
      const value = modulator[field.key];
      const label = field.label || field.key;
      if (field.kind === 'choice') {
        if (!field.options.some(([option]) => option === value)) problems.push(`${name}: unknown ${label} "${value}"`);
        continue;
      }
      if (value === null && field.optional) continue;
      const ok =
        Number.isFinite(value) &&
        (field.above ? value > field.min : value >= field.min) &&
        value <= field.max &&
        (!field.integer || Number.isInteger(value));
      if (!ok) {
        const lower = field.above ? `above ${field.min}` : `from ${field.min}`;
        const range = field.max === Infinity ? (field.above ? lower : `${field.min} or more`) : `${lower} to ${field.max}`;
        problems.push(`${name}: ${label} must be a ${field.integer ? 'whole number' : 'number'} ${range}`);
      }
    }
    for (const target of modulator.targets) {
      const resolved = resolveModTarget(project, target);
      if (!resolved) {
        problems.push(`${name}: a target no longer exists`);
        continue;
      }
      if (target.effectId !== null && !canTargetEffects(modulator)) {
        // LFO, MIDI CC and random can when shared; envelopes and velocity never can.
        const fix = canTargetEffects({ ...modulator, scope: 'global' })
          ? `one-per-note modulators can't move instrument-wide effects; set it to "Shared by all notes" or target volume, tuning or pan`
          : `${definition.label.toLowerCase()} modulators can't move instrument-wide effects; target volume, tuning or pan`;
        problems.push(`${name} › ${resolved.label}: ${fix}`);
      }
      if (!MOD_BEHAVIORS.includes(target.behavior)) problems.push(`${name} › ${resolved.label}: unknown behaviour "${target.behavior}"`);
      if (!Number.isFinite(target.min) || !Number.isFinite(target.max) || target.min === target.max) {
        problems.push(`${name} › ${resolved.label}: From and To must be two different numbers`);
      }
    }
  }
  return problems;
}

// Each articulation in use needs its own keyswitch note, 0–127.
function checkKeyswitches(project) {
  const problems = [];
  const seen = new Map();
  for (const articulation of usedArticulations(project)) {
    const note = project.keyswitches[articulation];
    if (!Number.isInteger(note) || note < 0 || note > 127) {
      problems.push(`Articulation ${articulation} needs a keyswitch note from 0 to 127`);
    } else if (seen.has(note)) {
      problems.push(`Articulations ${seen.get(note)} and ${articulation} both use keyswitch ${midiToNoteName(note)} (${note})`);
    } else {
      seen.set(note, articulation);
    }
  }
  return problems;
}

// Times must be 0 or more (the docs give no upper limit); sustain is 0–1.
function checkEnvelope(envelope) {
  const problems = [];
  for (const key of ['attack', 'decay', 'release']) {
    const value = envelope[key];
    if (!Number.isFinite(value) || value < 0) {
      problems.push(`Envelope: ${key} must be a number of seconds, 0 or more`);
    }
  }
  const sustain = envelope.sustain;
  if (!Number.isFinite(sustain) || sustain < 0 || sustain > 1) {
    problems.push('Envelope: sustain must be a number from 0 to 1');
  }
  for (const key of Object.keys(CURVE_DEFAULTS)) {
    const value = envelope[key];
    if (!Number.isFinite(value) || value < -100 || value > 100) {
      problems.push(`Envelope: ${key} must be a number from -100 to 100`);
    }
  }
  return problems;
}

// Ranges and options come from EFFECT_KINDS (taken from the docs' tables).
function checkEffect(effect, project) {
  const definition = EFFECT_KINDS[effect.kind];
  if (!definition) return [`unknown effect kind "${effect.kind}"`];
  const problems = [];
  if (!definition.types.includes(effect.type)) problems.push(`unknown type "${effect.type}"`);
  if (typeof effect.enabled !== 'boolean') problems.push('On must be on or off');
  for (const param of visibleParams(effect)) {
    const value = effect[param.key];
    if (param.kind === 'number') {
      if (!Number.isFinite(value) || value < param.min || value > param.max) {
        const unit = param.unit && !param.unit.startsWith('(') ? ` ${param.unit}` : '';
        problems.push(`${param.label} must be a number from ${param.min} to ${param.max}${unit}`);
      }
    } else if (param.kind === 'choice') {
      if (!param.options.includes(value)) problems.push(`${param.label} must be one of ${param.options.join(', ')}`);
    } else if (param.kind === 'toggle') {
      if (typeof value !== 'boolean') problems.push(`${param.label} must be on or off`);
    } else if (param.kind === 'file') {
      if (!value) problems.push(`choose a file for ${param.label}`);
      else if (!isImpulseResponseFile(value)) problems.push(`${param.label} must be a WAV or AIFF file`);
      else if (!project.samples.some((s) => s.path === value)) problems.push(`${param.label} "${value}" is not in the picked folder`);
    }
  }
  return problems;
}

// Each control needs a target that exists and applies, a min below its max
// within what the setting allows, and the setting's current value inside
// min–max (it becomes the control's starting value). Everything must fit.
function checkControls(project) {
  const problems = [];
  if (!/^[0-9A-F]{8}$/.test(project.ui.bgColor)) problems.push('Controls: background colour must be 8 hex digits');
  for (const control of project.ui.controls) {
    const target = resolveTarget(project, control);
    if (!target) {
      problems.push(`Control "${control.label ?? control.key}": the setting it controls no longer exists`);
      continue;
    }
    const name = `Control "${target.sectionTitle} › ${control.kind === 'button' ? 'On/off' : control.label}"`;
    if (target.needsValue && target.value === null) {
      problems.push(`${name}: set ${target.needsValue} in the Global section to use this control`);
    }
    if (target.needsEnvelope && !project.envelope.enabled) {
      problems.push(`${name}: tick "Set an envelope" to use envelope controls`);
    }
    if (!target.applies) problems.push(`${name}: ${target.label} doesn't apply to this effect's current type`);
    if (control.kind !== 'knob') continue;

    const { minValue: min, maxValue: max } = control;
    const [validMin, validMax] = target.valid;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      problems.push(`${name}: min and max must be numbers, with min below max`);
    } else if (control.scale === 'log' && min <= 0) {
      problems.push(`${name}: a log control needs a min above 0`);
    } else if (min < validMin || max > validMax) {
      const allowed = validMax === Infinity ? `${validMin} or more` : `from ${validMin} to ${validMax}`;
      problems.push(`${name}: min and max must be ${allowed}`);
    } else if (Number.isFinite(target.value) && (target.value < min || target.value > max)) {
      problems.push(`${name}: the current ${target.label} (${target.value}) is outside ${min}–${max}`);
    }
  }
  if (project.ui.controls.length > 0) {
    const { fits, overlaps } = layoutControls(project);
    if (!fits) {
      problems.push(
        `Controls don't fit in the ${UI_WIDTH}×${UI_HEIGHT} window: remove some, use narrower styles, or rearrange panels`,
      );
    }
    for (const [a, b] of overlaps) {
      problems.push(`Panels "${a.title}" and "${b.title}" overlap: drag them apart in the preview`);
    }
  }
  return problems;
}

function isValidRange(lo, hi) {
  return Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && lo <= hi && hi <= 127;
}

// Characters that would break an XML attribute value, e.g. "&" in a filename.
function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
