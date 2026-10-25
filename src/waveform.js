// The waveform under the Trim and loop table: one lane per channel, with the
// trim (greyed outside), the loop region and crossfade, and markers that can
// be dragged to change trim start/end and loop start/end. It can be zoomed
// in to single frames.
//
// The audio is read locally from the picked folder (never uploaded). Files
// are kept in memory for this session only, not in the project data, so
// after loading a project the folder has to be picked again to see this.

import { readWavAudio } from './wav.js';

// Picked files by path, for this session. Set by main.js when a folder is picked.
const audioFiles = new Map();
export function setAudioFiles(files) {
  audioFiles.clear();
  for (const { path, file } of files) audioFiles.set(path, file);
}

const WIDTH = 1000; // SVG units; also the number of peak columns
const LANE_HEIGHT = 110;
const RULER_HEIGHT = 20;
const HIT_WIDTH = 10; // invisible strip around each marker for grabbing it
const MIN_VISIBLE = 100; // most zoomed in: frames across the view
const GO_TO_VISIBLE = 2000; // zoom used by the "Go to" buttons (at most)
const DOTS_BELOW = 250; // draw a dot per frame when fewer frames are visible
const SNAP_SECONDS = 0.01; // how far from the pointer to look for a zero crossing

// Whether dragged markers snap to zero crossings. Screen-only, for this session.
let snap = true;

// The audio of the sample being shown (only one, to save memory), as
// { path, promise }. Cleared when a folder is picked (files may have changed).
let cached = null;
export function clearWaveformCache() {
  cached = null;
}

// The visible part, in frames: { path, start, length }. Screen-only state,
// reset to the whole file when another sample is shown.
let view = null;

// `onChange` is called while a marker is dragged (to update the export);
// `onDragEnd` after it's dropped (to update the table's number boxes).
export function renderWaveform(container, sample, onChange, onDragEnd) {
  const file = audioFiles.get(sample.path);
  if (!file) {
    container.textContent = 'Pick the sample folder to see the waveform.';
    return;
  }
  if (!sample.path.toLowerCase().endsWith('.wav')) {
    container.textContent = 'Waveform view is only available for WAV files.';
    return;
  }
  if (cached?.path !== sample.path) cached = { path: sample.path, promise: readWavAudio(file) };
  container.textContent = 'Reading waveform…';
  cached.promise.then(
    (audio) => {
      // The box may have been redrawn for another sample while reading.
      if (!container.isConnected) return;
      if (view?.path !== sample.path) view = { path: sample.path, start: 0, length: audio.frames };
      const redraw = () => draw(container, sample, audio, redraw, onChange, onDragEnd);
      // A property, not addEventListener, so redrawing doesn't stack up handlers.
      container.onwheel = (event) => onWheel(event, container, audio, redraw);
      redraw();
    },
    (err) => {
      container.textContent = err.message;
    },
  );
}

// Keeps the view inside the file and no closer than MIN_VISIBLE frames.
function setView(frames, start, length) {
  view.length = Math.round(Math.min(Math.max(length, Math.min(MIN_VISIBLE, frames)), frames));
  view.start = Math.round(Math.min(Math.max(start, 0), frames - view.length));
}

// Zooms by `factor` (below 1 zooms in), keeping frame `at` where it is.
function zoom(frames, factor, at = view.start + view.length / 2) {
  const length = view.length * factor;
  setView(frames, at - ((at - view.start) / view.length) * length, length);
}

// Pinch (sent as Ctrl + scroll) or Cmd + scroll zooms around the pointer;
// sideways scroll (or Shift + scroll) moves along. Plain scrolling is left
// alone so the page still scrolls.
function onWheel(event, container, audio, redraw) {
  const svg = container.querySelector('svg.waveform');
  if (!svg) return;
  const box = svg.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const at = view.start + ((event.clientX - box.left) / box.width) * view.length;
    zoom(audio.frames, Math.exp(event.deltaY * 0.01), at);
  } else {
    const sideways = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!sideways) return;
    event.preventDefault();
    setView(audio.frames, view.start + (sideways / box.width) * view.length, view.length);
  }
  redraw();
}

