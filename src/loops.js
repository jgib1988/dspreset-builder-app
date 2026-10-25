// The Trim and loop box shown under the grid for the selected zone: one row
// per sample, because each round-robin is its own file with its own length.
//
// Values are in frames (sample positions), the unit Decent Sampler uses
// (docs: start, end, loopStart, loopEnd, loopCrossfade). The time is shown
// next to each box. A blank trim means the file's own start or end.
// Checks on the values happen in export.js (checkTrim, checkLoop).

import { renderWaveform } from './waveform.js';

// Which sample's waveform is shown (its path). Screen-only state, so it isn't
// in the project data. Falls back to the zone's first sample.
let shownPath = null;

// `onChange` is called after any loop value changes, so the XML preview and
// export checks can update.
export function renderLoopEditor(box, zone, onChange) {
  const rerender = () => renderLoopEditor(box, zone, onChange);

  const table = document.createElement('table');
  table.className = 'loop-table';
  const header = document.createElement('tr');
  for (const title of ['Sample', 'Length', 'Trim start', 'Trim end', 'Loop', 'Loop start', 'Loop end', 'Crossfade']) {
    const th = document.createElement('th');
    th.textContent = title;
    header.append(th);
  }
  table.append(header);
  const shown = zone.find((s) => s.path === shownPath) ?? zone[0];
  const waveform = document.createElement('div');
  // While dragging only the export updates; the boxes update on release.
  const drawWaveform = () => renderWaveform(waveform, shown, onChange, rerender);
  // Typing in a box also moves the markers (the cached waveform redraws quickly).
  const onValueChange = () => {
    onChange();
    drawWaveform();
  };
  for (const sample of zone) {
    const row = renderRow(sample, rerender, onValueChange);
    // Clicking a row (not one of its boxes) shows that sample's waveform.
    if (zone.length > 1) {
      row.classList.add('loop-row');
      if (sample === shown) row.classList.add('shown');
      row.addEventListener('click', (event) => {
        if (event.target.closest('input')) return;
        shownPath = sample.path;
        rerender();
      });
    }
    table.append(row);
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Trim and loop';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    (zone.length > 1 ? `Waveform of ${shown.path.split('/').pop()} (click a row to show another). ` : '') +
    'Drag the markers to set trim and loop points; type in the boxes for exact frames.';
  drawWaveform();
  box.replaceChildren(heading, table, hint, waveform);
}

function renderRow(sample, rerender, onChange) {
  const row = document.createElement('tr');

  const name = document.createElement('td');
  name.textContent = sample.path.split('/').pop();
  row.append(name);

  const length = document.createElement('td');
  length.textContent =
    sample.frames !== null
      ? `${sample.frames} frames (${formatTime(sample.frames, sample.sampleRate)})`
      : 'unknown (only WAV headers are read), so the loop end can’t be checked';
  row.append(length);

  // Trim: blank plays from the file's start / to its end.
  row.append(frameCell(sample, 'start', onChange, 'file start'));
  row.append(frameCell(sample, 'end', onChange, 'file end'));

  // Turning the loop on fills in a starting loop: the whole (trimmed) file,
  // no crossfade.
  const enabledCell = document.createElement('td');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = sample.loopEnabled;
  enabled.addEventListener('change', () => {
    sample.loopEnabled = enabled.checked;
    if (sample.loopEnabled && sample.loopStart === null) {
      sample.loopStart = sample.start ?? 0;
      sample.loopEnd = sample.end ?? (sample.frames !== null ? sample.frames - 1 : null);
      sample.loopCrossfade = 0;
    }
    rerender();
    onChange();
  });
  enabledCell.append(enabled);
  row.append(enabledCell);

  for (const field of ['loopStart', 'loopEnd', 'loopCrossfade']) {
    const cell = frameCell(sample, field, onChange);
    cell.querySelector('input').disabled = !sample.loopEnabled;
    row.append(cell);
  }
  return row;
}

// A number box for a frame value, with the time shown next to it. `blank`
// (optional) is shown when the box is empty.
function frameCell(sample, field, onChange, blank) {
  const cell = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.step = 1;
  input.className = 'frame-input';
  input.value = sample[field] ?? '';
  if (blank) input.placeholder = blank;

  const time = document.createElement('span');
  time.className = 'frame-time';
  const showTime = () => {
    time.textContent = sample[field] === null ? '' : ` ${formatTime(sample[field], sample.sampleRate)}`;
  };
  showTime();

  // "input" fires on every keystroke, so the time and XML update as you type.
  input.addEventListener('input', () => {
    sample[field] = input.value === '' ? null : Number(input.value);
    showTime();
    onChange();
  });

  cell.append(input, time);
  return cell;
}

// 22050 frames at 44100 Hz -> "0.50 s"; short values in ms.
function formatTime(frames, sampleRate) {
  if (!sampleRate || !Number.isFinite(frames)) return '';
  const seconds = frames / sampleRate;
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
}
