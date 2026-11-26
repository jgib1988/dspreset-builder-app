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
// Choking (docs: Appendix D, hi-hats) goes on each <sample>, since our
// groups are velocity layers. Each name that chokes, is choked or has a voice
// limit gets its own tag, e.g. tags="choke-HatOpen"; silencedByTags lists the
// tags of the names that cut it off (one-way is allowed). A voice limit is
// polyphony on that tag.
//
// Key switching follows the docs' sound selector: each articulation's groups
// get tags="artN", and each keyswitch is a <midi><note> that sets TAG_ENABLED
// on every articulation. All but the first articulation start off through
// <tags><tag enabled="false">: enabled="false" on the group (as in the docs'
// example) can't be turned back on by TAG_ENABLED (tested in the plugin).
//
// Mix layers get their own groups too, tagged mixN (a group can carry two
// tags, e.g. tags="art1,mix2"; tested in the plugin). A starting volume
// other than 1 goes on <tags><tag volume>; Mixer knobs use TAG_VOLUME.
// A layer's pan and tuning go on all its groups (groupPan, groupTuning), its
// own envelope only on its key-down groups (attack… on <group>, which replaces
// the instrument's; the instrument's envelope knobs then don't reach it).
// All tested in the plugin (test-samples/LayerFxTest).
//
// Monophonic: normal groups get a tag with polyphony="1" (tested in the
// plugin): monoN for mix layer N, so each layer is mono on its own, and
// "mono" for the rest. Release groups don't get one (they share mixN with
// their layer, so the voice limit can't go on that). With a Mono/Poly button
// the tags are always written; the button sets TAG_POLYPHONY to 1 or -1.

import { articulationOf, articulationVolume, getZones, isExportable, isRelease, legatoTrigger, mixLayerOf, mixLayerSettings, mixLayerVolume, usedArticulations, usedMixLayers } from './mapping.js';
import { midiToNoteName } from './filename.js';
import { CURVE_DEFAULTS } from './project.js';
import { EFFECT_KINDS, NOTE_EFFECTS_TAG, effectTypes, isImpulseResponseFile, visibleParams } from './effects.js';
import { CONTROL_STYLES, UI_HEIGHT, UI_WIDTH, layoutControls, ownerTitle, resolveTarget } from './ui.js';
import { MODULATOR_KINDS, MOD_BEHAVIORS, canTargetEffects, resolveModTarget, visibleFields } from './modulators.js';
import { LOOP_MODES, hasTrigger } from './sequences.js';
import { ARP_DIVISIONS, ARP_NUMBERS, ARP_OCTAVE_MODES, ARP_ORDERS } from './arpeggiator.js';

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
  const mixLayers = usedMixLayers(project);
  // Tags that don't start with the defaults (enabled, volume 1, no voice limit).
  const tagLines = [
    // Articulations after the first start off; any can start at a lower volume.
    ...articulations
      .map((articulation, index) => {
        const volume = articulationVolume(project, articulation);
        const attributes = (index > 0 ? ' enabled="false"' : '') + (volume !== 1 ? ` volume="${volume}"` : '');
        return attributes ? `    <tag name="art${articulation}"${attributes}/>` : null;
      })
      .filter(Boolean),
    ...mixLayers
      .filter((mixLayer) => mixLayerVolume(project, mixLayer) !== 1)
      .map((mixLayer) => `    <tag name="mix${mixLayer}" volume="${mixLayerVolume(project, mixLayer)}"/>`),
  ];
  if (project.monophonic) {
    for (const tag of monoTags(project)) tagLines.push(`    <tag name="${tag}" polyphony="1"/>`);
  }
  for (const [name, limit] of Object.entries(project.voiceLimits).sort()) {
    if (exportedNames(project).includes(name)) tagLines.push(`    <tag name="${chokeTag(name)}" polyphony="${limit}"/>`);
  }
  if (tagLines.length > 0) lines.push('  <tags>', ...tagLines, '  </tags>');
  lines.push(`  <groups${groupsAttributes(project, usesRoundRobin)}>`);
  const groups = presetGroups(project);
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
        // The docs take volume in dB when "dB" is appended.
        if (s.volumeDb !== 0) line += ` volume="${s.volumeDb}dB"`;
        if (s.pan !== 0) line += ` pan="${s.pan}"`;
        if (s.tuning !== 0) line += ` tuning="${s.tuning}"`;
        // Legato conditions (docs: on <sample>; tested in the plugin).
        if (legatoTrigger(project, s) === 'legato') {
          if (s.previousNotes.length > 0) line += ` previousNotes="${s.previousNotes.join(',')}"`;
          if (s.legatoInterval !== null) line += ` legatoInterval="${s.legatoInterval}"`;
        }
        line += chokeAttributes(project, s);
        lines.push(line + '/>');
      });
    }
    // Per-note effects: the same chain in every group.
    if (project.noteEffects.length > 0) {
      lines.push('      <effects>');
      for (const effect of project.noteEffects) lines.push(`        ${effectElement(effect, project)}`);
      lines.push('      </effects>');
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

  if (project.modulators.length > 0) lines.push(...modulatorLines(project, groups.length));
  // One <midi> for keyswitches and sequence trigger keys.
  const midi = [
    ...(articulations.length > 0 ? keyswitchLines(project, articulations) : []),
    ...sequenceTriggerLines(project),
  ];
  if (midi.length > 0) lines.push('  <midi>', ...midi, '  </midi>');
  if (project.sequences.length > 0) lines.push(...sequenceLines(project));
  if (project.arpeggiator.included) lines.push(arpeggiatorLine(project.arpeggiator));

  lines.push('</DecentSampler>', '');
  return lines.join('\n');
}

