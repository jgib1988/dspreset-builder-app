// Warnings about the mapping: things that are usually mistakes but can be
// deliberate, so they don't block the export (errors are in export.js,
// checkPreset). Zones with invalid ranges are skipped here; checkPreset
// already reports them.

import { getZones, isExportable, legatoTrigger, mappingSet, mixLayerSettings, sampleKind, usedArticulations, usedMixLayers, zoneKey } from './mapping.js';
import { midiToNoteName } from './filename.js';
import { layoutControls } from './ui.js';

// Returns { messages, overlapping }, where `overlapping` is the set of zone
// keys that overlap another zone (the grid outlines them).
export function findWarnings(project) {
  const zones = getZones(project).filter((zone) => hasValidRanges(zone[0]));
  // Release and legato samples, other articulations and mix layers are meant to
  // share keys, so overlaps are only looked for within each mapping set, and
  // gaps only within each set of normal samples (transitions may cover only
  // some keys).
  const sets = new Map();
  for (const zone of zones) {
    const key = mappingSet(project, zone[0]);
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(zone);
  }
  const overlapping = new Set();
  const messages = [
    ...[...sets.values()].flatMap((set) => findOverlaps(set, overlapping, sampleKind(project, set[0][0]) === 'legato')),
    ...[...sets.values()].filter((set) => sampleKind(project, set[0][0]) === 'normal').flatMap(findGaps),
    ...findKeyswitchesOnZones(project, zones),
    ...project.modulators.filter((m) => m.targets.length === 0).map((m) => `Modulator ${m.id} has no targets, so it does nothing`),
    ...findDuplicateRoundRobins(project),
    ...findRootsOutside(zones),
    ...findMixedFormats(project),
    ...findSequenceWarnings(project, zones),
    ...findOwnEnvelopeWarnings(project),
    ...findLegatoWarnings(project),
    ...findReturnWarnings(project),
    ...findSmoothLegatoWarnings(project),
    ...findKeyboardWarnings(project),
    ...(project.arpeggiator.included && project.sequences.length > 0
      ? ['While the arpeggiator is on, sequence notes go through it and are arpeggiated, not played as written']
      : []),
  ];
  return { messages, overlapping };
}

// Two zones overlap when both their key and velocity ranges overlap: both
// play at once. Legato transitions (`legato`) only overlap if they can also
// play from the same previous note (their From notes and intervals allow it).
function findOverlaps(zones, overlapping, legato = false) {
  const messages = [];
  zones.forEach((zoneA, i) => {
    const a = zoneA[0];
    for (const zoneB of zones.slice(i + 1)) {
      const b = zoneB[0];
      const lo = Math.max(a.loNote, b.loNote);
      const hi = Math.min(a.hiNote, b.hiNote);
      const loVel = Math.max(a.loVel, b.loVel);
      const hiVel = Math.min(a.hiVel, b.hiVel);
      if (lo > hi || loVel > hiVel) continue;
      if (legato && !canPlayTogether(a, b, lo, hi)) continue;
      overlapping.add(zoneKey(a)).add(zoneKey(b));
      messages.push(
        `${zoneName(a)} and ${zoneName(b)} overlap on ${keys(lo, hi)}, ${velocities(loVel, hiVel)}`,
      );
    }
  });
  return messages;
}

// Keys and velocities with no sample, between the lowest and highest mapped
// keys (keys outside that span are taken to be silent on purpose). Runs of
// neighbouring keys with the same missing velocities are reported together.
function findGaps(zones) {
  if (zones.length === 0) return [];
  const lowest = Math.min(...zones.map((zone) => zone[0].loNote));
  const highest = Math.max(...zones.map((zone) => zone[0].hiNote));

  // For each key, the velocity ranges (1–127) that nothing covers, as text.
  const missingAt = (note) => {
    const covered = new Array(128).fill(false);
    for (const [s] of zones) {
      if (s.loNote > note || s.hiNote < note) continue;
      for (let v = Math.max(s.loVel, 1); v <= s.hiVel; v++) covered[v] = true;
    }
    const ranges = [];
    for (let v = 1; v <= 127; v++) {
      if (covered[v]) continue;
      const start = v;
      while (v < 127 && !covered[v + 1]) v++;
      ranges.push([start, v]);
    }
    if (ranges.length === 0) return null;
    if (ranges.length === 1 && ranges[0][0] === 1 && ranges[0][1] === 127) return 'no sample at any velocity';
    return `nothing at velocity ${ranges.map(([lo, hi]) => (lo === hi ? lo : `${lo}–${hi}`)).join(', ')}`;
  };

  const messages = [];
  let runStart = lowest;
  let runText = missingAt(lowest);
  for (let note = lowest + 1; note <= highest + 1; note++) {
    const text = note <= highest ? missingAt(note) : undefined;
    if (text === runText) continue;
    if (runText) messages.push(`Gap: ${capitalise(keys(runStart, note - 1))}: ${runText}`);
    runStart = note;
    runText = text;
  }
  return messages;
}

