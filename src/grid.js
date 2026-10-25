// Draws the mapping grid: keys 0–127 left to right, velocity 1–127 bottom to
// top, with a piano strip underneath. Each exported sample is a rectangle
// ("zone") covering its key and velocity ranges. Round-robins of the same
// sound share one zone (see getZones in mapping.js), so editing a zone
// changes all of them together.
//
// Zones can be moved (drag the middle) and resized (drag an edge). The root
// note is changed by typing it in the details line, not by dragging.
//
// Drawn as SVG: every zone is a real element the browser can click and drag,
// and it scales to the page width via the viewBox.
//
// Release samples and other articulations cover the same keys as the normal
// ones, so the grid shows one articulation and kind at a time, picked above it.

import { articulationOf, getZones, isRelease, zoneKey } from './mapping.js';
import { midiToNoteName } from './filename.js';
import { renderLoopEditor } from './loops.js';
import { findWarnings } from './validate.js';

// Sizes in SVG units. The whole drawing is scaled to fit the page width.
const KEY_WIDTH = 10;
const VELOCITY_STEP = 3; // height of one velocity value
const LEFT = 40; // room for the velocity labels
const PLOT_HEIGHT = 127 * VELOCITY_STEP;
const KEYBOARD_HEIGHT = 24;
const LABEL_HEIGHT = 20;
const WIDTH = LEFT + 128 * KEY_WIDTH + 4;
const HEIGHT = PLOT_HEIGHT + KEYBOARD_HEIGHT + LABEL_HEIGHT;
const HANDLE_SIZE = 4; // thickness of the invisible edge strips used for resizing

const BLACK_KEYS = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A# (semitones above C)
const LAYER_COLORS = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#9c755f', '#edc948'];

// Which zone is selected (its zoneKey). Screen-only state, so it isn't in the
// project data.
let selectedKey = null;

// Whether the grid shows release samples (true) or normal ones, and which
// articulation (0 = none). Screen-only.
let showRelease = false;
let showArticulation = 0;

// `onChange` is called after the user edits a zone, so the rest of the page
// (table, XML preview, export) can update. `onLoopChange` is called after a
// loop value changes; it only needs to update the export, so typing in the
// Trim and loop box isn't interrupted by a full redraw.
export function renderGrid(container, details, project, onChange, onLoopChange) {
  const allZones = getZones(project);
  const hasRelease = allZones.some((zone) => isRelease(project, zone[0]));
  if (!hasRelease) showRelease = false;
  const articulations = [...new Set(allZones.map((zone) => articulationOf(project, zone[0])))].sort((a, b) => a - b);
  if (!articulations.includes(showArticulation)) showArticulation = articulations[0] ?? 0;
  const zones = allZones.filter(
    (zone) => isRelease(project, zone[0]) === showRelease && articulationOf(project, zone[0]) === showArticulation,
  );
  const layers = [...new Set(zones.map((zone) => zone[0].velocityLayer))].sort((a, b) => a - b);
  const isSelected = (zone) => zoneKey(zone[0]) === selectedKey;
  // Recomputed on every redraw, so outlines update while dragging.
  const { overlapping } = findWarnings(project);
  const redraw = () => renderGrid(container, details, project, onChange, onLoopChange);

  const svg = svgElement('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: 'grid' });
  // Pressing on empty space deselects.
  svg.addEventListener('pointerdown', () => {
    selectedKey = null;
    redraw();
  });

  drawBackground(svg);
  drawKeyboard(svg);

  // Draw the selected zone last so it sits on top.
  const ordered = [...zones].sort((a, b) => isSelected(a) - isSelected(b));
  for (const zone of ordered) {
    const color = LAYER_COLORS[layers.indexOf(zone[0].velocityLayer) % LAYER_COLORS.length];
    const element = drawZone(svg, zone, color, isSelected(zone), overlapping.has(zoneKey(zone[0])));
    element.addEventListener('pointerdown', (event) => {
      event.stopPropagation(); // don't let the background deselect it
      selectedKey = zoneKey(zone[0]);
      startDrag(event, zone, event.target.dataset.mode, container, redraw, onChange);
    });
  }

  const pickers = [];
  if (articulations.length > 1) pickers.push(articulationPicker(project, articulations, redraw));
  if (hasRelease) pickers.push(kindPicker(redraw));
  container.replaceChildren(...pickers, svg);
  renderDetails(
    details,
    zones.find(isSelected),
    () => {
      redraw();
      onChange();
    },
    onLoopChange,
  );
}

// A dropdown of the articulations that have samples (0 = no articulation).
function articulationPicker(project, articulations, redraw) {
  const bar = document.createElement('p');
  bar.className = 'grid-kind';
  const select = document.createElement('select');
  for (const articulation of articulations) {
    const option = document.createElement('option');
    option.value = articulation;
    const ks = project.keyswitches[articulation];
    option.textContent =
      articulation === 0
        ? 'No articulation (always plays)'
        : `Articulation ${articulation}` + (Number.isInteger(ks) ? ` (keyswitch ${midiToNoteName(ks)})` : '');
    select.append(option);
  }
  select.value = showArticulation;
  select.addEventListener('change', () => {
    showArticulation = Number(select.value);
    selectedKey = null;
    redraw();
  });
  bar.append('Articulation: ', select);
  return bar;
}

// Two radio buttons: show the normal samples or the release samples.
function kindPicker(redraw) {
  const bar = document.createElement('p');
  bar.className = 'grid-kind';
  bar.append('Show: ');
  for (const [release, text] of [[false, 'Key down (normal samples)'], [true, 'Key up (release samples)']]) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'grid-kind';
    radio.checked = showRelease === release;
    radio.addEventListener('change', () => {
      showRelease = release;
      selectedKey = null;
      redraw();
    });
    label.append(radio, ` ${text} `);
    bar.append(label);
  }
  return bar;
}