// Every <group> in export order, each { name, attributes, zones, release,
// mixLayer }. Controls use the order to find a group by its number.
function presetGroups(project) {
  const releaseAttributes =
    ' trigger="release"' +
    (project.releaseDecay !== null ? ` releaseTriggerDecay="${project.releaseDecay}dB"` : '') +
    (project.releaseIgnoresEnvelope ? ' ampEnvEnabled="false"' : '');
  // Normal groups (every note, then "first" and "legato" triggers), then
  // release groups; within each, no articulation first, then articulations
  // in order, and within those, no mix layer first, then mix layers in order.
  const zones = getZones(project);
  const triggerOf = (sample) => (isRelease(project, sample) ? 'release' : legatoTrigger(project, sample) ?? 'attack');
  const groups = [];
  for (const trigger of ['attack', 'first', 'legato', 'release']) {
    const release = trigger === 'release';
    // docs: trigger="first" / "legato" on <group> (tested in the plugin).
    const legato = trigger === 'first' || trigger === 'legato';
    for (const articulation of [0, ...usedArticulations(project)]) {
      for (const mixLayer of [0, ...usedMixLayers(project)]) {
        const inSet = zones.filter(
          (zone) =>
            triggerOf(zone[0]) === trigger &&
            articulationOf(project, zone[0]) === articulation &&
            mixLayerOf(project, zone[0]) === mixLayer,
        );
        // e.g. names "v1 art2 mix1 release" or "v1 legato", tags "art2,mix1".
        const tags = [];
        if (articulation > 0) tags.push(`art${articulation}`);
        if (mixLayer > 0) tags.push(`mix${mixLayer}`);
        if (usesMonoTags(project) && !release) tags.push(monoTag(mixLayer));
        const suffix = tags.map((tag) => ` ${tag}`).join('') + (trigger === 'attack' ? '' : ` ${trigger}`);
        // Every group also gets the per-note effects tag, which their controls target.
        const groupTags = project.noteEffects.length > 0 ? [...tags, NOTE_EFFECTS_TAG] : tags;
        const attributes =
          (groupTags.length > 0 ? ` tags="${groupTags.join(',')}"` : '') +
          (release ? releaseAttributes : '') +
          (legato ? ` trigger="${trigger}"` : '') +
          (mixLayer > 0 ? mixLayerAttributes(project, mixLayer, release) : '');
        groups.push(...layerGroups(inSet, suffix, attributes).map((group) => ({ ...group, release, mixLayer })));
      }
    }
  }
  return groups;
}

