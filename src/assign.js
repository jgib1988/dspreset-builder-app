// The Name / Note / Vel layer / RR cells of the file table. A file whose name
// doesn't match Name_Note_vN_rrN can be given those four values by hand
// (Assign); it then behaves exactly like a parsed file. Hand-set values are
// marked, and Clear makes the file unparsed again.

import { parseFilename, parseNote, midiToNoteName } from './filename.js';
import { placeSamples } from './mapping.js';

// Appends the four cells (or one cell spanning them) to `row`. `onChange` is
// called after a file is assigned or cleared, so everything is redrawn.
export function appendParseCells(row, sample, project, onChange) {
  if (sample.parseError === null) {
    const name = cell(row);
    name.textContent = sample.name;
    if (sample.manual) {
      const mark = document.createElement('span');
      mark.className = 'muted';
      mark.textContent = ' (set by hand) ';
      name.append(mark, button('Clear', 'Make this file unparsed again', () => clear(sample, onChange)));
    }
    cell(row).textContent = `${midiToNoteName(sample.rootNote)} (${sample.rootNote})`;
    cell(row, 'number').textContent = sample.velocityLayer;
    cell(row, 'number').textContent = sample.roundRobin;
    return;
  }

  const problem = cell(row, 'problem', 4);
  problem.append(
    sample.parseError,
    ' ',
    button('Assign', 'Give this file a name, note, velocity layer and round-robin', () => {
      problem.className = '';
      // Cancel redraws the table, which shows the message again.
      problem.replaceChildren(form(sample, project, onChange, onChange));
    }),
  );
}

function form(sample, project, onChange, onCancel) {
  const wrapper = document.createElement('span');
  const fileBase = sample.path.split('/').pop().replace(/\.[^.]+$/, '');
  const name = input('text', fileBase, '10em');
  const note = input('text', 'C3', '4em');
  const layer = input('number', '1', '3.5em');
  const roundRobin = input('number', '1', '3.5em');
  const error = document.createElement('span');
  error.className = 'problem';

  const save = button('Save', 'Use these values for this file', () => {
    let rootNote;
    try {
      rootNote = parseNote(note.value.trim());
    } catch (err) {
      error.textContent = ` ${err.message}`;
      return;
    }
    const whole = (text) => (/^\d+$/.test(text.trim()) && Number(text) >= 1 ? Number(text) : null);
    const velocityLayer = whole(layer.value);
    const rr = whole(roundRobin.value);
    if (name.value.trim() === '') error.textContent = ' Name is empty';
    else if (velocityLayer === null) error.textContent = ' Velocity layer must be a whole number from 1';
    else if (rr === null) error.textContent = ' Round-robin must be a whole number from 1';
    else {
      Object.assign(sample, {
        name: name.value.trim(),
        rootNote,
        fileNote: rootNote,
        velocityLayer,
        roundRobin: rr,
        parseError: null,
        manual: true,
      });
      // Into its zone if that exists, or wherever auto-map would put a new one.
      placeSamples(project, [sample]);
      onChange();
    }
  });

  wrapper.append(
    labelled('Name ', name),
    labelled('Note ', note),
    labelled('v', layer),
    labelled('rr', roundRobin),
    save,
    ' ',
    button('Cancel', 'Leave this file unparsed', onCancel),
    error,
  );
  return wrapper;
}

// Back to unparsed: the filename's own message, and no mapping.
function clear(sample, onChange) {
  let parseError = 'Not parsed';
  try {
    parseFilename(sample.path);
  } catch (err) {
    parseError = err.message;
  }
  Object.assign(sample, {
    name: null,
    rootNote: null,
    fileNote: null,
    velocityLayer: null,
    roundRobin: null,
    parseError,
    manual: false,
    loNote: null,
    hiNote: null,
    loVel: null,
    hiVel: null,
  });
  onChange();
}

function cell(row, className = '', colSpan = 1) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.colSpan = colSpan;
  row.append(td);
  return td;
}

function input(type, value, width) {
  const element = document.createElement('input');
  element.type = type;
  element.value = value;
  element.style.width = width;
  if (type === 'number') element.min = 1;
  return element;
}

function labelled(text, element) {
  const label = document.createElement('label');
  label.className = 'effect-field';
  label.append(text, element);
  return label;
}

function button(text, title, onClick) {
  const element = document.createElement('button');
  element.textContent = text;
  element.title = title;
  element.addEventListener('click', onClick);
  return element;
}