// A keyswitch key switches articulations instead of playing its sample
// (swallowNotes), so a zone covering it has a key that never sounds.
function findKeyswitchesOnZones(project, zones) {
  const messages = [];
  for (const articulation of usedArticulations(project)) {
    const ks = project.keyswitches[articulation];
    if (!Number.isInteger(ks)) continue;
    const covering = zones.filter(([s]) => s.loNote <= ks && ks <= s.hiNote);
    if (covering.length > 0) {
      messages.push(
        `Keyswitch ${note(ks)} for articulation ${articulation} is inside ${covering.map(([s]) => zoneName(s)).join(', ')}: that key will switch articulation instead of playing`,
      );
    }
  }
  return messages;
}

// Sequence trigger keys are swallowed (they start the sequence instead of
// playing), so they shouldn't cover samples, keyswitches or another
// sequence's keys. Also: empty sequences, and notes no sample plays.
function findSequenceWarnings(project, zones) {
  const messages = [];
  const isNote = (n) => Number.isInteger(n) && n >= 0 && n <= 127;
  const triggers = project.sequences.filter(
    (s) => isNote(s.triggerLow) && isNote(s.triggerHigh) && s.triggerLow <= s.triggerHigh,
  );
  const mapped = (n) => zones.some(([s]) => s.loNote <= n && n <= s.hiNote);
  for (const sequence of project.sequences) {
    const name = `Sequence "${sequence.name}"`;
    if (sequence.notes.length === 0) messages.push(`${name} has no notes`);
    const unmapped = [...new Set(sequence.notes.map((n) => n.note))].filter((n) => !mapped(n));
    if (unmapped.length > 0) {
      messages.push(`${name} has notes no sample plays: ${unmapped.sort((a, b) => a - b).map(note).join(', ')} (transposed by the trigger key, they may still land on samples)`);
    }
  }
  triggers.forEach((sequence, i) => {
    const { triggerLow: lo, triggerHigh: hi } = sequence;
    const name = `Sequence "${sequence.name}" trigger ${keys(lo, hi)}`;
    const covering = zones.filter(([s]) => s.loNote <= hi && lo <= s.hiNote);
    if (covering.length > 0) {
      messages.push(`${name} overlap ${covering.map(([s]) => zoneName(s)).join(', ')}: those keys will start the sequence instead of playing`);
    }
    for (const articulation of usedArticulations(project)) {
      const ks = project.keyswitches[articulation];
      if (Number.isInteger(ks) && lo <= ks && ks <= hi) messages.push(`${name} include the keyswitch for articulation ${articulation}`);
    }
    for (const other of triggers.slice(i + 1)) {
      if (other.triggerLow <= hi && lo <= other.triggerHigh) messages.push(`${name} overlap Sequence "${other.name}"'s trigger keys`);
    }
  });
  return messages;
}

// Two files for the same zone and round-robin number, e.g. Piano_C3_v1_rr1
// and Piano_60_v1_rr1 (the same note written two ways). Both would play.
function findDuplicateRoundRobins(project) {
  const byPosition = new Map();
  for (const s of project.samples.filter(isExportable)) {
    const key = `${zoneKey(s)}|${s.roundRobin}`;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(s);
  }
  return [...byPosition.values()]
    .filter((samples) => samples.length > 1)
    .map((samples) => `${zoneName(samples[0])}: rr${samples[0].roundRobin} is used by ${samples.length} files (${samples.map((s) => s.path).join(', ')})`);
}

// Every key in the zone would be pitched relative to a root it doesn't contain.
function findRootsOutside(zones) {
  return zones
    .map(([s]) => s)
    .filter((s) => s.rootNote < s.loNote || s.rootNote > s.hiNote)
    .map((s) => `${zoneName(s)}: root note ${note(s.rootNote)} is outside its ${keys(s.loNote, s.hiNote)}`);
}

// Usually a sign that some files were exported with different settings.
function findMixedFormats(project) {
  const samples = project.samples.filter((s) => isExportable(s) && s.sampleRate !== null);
  const describe = (field, label, unit) => {
    const groups = new Map();
    for (const s of samples) {
      if (!groups.has(s[field])) groups.set(s[field], []);
      groups.get(s[field]).push(s);
    }
    if (groups.size < 2) return [];
    // Largest group first; give an example file for each.
    const parts = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([value, group]) => `${group.length} ${unit(value)} (e.g. ${group[0].path})`);
    return [`Mixed ${label}: ${parts.join(', ')}`];
  };
  return [
    ...describe('sampleRate', 'sample rates', (rate) => `at ${rate} Hz`),
    ...describe('channels', 'channel counts', (count) => (count === 1 ? 'mono' : count === 2 ? 'stereo' : `${count} channels`)),
  ];
}