// A mix layer's pan, tuning and own envelope, for its groups. Values at 0
// aren't written; the envelope isn't written on release groups.
function mixLayerAttributes(project, mixLayer, release) {
  const settings = mixLayerSettings(project, mixLayer);
  let attributes = '';
  if (settings.pan !== 0) attributes += ` groupPan="${settings.pan}"`;
  if (settings.tuning !== 0) attributes += ` groupTuning="${settings.tuning}"`;
  if (settings.ownEnvelope && !release) {
    attributes +=
      ` attack="${settings.attack}" decay="${settings.decay}"` +
      ` sustain="${settings.sustain}" release="${settings.release}"`;
  }
  return attributes;
}

// The voice-limit tag for a mix layer's normal groups (0 = no mix layer).
function monoTag(mixLayer) {
  return mixLayer > 0 ? `mono${mixLayer}` : 'mono';
}

// Whether normal groups carry mono tags: when monophonic, or when a
// Mono/Poly button can make them so.
function usesMonoTags(project) {
  return project.monophonic || project.ui.controls.some((c) => c.effectId === null && c.key === 'monophonic');
}

// The mono tags in use: one per mix layer (or none) that has normal samples.
function monoTags(project) {
  const zones = getZones(project).filter((zone) => !isRelease(project, zone[0]));
  const mixLayers = [...new Set(zones.map((zone) => mixLayerOf(project, zone[0])))].sort((a, b) => a - b);
  return mixLayers.map(monoTag);
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
  const names = exportedNames(project);
  const cutBy = (project.chokedBy[s.name] ?? []).filter((name) => names.includes(name));
  const limited = project.voiceLimits[s.name] !== undefined;
  const cuts = names.some((other) => (project.chokedBy[other] ?? []).includes(s.name));
  if (cutBy.length === 0 && !limited && !cuts) return '';
  let attributes = ` tags="${chokeTag(s.name)}"`;
  if (cutBy.length > 0) attributes += ` silencedByTags="${cutBy.map(chokeTag).join(',')}"`;
  // How it stops when cut off or over its voice limit ('fast' is the docs' default).
  if (cutBy.length > 0 || limited) {
    if (project.chokeMode === 'normal') attributes += ' silencingMode="normal"';
    if (project.chokeMode === 'decay') attributes += ` silencingDecay="${project.chokeDecay}"`;
  }
  return attributes;
}

