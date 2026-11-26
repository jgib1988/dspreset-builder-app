// The Legato section: for each sample name, whether it plays on every note
// (the default), only when no other note is held (docs: trigger="first") or
// only when another note is already held (docs: trigger="legato", e.g. a
// transition or slur sample). "Legato only" names get their own mapping,
// since they share keys with the normal samples. Release samples aren't listed:
// they already have their own trigger. Tested in the plugin (LegatoTest A–D).

import { midiToNoteName, parseNote } from './filename.js';
import { isExportable, isRelease, remapName } from './mapping.js';

const TRIGGERS = [
  ['', 'every note'],
  ['first', 'first note only'],
  ['legato', 'legato only'],
];

// `onMappingChange` is called after a name's trigger changes (a name moving to
// or from "legato only" moves its zones, so the grid needs redrawing).
export function renderLegatoEditor(container, project, onMappingChange) {
  const names = [
    ...new Set(project.samples.filter((s) => isExportable(s) && !isRelease(project, s)).map((s) => s.name)),
  ].sort();

  const list = document.createElement('p');
  for (const name of names) {
    const label = document.createElement('label');
    label.className = 'inline-option';
    const select = document.createElement('select');
    for (const [value, text] of TRIGGERS) select.append(new Option(text, value));
    select.value = project.legatoTriggers[name] ?? '';
    select.addEventListener('change', () => {
      if (select.value === '') delete project.legatoTriggers[name];
      else project.legatoTriggers[name] = select.value;
      // Its samples are now mapped with the other kind (normal or legato).
      remapName(project, name);
      onMappingChange();
    });
    label.append(`${name} `, select);
    list.append(label);
  }
  container.replaceChildren(list);
}

// The Legato box under the grid for the selected "legato only" zones (one or
// several): which previous notes, or which interval, the transition plays
// from. Set on every sample of those zones (all round-robins). Blank means
// any. Tested in the plugin (LegatoTest F–J). `onChange` redraws the grid
// and the export.
export function renderLegatoZoneEditor(box, zones, onChange) {
  const samples = zones.flat();
  const several = zones.length > 1;

  // From notes: names or numbers, e.g. "D3, E3" or "62". Read when you press
  // Return or click away; an unrecognised note is named and nothing changes.
  const noteText = (s) => s.previousNotes.map((n) => midiToNoteName(n)).join(', ');
  const notes = document.createElement('input');
  notes.type = 'text';
  notes.className = 'frame-input';
  const noteValues = new Set(samples.map(noteText));
  if (noteValues.size > 1) notes.placeholder = 'mixed';
  else {
    notes.value = [...noteValues][0];
    notes.placeholder = 'any';
  }
  const noteError = document.createElement('span');
  noteError.className = 'problem-text';
  notes.addEventListener('change', () => {
    const parts = notes.value.split(',').map((t) => t.trim()).filter((t) => t !== '');
    // "mixed" boxes change nothing until something is typed.
    if (parts.length === 0 && noteValues.size > 1) return;
    let midi;
    try {
      midi = [...new Set(parts.map(parseNote))].sort((a, b) => a - b);
    } catch (error) {
      noteError.textContent = ` ${error.message}`;
      return;
    }
    noteError.textContent = '';
    for (const sample of samples) sample.previousNotes = midi;
    notes.value = midi.map((n) => midiToNoteName(n)).join(', ');
    onChange();
  });

  // Interval: the new note minus the previous one, in semitones.
  const interval = document.createElement('input');
  interval.type = 'number';
  interval.step = 1;
  interval.className = 'envelope-input';
  const intervalValues = new Set(samples.map((s) => s.legatoInterval));
  if (intervalValues.size > 1) interval.placeholder = 'mixed';
  else {
    interval.value = [...intervalValues][0] ?? '';
    interval.placeholder = 'any';
  }
  // Read on Return or click away ("change"), since a change redraws the grid
  // (overlap outlines depend on it), which would interrupt typing.
  interval.addEventListener('change', () => {
    if (interval.value === '' && intervalValues.size > 1) return;
    const value = interval.value === '' ? null : Number(interval.value);
    for (const sample of samples) sample.legatoInterval = value;
    onChange();
  });

  const heading = document.createElement('h3');
  heading.textContent = 'Legato';
  const row = document.createElement('p');
  const notesLabel = document.createElement('label');
  notesLabel.className = 'effect-field';
  notesLabel.append('From notes ', notes, noteError);
  const intervalLabel = document.createElement('label');
  intervalLabel.className = 'effect-field';
  intervalLabel.append('Interval (semitones) ', interval);
  row.append(notesLabel, intervalLabel);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    `${several ? 'These transitions play' : 'This transition plays'} only when the key held before is one of the From notes ` +
    '(e.g. D3, E3 or 62), and only when the new key is this many semitones from it (2 = a step up, -2 = a step down). ' +
    'Blank means any. "mixed" means the selected zones differ; that box changes nothing until you type in it.';
  box.replaceChildren(heading, row, hint);
}