// --- Dragging ---------------------------------------------------------------
//
// Each pointer move works out how far the pointer has travelled in whole keys
// and velocity steps, applies that to the ranges the zone had when the drag
// started, and redraws. The listeners are on `window`, so they keep working
// even though each redraw replaces the SVG elements.

function startDrag(event, zone, mode, container, redraw, onChange) {
  event.preventDefault(); // stop the browser selecting text while dragging
  const start = pointerPosition(container, event);
  const first = zone[0]; // all samples in a zone share the same ranges
  const original = { loNote: first.loNote, hiNote: first.hiNote, loVel: first.loVel, hiVel: first.hiVel };

  function onMove(moveEvent) {
    const now = pointerPosition(container, moveEvent);
    const keys = Math.round(now.note - start.note);
    const vels = Math.round(now.velocity - start.velocity);
    const ranges = applyDrag(mode, original, keys, vels);
    for (const sample of zone) Object.assign(sample, ranges);
    redraw();
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const changed = ['loNote', 'hiNote', 'loVel', 'hiVel'].some((f) => first[f] !== original[f]);
    redraw();
    if (changed) onChange();
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  redraw(); // show the selection straight away
}

// Returns the new ranges for a drag. Keys stay within 0–127, velocity within
// 1–127, and low never goes above high.
function applyDrag(mode, r, keys, vels) {
  switch (mode) {
    case 'move': {
      const loNote = clamp(r.loNote + keys, 0, 127 - (r.hiNote - r.loNote));
      const loVel = clamp(r.loVel + vels, 1, 127 - (r.hiVel - r.loVel));
      return {
        loNote,
        hiNote: loNote + (r.hiNote - r.loNote),
        loVel,
        hiVel: loVel + (r.hiVel - r.loVel),
      };
    }
    case 'left':
      return { ...r, loNote: clamp(r.loNote + keys, 0, r.hiNote) };
    case 'right':
      return { ...r, hiNote: clamp(r.hiNote + keys, r.loNote, 127) };
    case 'top':
      return { ...r, hiVel: clamp(r.hiVel + vels, r.loVel, 127) };
    case 'bottom':
      return { ...r, loVel: clamp(r.loVel + vels, 1, r.hiVel) };
    default:
      return r;
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Converts the pointer's screen position into grid units (keys and velocity).
function pointerPosition(container, event) {
  const svg = container.querySelector('svg');
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  return {
    note: (point.x - LEFT) / KEY_WIDTH,
    velocity: 127 - point.y / VELOCITY_STEP,
  };
}

// --- Drawing ----------------------------------------------------------------

function noteX(note) {
  return LEFT + note * KEY_WIDTH;
}

// The y position of the top edge of a velocity value (127 is at the top).
function velocityTop(velocity) {
  return (127 - velocity) * VELOCITY_STEP;
}

function drawBackground(svg) {
  svg.append(svgElement('rect', { x: LEFT, y: 0, width: 128 * KEY_WIDTH, height: PLOT_HEIGHT, class: 'grid-bg' }));

  // A vertical line at every C.
  for (let note = 0; note < 128; note += 12) {
    svg.append(svgElement('line', { x1: noteX(note), y1: 0, x2: noteX(note), y2: PLOT_HEIGHT, class: 'grid-line' }));
  }

  // Horizontal lines and labels for velocity.
  for (const velocity of [32, 64, 96]) {
    const y = velocityTop(velocity) + VELOCITY_STEP; // just below this velocity
    svg.append(svgElement('line', { x1: LEFT, y1: y, x2: noteX(128), y2: y, class: 'grid-line' }));
  }
  for (const velocity of [1, 32, 64, 96, 127]) {
    // Centred on the velocity, but kept inside the plot at the top and bottom.
    const y = Math.min(Math.max(velocityTop(velocity) + VELOCITY_STEP / 2 + 5, 12), PLOT_HEIGHT - 2);
    svg.append(svgElement('text', { x: LEFT - 4, y, class: 'grid-label', 'text-anchor': 'end' }, String(velocity)));
  }
}

function drawKeyboard(svg) {
  for (let note = 0; note < 128; note++) {
    const isBlack = BLACK_KEYS.includes(note % 12);
    svg.append(
      svgElement('rect', {
        x: noteX(note),
        y: PLOT_HEIGHT,
        width: KEY_WIDTH,
        height: KEYBOARD_HEIGHT,
        class: isBlack ? 'key-black' : 'key-white',
      }),
    );
    if (note % 12 === 0) {
      svg.append(
        svgElement('text', { x: noteX(note) + 1, y: HEIGHT - 3, class: 'grid-label' }, midiToNoteName(note)),
      );
    }
  }
}

// Draws one zone and returns its <g> element. Each part has a data-mode that
// says what dragging it does.
function drawZone(svg, zone, color, isSelected, isOverlapping) {
  const sample = zone[0]; // all samples in a zone share the same ranges and root
  const loVel = Math.max(sample.loVel, 1); // the grid starts at velocity 1
  const x = noteX(sample.loNote);
  const y = velocityTop(sample.hiVel);
  const width = (sample.hiNote - sample.loNote + 1) * KEY_WIDTH;
  const height = (sample.hiVel - loVel + 1) * VELOCITY_STEP;

  const classes = ['zone', isSelected && 'selected', isOverlapping && 'overlap'].filter(Boolean);
  const group = svgElement('g', { class: classes.join(' ') });
  group.append(svgElement('title', {}, zone.map((s) => s.path).join('\n'))); // tooltip on hover

  // The zone itself: dragging the middle moves it.
  group.append(svgElement('rect', { x, y, width, height, fill: color, class: 'zone-body', 'data-mode': 'move' }));

  // A darker stripe in the root note's column (doesn't catch clicks).
  group.append(
    svgElement('rect', { x: noteX(sample.rootNote), y, width: KEY_WIDTH, height, fill: color, class: 'zone-root' }),
  );

  // Invisible strips along each edge for resizing. On small zones they get
  // thinner, so there is always some middle left to grab for moving.
  const hx = Math.min(HANDLE_SIZE, width / 3);
  const hy = Math.min(HANDLE_SIZE, height / 3);
  const handles = [
    { mode: 'left', x, y, width: hx, height, cls: 'handle-x' },
    { mode: 'right', x: x + width - hx, y, width: hx, height, cls: 'handle-x' },
    { mode: 'top', x, y, width, height: hy, cls: 'handle-y' },
    { mode: 'bottom', x, y: y + height - hy, width, height: hy, cls: 'handle-y' },
  ];
  for (const h of handles) {
    group.append(
      svgElement('rect', {
        x: h.x,
        y: h.y,
        width: h.width,
        height: h.height,
        class: `handle ${h.cls}`,
        'data-mode': h.mode,
      }),
    );
  }

  svg.append(group);
  return group;
}

// The area under the grid. For a selected zone: a line with a box for typing
// a new root note (applied to all the zone's round-robins; `onRootChange` is
// called after it changes), then the Trim and loop box.
function renderDetails(details, zone, onRootChange, onLoopChange) {
  if (!zone) {
    details.textContent = 'Click a zone to see its details.';
    return;
  }
  const sample = zone[0];

  // One sample: show its path. Several round-robins: describe the zone.
  const name = document.createElement('strong');
  name.textContent =
    zone.length === 1
      ? sample.path
      : `${sample.name} ${midiToNoteName(sample.fileNote)} v${sample.velocityLayer}`;
  const roundRobins =
    zone.length === 1
      ? ''
      : ` ${zone.length} round-robins (${zone.map((s) => `rr${s.roundRobin}`).join(', ')}).`;

  const rootInput = document.createElement('input');
  rootInput.type = 'number';
  rootInput.min = 0;
  rootInput.max = 127;
  rootInput.value = sample.rootNote;
  rootInput.className = 'root-input';
  rootInput.title = 'Root note (MIDI number). Changes the pitch the sample plays at.';
  // "change" fires when you press Return or click away, not on every keystroke.
  rootInput.addEventListener('change', () => {
    const value = Number(rootInput.value);
    if (Number.isInteger(value) && value >= 0 && value <= 127) {
      for (const s of zone) s.rootNote = value;
      onRootChange();
    } else {
      rootInput.value = sample.rootNote; // invalid: put the old value back
    }
  });

  const line = document.createElement('p');
  line.append(
    name,
    ' Root: ',
    rootInput,
    ` ${midiToNoteName(sample.rootNote)}.` +
      ` Keys: ${noteLabel(sample.loNote)} – ${noteLabel(sample.hiNote)}.` +
      ` Velocity: ${sample.loVel}–${sample.hiVel}.` +
      roundRobins,
  );

  const loopBox = document.createElement('div');
  renderLoopEditor(loopBox, zone, onLoopChange);
  details.replaceChildren(line, loopBox);
}

function noteLabel(note) {
  return `${midiToNoteName(note)} (${note})`;
}

// Creates an SVG element. (SVG needs createElementNS, not createElement.)
function svgElement(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  if (text !== undefined) element.textContent = text;
  return element;
}