// A name's choke tag: "choke-" and the name, with anything but letters,
// digits, - and _ replaced (tags are a comma-separated list).
export function chokeTag(name) {
  return `choke-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

// The sample names that are exported.
function exportedNames(project) {
  return [...new Set(project.samples.filter(isExportable).map((s) => s.name))].sort();
}

// The <midi> element: one <note> per keyswitch. swallowNotes stops the key
// from also playing a sample. Each enables its own articulation's tag and
// disables the others (docs: "The <note> element", TAG_ENABLED).
function keyswitchLines(project, articulations) {
  const hasMenu = project.ui.controls.some((c) => c.key === 'articulation');
  const lines = [];
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
  return lines;
}

// One <note> per sequence with trigger keys: pressing a key in the range
// plays the sequence transposed by its distance from the root key (docs:
// note sequences tutorial; tested in the plugin). The keys don't play samples.
function sequenceTriggerLines(project) {
  const lines = [];
  project.sequences.forEach((sequence, index) => {
    if (!hasTrigger(sequence)) return;
    const { triggerLow: low, triggerHigh: high } = sequence;
    lines.push(
      `    <note note="${low === high ? low : `${low}-${high}`}" swallowNotes="true">`,
      `      <binding level="instrument" type="note_sequence" seqIndex="${index}" seqLoopMode="${sequence.loopMode}"` +
        ` seqTriggerBehavior="midi_key" seqTransposeWithRootNote="${sequence.rootKey}"` +
        ` seqTrackMidiInputVelocity="1.0" seqPlaybackRate="1"` +
        (sequence.followTempo ? '' : ' seqFollowGlobalTempo="false"') +
        '/>',
      '    </note>',
    );
  });
  return lines;
}

// The <arpeggiator> element, every setting written out as in the docs'
// example. The fixed BPM only when it's used.
function arpeggiatorLine(arp) {
  return (
    `  <arpeggiator enabled="${arp.enabled}" arpOrder="${arp.order}" arpOctaveRange="${arp.octaveRange}"` +
    ` arpOctaveMode="${arp.octaveMode}" arpStepCount="${arp.stepCount}" arpGateLength="${arp.gateLength}"` +
    ` arpFollowGlobalTempo="${arp.followTempo}" arpSyncDivision="${arp.syncDivision}"` +
    ` arpRateMultiplier="${arp.rateMultiplier}"` +
    (arp.followTempo ? '' : ` arpOverrideBpm="${arp.overrideBpm}"`) +
    '/>'
  );
}

// The <noteSequences> element: one <sequence> per sequence, its length in
// steps and rate in steps per beat, then its notes in time order.
function sequenceLines(project) {
  const lines = ['  <noteSequences>'];
  for (const sequence of project.sequences) {
    lines.push(`    <sequence name="${escapeXml(sequence.name)}" length="${sequence.steps}" rate="${sequence.stepsPerBeat}">`);
    const notes = [...sequence.notes].sort((a, b) => a.step - b.step || b.note - a.note);
    for (const n of notes) {
      lines.push(`      <note position="${n.step}" velocity="${n.velocity}" note="${n.note}" length="${n.length}"/>`);
    }
    lines.push('    </sequence>');
  }
  lines.push('  </noteSequences>');
  return lines;
}

// The <modulators> element: one element per modulator (<lfo>, <envelope>…)
// with a binding per target. Each field is written in the order
// MODULATOR_KINDS lists it, except where it says to leave it out (e.g. the
// docs' default); enabled only when off.
// `groupCount` is the number of <group>s: a per-note effect target gets one
// binding per group, since every group has its own copy of the chain.
function modulatorLines(project, groupCount) {
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
      const { bindingTarget, noteEffectIndex, parameter } = resolved;
      const bindingTargets =
        noteEffectIndex === null || noteEffectIndex === undefined
          ? [bindingTarget]
          : Array.from({ length: groupCount }, (_, group) => `type="effect" level="group" groupIndex="${group}" effectIndex="${noteEffectIndex}"`);
      for (const where of bindingTargets) {
        lines.push(
          `      <binding ${where} parameter="${parameter}" modBehavior="${target.behavior}"` +
            ` translation="linear" translationOutputMin="${target.min}" translationOutputMax="${target.max}"/>`,
        );
      }
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
// only written when off; `tags` (its id) only when a control targets an
// instrument effect (per-note effects are found by group tag and index).
function effectElement(effect, project) {
  let element = `<effect type="${effect.type}"`;
  for (const param of visibleParams(effect)) {
    element += ` ${param.key}="${escapeXml(String(effect[param.key]))}"`;
  }
  if (!effect.enabled) element += ' enabled="false"';
  if (project.effects.includes(effect) && project.ui.controls.some((c) => c.effectId === effect.id)) {
    element += ` tags="${effect.id}"`;
  }
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
      // The Mono/Poly button works the same way, setting every mono tag's
      // TAG_POLYPHONY to 1 or -1 (no limit; docs: tag polyphony default).
      const { control, x, y, width, height } = panel.button;
      const target = resolveTarget(project, control);
      const isMono = control.key === 'monophonic';
      const state = (name, on) => {
        const bindings = isMono
          ? monoTags(project).map(
              (tag) =>
                `<binding type="general" level="tag" identifier="${tag}" parameter="TAG_POLYPHONY"` +
                ` translation="fixed_value" translationValue="${on ? 1 : -1}"/>`,
            )
          : [`<binding ${target.bindingTarget} parameter="${target.parameter}" translation="fixed_value" translationValue="${on}"/>`];
        return `        <state name="${name}">${bindings.join('')}</state>`;
      };
      if (control.key === 'play') {
        lines.push(...playButtonLines(project, target, { x, y, width, height }));
      } else {
        lines.push(
          `      <button x="${x}" y="${y}" width="${width}" height="${height}" style="text" value="${target.value ? 0 : 1}">`,
          state(isMono ? 'Mono' : 'On', true),
          state(isMono ? 'Poly' : 'Off', false),
          '      </button>',
        );
      }
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
        ...knobBindingTargets(project, target).map(
          (where) => `        <binding ${where} parameter="${target.parameter}" ${translation}/>`,
        ),
        '      </labeled-knob>',
      );
    }
  }
  lines.push('    </tab>', '  </ui>');
  return lines;
}

// Where a knob's binding goes. A mix layer's envelope knob gets one binding
// per key-down group of that layer, by number (docs: groupIndex; tested in
// the plugin), since its tag would also reach the layer's release groups.
function knobBindingTargets(project, target) {
  if (target.layerEnvelope === null || target.layerEnvelope === undefined) return [target.bindingTarget];
  return layerGroupIndexes(project, target.layerEnvelope).map((index) => `type="amp" level="group" groupIndex="${index}"`);
}

// The numbers (from 0) of a mix layer's key-down groups.
function layerGroupIndexes(project, mixLayer) {
  return presetGroups(project)
    .map((group, index) => (group.mixLayer === mixLayer && !group.release ? index : null))
    .filter((index) => index !== null);
}

// The articulation menu: one option per articulation, each enabling its own
// tag and disabling the others (docs: <menu>, <option>, and the sound
// selector example). It starts on the first, which is on when the preset
// loads. Keyswitches find it by its tag to keep it in step.
function menuLines(project, { control, x, y, width, height }) {
  if (control.key === 'glideMode' || control.key === 'arpOrder') return valueMenuLines(project, { control, x, y, width, height });
  if (control.key === 'sequenceMenu') return sequenceMenuLines(project, { control, x, y, width, height });
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

// Sequences played from the window (docs: note sequences tutorial,
// "Triggering note sequences using the UI"; tested in the plugin). "on"
// starts a sequence and "off" stops it; the player identifier ties the two
// together. Each Play button has its own player (the sequence's id), so
// buttons play together and stop separately; the Play menu has one player,
// so choosing an option stops what it was playing first.
const SEQUENCE_MENU_PLAYER = 'sequence-menu';
function sequenceOnBinding(sequence, index, player) {
  return (
    `<binding level="instrument" type="note_sequence" seqIndex="${index}" seqLoopMode="${sequence.loopMode}"` +
    ' seqTriggerBehavior="on" seqTrackMidiInputVelocity="1.0" seqPlaybackRate="1"' +
    (sequence.followTempo ? '' : ' seqFollowGlobalTempo="false"') +
    ` seqPlayerIdentifier="${player}"/>`
  );
}
function sequenceOffBinding(index, player) {
  return `<binding level="instrument" type="note_sequence" seqIndex="${index}" seqTriggerBehavior="off" seqPlayerIdentifier="${player}"/>`;
}

// A Play button: Off (where it starts) and On.
function playButtonLines(project, target, { x, y, width, height }) {
  const index = target.sequenceIndex;
  const sequence = project.sequences[index];
  return [
    `      <button x="${x}" y="${y}" width="${width}" height="${height}" style="text" value="0">`,
    `        <state name="Off">${sequenceOffBinding(index, sequence.id)}</state>`,
    `        <state name="On">${sequenceOnBinding(sequence, index, sequence.id)}</state>`,
    '      </button>',
  ];
}

// The Play menu: Off, then one option per sequence. Every option first stops
// whatever the menu is playing, then (except Off) starts its own sequence.
function sequenceMenuLines(project, { x, y, width, height }) {
  const stopAll = project.sequences.map((_, index) => `          ${sequenceOffBinding(index, SEQUENCE_MENU_PLAYER)}`);
  const lines = [
    `      <menu x="${x}" y="${y}" width="${width}" height="${height}" value="1"` +
      ' textColor="FFFFFFFF" backgroundColor="FF222222">',
    '        <option name="Off">',
    ...stopAll,
    '        </option>',
  ];
  project.sequences.forEach((sequence, index) => {
    lines.push(
      `        <option name="${escapeXml(ownerTitle(project, sequence))}">`,
      ...stopAll,
      `          ${sequenceOnBinding(sequence, index, SEQUENCE_MENU_PLAYER)}`,
      '        </option>',
    );
  });
  lines.push('      </menu>');
  return lines;
}

// A menu of a setting's values: the glide mode (GLIDE_MODE, by name; tested
// in the plugin, numbers don't work) or the arpeggiator order (ARP_ORDER, by
// name; tested). Each option sets the value; it starts on the current one.
function valueMenuLines(project, { control, x, y, width, height }) {
  const { options, value, bindingTarget, parameter } = resolveTarget(project, control);
  const lines = [
    `      <menu x="${x}" y="${y}" width="${width}" height="${height}" value="${options.findIndex((o) => o.value === value) + 1}"` +
      ' textColor="FFFFFFFF" backgroundColor="FF222222">',
  ];
  for (const option of options) {
    lines.push(
      `        <option name="${option.name}">`,
      `          <binding ${bindingTarget} parameter="${parameter}"` +
        ` translation="fixed_value" translationValue="${option.value}"/>`,
      '        </option>',
    );
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
  if (project.glideTime !== 0) attributes += ` glideTime="${project.glideTime}"`;
  // 'legato' is the docs' default, so only 'always' is written.
  if (project.glideMode !== 'legato') attributes += ` glideMode="${project.glideMode}"`;
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
  if (!Number.isFinite(project.glideTime) || project.glideTime < 0) problems.push('Glide time must be a number of seconds, 0 or more');
  if (!['legato', 'always'].includes(project.glideMode)) problems.push(`Unknown glide mode "${project.glideMode}"`);
  const decay = project.releaseDecay;
  if (decay !== null && (!Number.isFinite(decay) || decay < 0)) {
    problems.push('Release decay must be a number of dB per second, 0 or more (or blank)');
  }
  if (!['fast', 'normal', 'decay'].includes(project.chokeMode)) problems.push(`Unknown choke mode "${project.chokeMode}"`);
  if (project.chokeMode === 'decay' && (!Number.isFinite(project.chokeDecay) || project.chokeDecay <= 0)) {
    problems.push('Choke fade must be a number of seconds, above 0');
  }
  problems.push(...checkKeyswitches(project));
  problems.push(...checkMixLayerVolumes(project));
  problems.push(...checkMixLayerSettings(project));
  problems.push(...checkArticulationVolumes(project));
  problems.push(...checkVoiceLimits(project));
  problems.push(...checkSequences(project));
  problems.push(...checkArpeggiator(project));
  problems.push(...checkModulators(project));
  if (project.envelope.enabled) problems.push(...checkEnvelope(project.envelope));
  project.effects.forEach((effect, index) => {
    for (const problem of checkEffect(effect, project)) problems.push(`Effect ${index + 1} (${effect.kind}): ${problem}`);
  });
  project.noteEffects.forEach((effect, index) => {
    for (const problem of checkEffect(effect, project)) problems.push(`Per-note effect ${index + 1} (${effect.kind}): ${problem}`);
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
    for (const problem of checkLevels(s)) problems.push(`${s.path}: ${problem}`);
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

// Level and tuning rules. The docs give no limits for volume or tuning;
// ±48 semitones matches the Global tuning check.
function checkLevels(s) {
  const problems = [];
  // Legato conditions (only exported on "legato only" samples, but checked
  // whenever set). The docs give previous notes as MIDI numbers 1–127.
  if (!s.previousNotes.every((n) => Number.isInteger(n) && n >= 1 && n <= 127)) {
    problems.push('previous notes must be notes from C#-2 to G8 (MIDI 1–127)');
  }
  if (s.legatoInterval !== null && !(Number.isInteger(s.legatoInterval) && Math.abs(s.legatoInterval) <= 127)) {
    problems.push('legato interval must be a whole number of semitones from -127 to 127 (or blank)');
  }
  if (!Number.isFinite(s.volumeDb)) problems.push('volume must be a number of dB');
  if (!Number.isFinite(s.pan) || Math.abs(s.pan) > 100) problems.push('pan must be a number from -100 to 100');
  if (!Number.isFinite(s.tuning) || Math.abs(s.tuning) > 48) problems.push('tuning must be a number of semitones from -48 to 48');
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
      if (target.effectId !== null && resolved.noteEffectIndex === null && !canTargetEffects(modulator)) {
        // LFO, MIDI CC and random can when shared; envelopes and velocity never can.
        const fix = canTargetEffects({ ...modulator, scope: 'global' })
          ? `one-per-note modulators can't move instrument-wide effects; set it to "Shared by all notes", or target volume, tuning, pan or a per-note effect`
          : `${definition.label.toLowerCase()} modulators can't move instrument-wide effects; target volume, tuning, pan or a per-note effect`;
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
// Arpeggiator settings: known words, and numbers inside the docs' ranges
// (whole numbers for octave range and steps).
function checkArpeggiator(project) {
  const arp = project.arpeggiator;
  if (!arp.included) return [];
  const problems = [];
  const known = (list, value) => list.some(([v]) => v === value);
  if (!known(ARP_ORDERS, arp.order)) problems.push(`Arpeggiator: unknown order "${arp.order}"`);
  if (!known(ARP_OCTAVE_MODES, arp.octaveMode)) problems.push(`Arpeggiator: unknown octave mode "${arp.octaveMode}"`);
  if (!known(ARP_DIVISIONS, arp.syncDivision)) problems.push(`Arpeggiator: unknown step size "${arp.syncDivision}"`);
  for (const { key, label, min, max, integer } of ARP_NUMBERS) {
    const value = arp[key];
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      const range = max === Infinity ? `${min} or more` : `from ${min} to ${max}`;
      problems.push(`Arpeggiator: ${label.toLowerCase()} must be ${integer ? 'a whole number ' : ''}${range}`);
    }
  }
  return problems;
}