function hasValidRanges(s) {
  const ok = (lo, hi) => Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && lo <= hi && hi <= 127;
  return ok(s.loNote, s.hiNote) && ok(s.loVel, s.hiVel);
}

function zoneName(s) {
  return `${s.name} ${midiToNoteName(s.fileNote)} v${s.velocityLayer}`;
}

function note(n) {
  return `${midiToNoteName(n)} (${n})`;
}

// e.g. "keys C3–D3 (60–62)" or "key C3 (60)".
function keys(lo, hi) {
  return lo === hi ? `key ${note(lo)}` : `keys ${midiToNoteName(lo)}–${midiToNoteName(hi)} (${lo}–${hi})`;
}

function velocities(lo, hi) {
  return lo === hi ? `velocity ${lo}` : `velocity ${lo}–${hi}`;
}

function capitalise(text) {
  return text[0].toUpperCase() + text.slice(1);
}

// A mix layer with its own envelope ignores the instrument's envelope knobs
// (tested in the plugin: the Attack knob changed only the other layer).
// Return to held note only works when notes cut each other off: Monophonic
// (or a Mono/Poly button), or choke tags (docs; tested in the plugin).
function findReturnWarnings(project) {
  if (!project.returnToHeldNote || cutsNotesOff(project)) return [];
  return ['Return to held note does nothing here: tick Monophonic (Sound tab) or set up Choking so notes cut each other off'];
}

// Panels reaching under the plugin's keyboard can be hidden at its smallest
// window size (docs: "Leaving room for the keyboard"). Larger windows show
// them, so this doesn't block the export.
function findKeyboardWarnings(project) {
  if (project.ui.controls.length === 0) return [];
  return layoutControls(project).underKeyboard.map(
    (panel) => `Panel "${panel.title}" reaches under the plugin's keyboard, so it is hidden when the window is small: drag it up, make the window wider, or remove some controls`,
  );
}

// Smooth legato (glideRetrigger) also needs a glide (docs; tested in the plugin).
function findSmoothLegatoWarnings(project) {
  if (!project.smoothLegato) return [];
  if (!cutsNotesOff(project)) {
    return ['Smooth legato does nothing here: tick Monophonic (Sound tab) or set up Choking so notes cut each other off'];
  }
  if (!(project.glideTime > 0)) return ['Smooth legato does nothing without a glide: set a Glide time (Sound tab)'];
  return [];
}

// Whether notes cut each other off: Monophonic, a Mono/Poly button, or choke tags.
function cutsNotesOff(project) {
  if (project.monophonic) return true;
  if (project.ui.controls.some((c) => c.effectId === null && c.key === 'monophonic')) return true;
  return Object.values(project.chokedBy ?? {}).some((names) => names.length > 0);
}

// Whether two legato transitions can both play on some key from lo to hi:
// on that key, some previous note is allowed by both. A sample allows the
// notes in its From notes (any if empty), narrowed by its interval to the one
// note `interval` below the key.
function canPlayTogether(a, b, lo, hi) {
  const allowed = (s, key) => {
    let notes = s.previousNotes.length > 0 ? s.previousNotes : null; // null = any
    if (Number.isInteger(s.legatoInterval)) {
      const from = key - s.legatoInterval;
      notes = notes === null || notes.includes(from) ? [from] : [];
    }
    return notes;
  };
  for (let key = lo; key <= hi; key++) {
    const fromA = allowed(a, key);
    const fromB = allowed(b, key);
    if (fromA === null || fromB === null) {
      if ((fromA ?? fromB ?? [0]).length > 0) return true;
    } else if (fromA.some((n) => fromB.includes(n))) {
      return true;
    }
  }
  return false;
}

// Legato-only samples with nothing set to "First note only": the normal
// samples then play on legato notes too, under the transition. That can be
// deliberate (a tail, as in the docs' example), so it's only a warning.
function findLegatoWarnings(project) {
  const triggers = new Set(project.samples.filter(isExportable).map((s) => legatoTrigger(project, s)));
  if (!triggers.has('legato') || triggers.has('first')) return [];
  return ['There are "Legato only" samples but none set to "First note only", so the normal samples also play on legato notes, under the transition'];
}

const ENVELOPE_KEYS = ['attack', 'decay', 'sustain', 'release'];
function findOwnEnvelopeWarnings(project) {
  const hasKnobs = project.ui.controls.some((c) => c.effectId === null && ENVELOPE_KEYS.includes(c.key));
  if (!hasKnobs) return [];
  return usedMixLayers(project)
    .filter((mixLayer) => mixLayerSettings(project, mixLayer).ownEnvelope)
    .map((mixLayer) => `Mix layer ${mixLayer} has its own envelope, so the Amp envelope knobs don't change it`);
}