function draw(container, sample, audio, redraw, onChange, onDragEnd) {
  const { frames } = audio;
  const lanes = audio.channels.length;
  const waveHeight = lanes * LANE_HEIGHT;
  const height = waveHeight + RULER_HEIGHT;
  const x = (frame) => ((frame - view.start) / view.length) * WIDTH;

  // The SVG clips anything outside the view, so shapes can run off the edges.
  const svg = svgElement('svg', { viewBox: `0 0 ${WIDTH} ${height}`, class: 'waveform' });
  svg.append(svgElement('rect', { x: 0, y: 0, width: WIDTH, height: waveHeight, class: 'wave-bg' }));

  // Loop region and crossfade (behind the waveform).
  const loopOn = () => sample.loopEnabled && Number.isFinite(sample.loopStart) && Number.isFinite(sample.loopEnd);
  const fade = () => Math.max(sample.loopCrossfade ?? 0, 0);
  if (loopOn()) {
    svg.append(
      svgElement('rect', { x: x(sample.loopStart - fade()), y: 0, width: x(sample.loopStart) - x(sample.loopStart - fade()), height: waveHeight, class: 'wave-crossfade' }),
      svgElement('rect', { x: x(sample.loopStart), y: 0, width: x(sample.loopEnd) - x(sample.loopStart), height: waveHeight, class: 'wave-loop' }),
    );
  }

  audio.channels.forEach((data, lane) => {
    const middle = lane * LANE_HEIGHT + LANE_HEIGHT / 2;
    const scale = LANE_HEIGHT / 2 - 2;
    const y = (value) => middle - value * scale;
    svg.append(svgElement('line', { x1: 0, x2: WIDTH, y1: middle, y2: middle, class: 'wave-zero' }));
    if (view.length > WIDTH) {
      // Many frames per column: one vertical line per column, from its
      // lowest to highest level.
      let d = '';
      for (let i = 0; i < WIDTH; i++) {
        const from = view.start + Math.floor((i * view.length) / WIDTH);
        const to = view.start + Math.floor(((i + 1) * view.length) / WIDTH);
        let min = Infinity;
        let max = -Infinity;
        for (let f = from; f < to; f++) {
          if (data[f] < min) min = data[f];
          if (data[f] > max) max = data[f];
        }
        const top = y(max);
        d += `M${i + 0.5} ${top}V${Math.max(y(min), top + 0.5)}`; // always at least a hairline
      }
      svg.append(svgElement('path', { d, class: 'wave-line' }));
    } else {
      // Zoomed in: a line through the actual frame values (one frame either
      // side so it reaches the edges), with dots when they're far apart.
      const first = Math.max(view.start - 1, 0);
      const last = Math.min(view.start + view.length + 1, frames);
      let d = '';
      for (let f = first; f < last; f++) d += `${f === first ? 'M' : 'L'}${x(f)} ${y(data[f])}`;
      svg.append(svgElement('path', { d, class: 'wave-trace' }));
      if (view.length < DOTS_BELOW) {
        for (let f = first; f < last; f++) svg.append(svgElement('circle', { cx: x(f), cy: y(data[f]), r: 2.5, class: 'wave-dot' }));
      }
    }
    if (lane > 0) svg.append(svgElement('line', { x1: 0, x2: WIDTH, y1: lane * LANE_HEIGHT, y2: lane * LANE_HEIGHT, class: 'wave-divider' }));
  });

  // Grey out what's trimmed away.
  const start = sample.start ?? 0;
  const end = sample.end ?? frames - 1;
  svg.append(
    svgElement('rect', { x: x(0), y: 0, width: x(start) - x(0), height: waveHeight, class: 'wave-trimmed' }),
    svgElement('rect', { x: x(end + 1), y: 0, width: Math.max(x(frames) - x(end + 1), 0), height: waveHeight, class: 'wave-trimmed' }),
  );

  drawRuler(svg, sample.sampleRate, x, waveHeight, height);

  // Markers. Each is limited so markers can't cross: trim outside the loop,
  // loop start before loop end, everything inside the file.
  const last = frames - 1;
  const markers = [
    { field: 'start', label: 'Trim start', at: start, min: () => 0, max: () => Math.min(sample.end ?? last, loopOn() ? sample.loopStart : last) - 1 },
    { field: 'end', label: 'Trim end', at: end, min: () => Math.max(sample.start ?? 0, loopOn() ? sample.loopEnd : 0) + 1, max: () => last },
  ];
  if (loopOn()) {
    markers.push(
      // The crossfade is taken from before loop start, so it must fit there
      // and inside the loop.
      { field: 'loopStart', label: 'Loop start', at: sample.loopStart, min: () => Math.max(sample.start ?? 0, fade()), max: () => sample.loopEnd - Math.max(fade(), 1) },
      { field: 'loopEnd', label: 'Loop end', at: sample.loopEnd, min: () => sample.loopStart + Math.max(fade(), 1), max: () => sample.end ?? last },
    );
  }
  for (const marker of markers) {
    const mx = x(marker.at);
    const kind = marker.field.startsWith('loop') ? 'loop' : 'trim';
    const group = svgElement('g', { class: `wave-marker wave-marker-${kind}` });
    group.append(
      svgElement('title', {}, `${marker.label}: frame ${marker.at} (drag to move)`),
      svgElement('line', { x1: mx, x2: mx, y1: 0, y2: waveHeight, class: 'wave-marker-line' }),
      svgElement('rect', { x: mx - HIT_WIDTH / 2, y: 0, width: HIT_WIDTH, height: waveHeight, class: 'wave-marker-hit' }),
    );
    group.addEventListener('pointerdown', (event) => startDrag(event, container, sample, audio, marker, redraw, onChange, onDragEnd));
    svg.append(group);
  }

  container.replaceChildren(toolbar(frames, markers, redraw), svg, overview(frames));
}