// Sequence rules: a whole number of steps (1–128) and a step size; notes
// inside the sequence with velocity 0–1; trigger keys all set (or all blank),
// 0–127, lowest first.
function checkSequences(project) {
  const problems = [];
  const isNote = (n) => Number.isInteger(n) && n >= 0 && n <= 127;
  for (const sequence of project.sequences) {
    const name = `Sequence "${sequence.name}"`;
    if (!Number.isInteger(sequence.steps) || sequence.steps < 1 || sequence.steps > 128) {
      problems.push(`${name}: steps must be a whole number from 1 to 128`);
    }
    if (!Number.isFinite(sequence.stepsPerBeat) || sequence.stepsPerBeat <= 0) problems.push(`${name}: unknown step size`);
    if (!LOOP_MODES.some(([mode]) => mode === sequence.loopMode)) problems.push(`${name}: unknown loop mode "${sequence.loopMode}"`);
    for (const n of sequence.notes) {
      const ok =
        isNote(n.note) &&
        Number.isInteger(n.step) && n.step >= 0 &&
        Number.isInteger(n.length) && n.length >= 1 && n.step + n.length <= sequence.steps &&
        Number.isFinite(n.velocity) && n.velocity >= 0 && n.velocity <= 1;
      if (!ok) problems.push(`${name}: a note at step ${n.step + 1} is outside the sequence or has a bad length or velocity`);
    }
    if (hasTrigger(sequence)) {
      const { triggerLow: low, triggerHigh: high, rootKey: root } = sequence;
      if (![low, high, root].every(isNote)) {
        problems.push(`${name}: trigger keys and root key must all be MIDI notes from 0 to 127 (or all blank)`);
      } else if (low > high) {
        problems.push(`${name}: the lowest trigger key must not be above the highest`);
      }
    }
  }
  return problems;
}

// Voice limits are whole numbers, 1 or more. Two names can't share a choke tag
// (e.g. "Hat 1" and "Hat_1" both become choke-Hat_1).
function checkVoiceLimits(project) {
  const problems = [];
  for (const [name, limit] of Object.entries(project.voiceLimits)) {
    if (!Number.isInteger(limit) || limit < 1) problems.push(`${name}: voice limit must be a whole number, 1 or more (or blank)`);
  }
  const byTag = new Map();
  for (const name of exportedNames(project)) {
    const tag = chokeTag(name);
    if (byTag.has(tag)) problems.push(`Names "${byTag.get(tag)}" and "${name}" can't be told apart for choking: rename one`);
    byTag.set(tag, name);
  }
  return problems;
}

function checkMixLayerVolumes(project) {
  return usedMixLayers(project)
    .filter((mixLayer) => {
      const volume = mixLayerVolume(project, mixLayer);
      return !Number.isFinite(volume) || volume < 0 || volume > 1;
    })
    .map((mixLayer) => `Mix layer ${mixLayer} volume must be a number from 0 to 1`);
}

// Pan −100–100; tuning ±48 semitones (a sanity limit, as for Global tuning);
// the envelope as for the instrument's.
function checkMixLayerSettings(project) {
  const problems = [];
  for (const mixLayer of usedMixLayers(project)) {
    const { pan, tuning, ownEnvelope, ...envelope } = mixLayerSettings(project, mixLayer);
    if (!Number.isFinite(pan) || Math.abs(pan) > 100) problems.push(`Mix layer ${mixLayer} pan must be a number from -100 to 100`);
    if (!Number.isFinite(tuning) || Math.abs(tuning) > 48) {
      problems.push(`Mix layer ${mixLayer} tuning must be a number of semitones from -48 to 48`);
    }
    if (ownEnvelope) {
      const curves = { ...CURVE_DEFAULTS }; // not set per layer, so always fine
      for (const problem of checkEnvelope({ ...envelope, ...curves })) problems.push(`Mix layer ${mixLayer} ${problem.replace('Envelope: ', 'envelope: ')}`);
    }
  }
  return problems;
}