// Zoom buttons, and "Go to" buttons that centre the view on a marker.
function toolbar(frames, markers, redraw) {
  const bar = document.createElement('div');
  bar.className = 'wave-toolbar';
  const button = (text, disabled, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', () => {
      action();
      redraw();
    });
    return b;
  };
  const zoomedOut = view.length >= frames;
  bar.append(
    button('Zoom in', view.length <= MIN_VISIBLE, () => zoom(frames, 0.5)),
    button('Zoom out', zoomedOut, () => zoom(frames, 2)),
    button('Show all', zoomedOut, () => setView(frames, 0, frames)),
    ' Go to: ',
    ...markers.map((m) =>
      button(m.label, false, () => {
        const length = Math.min(view.length, GO_TO_VISIBLE);
        setView(frames, m.at - length / 2, length);
      }),
    ),
    ` ${view.length} frames shown `,
    snapToggle(),
  );
  return bar;
}

function snapToggle() {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = snap;
  box.addEventListener('change', () => {
    snap = box.checked;
  });
  label.append(box, ' Snap to zero crossings');
  return label;
}

// A thin bar showing which part of the file is in view.
function overview(frames) {
  const bar = document.createElement('div');
  bar.className = 'wave-overview';
  const part = document.createElement('div');
  part.className = 'wave-overview-view';
  part.style.left = `${(view.start / frames) * 100}%`;
  part.style.width = `${Math.max((view.length / frames) * 100, 0.5)}%`;
  bar.append(part);
  return bar;
}

// Time ruler: about 10 ticks at round times within the view, in ms when
// zoomed in.
function drawRuler(svg, sampleRate, x, top, height) {
  const from = view.start / sampleRate;
  const to = (view.start + view.length) / sampleRate;
  const step = niceStep((to - from) / 10);
  const inMs = step < 0.01;
  const unit = inMs ? step * 1000 : step;
  const decimals = Math.max(0, -Math.floor(Math.log10(unit) + 1e-9));
  for (let i = Math.ceil(from / step); i * step <= to; i++) {
    const t = i * step;
    const tx = x(t * sampleRate);
    const label = inMs ? `${(t * 1000).toFixed(decimals)} ms` : `${t.toFixed(decimals)} s`;
    svg.append(
      svgElement('line', { x1: tx, x2: tx, y1: top, y2: top + 4, class: 'wave-tick' }),
      svgElement('text', { x: tx + 2, y: height - 3, class: 'wave-label' }, label),
    );
  }
}

// Dragging a marker: the frame under the pointer, kept within the marker's
// limits. Listeners are on window so fast drags don't escape. The drawing is
// replaced on every move, so positions are measured on the current one.
function startDrag(event, container, sample, audio, marker, redraw, onChange, onDragEnd) {
  event.preventDefault();
  const toFrame = (e) => {
    const svg = container.querySelector('svg.waveform');
    const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return Math.round(view.start + (point.x / WIDTH) * view.length);
  };
  const move = (e) => {
    const clamp = (frame) => Math.min(Math.max(frame, marker.min()), marker.max());
    let frame = clamp(toFrame(e));
    if (snap) {
      // Loop points both snap to rising crossings, so the audio at loop end
      // runs on smoothly into loop start.
      const rising = marker.field.startsWith('loop') ? true : null;
      frame = clamp(nearestZeroCrossing(audio, frame, rising, Math.round(SNAP_SECONDS * sample.sampleRate)));
    }
    sample[marker.field] = frame;
    redraw();
    onChange();
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    onDragEnd();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
}

// The zero crossing nearest `frame`, within `reach` frames either side, or
// `frame` itself if there is none. `rising`: true for upward crossings only,
// null for either direction. For several channels their sum is used. A
// crossing lies between two frames; the one nearer zero is returned.
function nearestZeroCrossing(audio, frame, rising, reach) {
  if (!audio.sum) {
    audio.sum = new Float32Array(audio.frames);
    for (const data of audio.channels) for (let f = 0; f < audio.frames; f++) audio.sum[f] += data[f];
  }
  const s = audio.sum;
  const crossesAt = (f) => {
    if (f < 1 || f >= audio.frames) return null;
    const up = s[f - 1] < 0 && s[f] >= 0;
    const down = s[f - 1] > 0 && s[f] <= 0;
    if (!(rising === true ? up : up || down)) return null;
    return Math.abs(s[f - 1]) < Math.abs(s[f]) ? f - 1 : f;
  };
  // Look outwards from the pointer so the nearest crossing is found first.
  for (let d = 0; d <= reach; d++) {
    const found = crossesAt(frame - d) ?? crossesAt(frame + d + 1);
    if (found !== null) return found;
  }
  return frame;
}

// A round tick spacing near `rough` seconds: 1, 2 or 5 times a power of ten.
function niceStep(rough) {
  const power = 10 ** Math.floor(Math.log10(rough));
  for (const n of [1, 2, 5, 10]) if (n * power >= rough) return n * power;
  return 10 * power;
}

function svgElement(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