function checkArticulationVolumes(project) {
  return usedArticulations(project)
    .filter((articulation) => {
      const volume = articulationVolume(project, articulation);
      return !Number.isFinite(volume) || volume < 0 || volume > 1;
    })
    .map((articulation) => `Articulation ${articulation} volume must be a number from 0 to 1`);
}

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
  if (!effectTypes(project, effect).includes(effect.type)) problems.push(`unknown type "${effect.type}"`);
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
    const name = `Control "${target.sectionTitle} › ${control.kind === 'knob' ? control.label : target.label}"`;
    if (target.needsValue && target.value === null) {
      problems.push(`${name}: set ${target.needsValue} in the Global section to use this control`);
    }
    if (target.needsEnvelope && !project.envelope.enabled) {
      problems.push(`${name}: tick "Set an envelope" to use envelope controls`);
    }
    if (!target.applies) problems.push(`${name}: ${target.label} doesn't apply to this effect's current type`);
    const layer = target.layerEnvelope;
    if (layer !== null && layer !== undefined) {
      if (!mixLayerSettings(project, layer).ownEnvelope) {
        problems.push(`${name}: tick "Own envelope" for mix layer ${layer} to use its envelope controls`);
      } else if (layerGroupIndexes(project, layer).length === 0) {
        problems.push(`${name}: mix layer ${layer} has only release samples, which don't use its envelope`);
      }
    }
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
