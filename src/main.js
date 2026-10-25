import { pickFolder } from './folder.js';
import { readWavInfo } from './wav.js';
import { parseFilename, midiToNoteName } from './filename.js';
import { createProject, createSample } from './project.js';
import { autoMap, isExportable, getZones, mergeSamples, zoneKey } from './mapping.js';
import { buildPresetXml, checkPreset } from './export.js';
import { renderGrid } from './grid.js';
import { renderEnvelopeEditor } from './envelope.js';
import { renderGlobalEditor } from './global.js';
import { renderReleaseEditor } from './release.js';
import { renderChokeEditor } from './choke.js';
import { renderKeyswitchEditor } from './keyswitch.js';
import { renderEffectsEditor } from './effects.js';
import { renderModulatorsEditor } from './modulators.js';
import { addControl, renderControlsEditor } from './ui.js';
import { projectFromJson, projectToJson } from './save.js';
import { findWarnings } from './validate.js';
import { clearWaveformCache, setAudioFiles } from './waveform.js';

let project = null;

const pickButton = document.querySelector('#pick-folder');
const resetMappingButton = document.querySelector('#reset-mapping');
const saveButton = document.querySelector('#save-project');
const loadButton = document.querySelector('#load-project');
const loadInput = document.querySelector('#load-project-file');
const summary = document.querySelector('#summary');
const tableBody = document.querySelector('#file-table tbody');
const exportSection = document.querySelector('#export-section');
const exportSummary = document.querySelector('#export-summary');
const exportProblems = document.querySelector('#export-problems');
const exportWarnings = document.querySelector('#export-warnings');
const exportButton = document.querySelector('#export-button');
const xmlPreview = document.querySelector('#xml-preview');
const mappingSection = document.querySelector('#mapping-section');
const gridContainer = document.querySelector('#grid');
const zoneDetails = document.querySelector('#zone-details');
const roundRobinRow = document.querySelector('#rr-mode-row');
const roundRobinSelect = document.querySelector('#rr-mode');
const keyswitchSection = document.querySelector('#keyswitch-section');
const keyswitchContainer = document.querySelector('#keyswitch');
const chokeSection = document.querySelector('#choke-section');
const chokeContainer = document.querySelector('#choke');
const releaseSection = document.querySelector('#release-section');
const releaseContainer = document.querySelector('#release');
const globalSection = document.querySelector('#global-section');
const globalContainer = document.querySelector('#global');
const envelopeSection = document.querySelector('#envelope-section');
const envelopeContainer = document.querySelector('#envelope');
const effectsSection = document.querySelector('#effects-section');
const effectsContainer = document.querySelector('#effects');
const modulatorsSection = document.querySelector('#modulators-section');
const modulatorsContainer = document.querySelector('#modulators');
const controlsSection = document.querySelector('#controls-section');
const controlsContainer = document.querySelector('#controls');

pickButton.addEventListener('click', async () => {
  let picked;
  try {
    picked = await pickFolder();
  } catch (err) {
    summary.textContent = `Could not open folder: ${err.message}`;
    return;
  }
  if (picked === null) return; // cancelled

  summary.textContent = `Reading ${picked.files.length} files…`;
  // Kept in memory (this session only) so waveforms can be drawn.
  setAudioFiles(picked.files);
  clearWaveformCache();
  // Volume, envelope, effects, controls, release samples, key switches and
  // choke groups are instrument settings, not part of the mapping, so they survive
  // re-picking the folder.
  const previous = project;
  project = createProject(picked.folderName);
  if (previous) {
    project.roundRobinMode = previous.roundRobinMode;
    project.volume = previous.volume;
    project.velocityTracking = previous.velocityTracking;
    project.globalTuning = previous.globalTuning;
    project.globalPan = previous.globalPan;
    project.releaseNames = previous.releaseNames;
    project.releaseDecay = previous.releaseDecay;
    project.releaseIgnoresEnvelope = previous.releaseIgnoresEnvelope;
    project.chokeGroups = previous.chokeGroups;
    project.chokeMode = previous.chokeMode;
    project.chokeDecay = previous.chokeDecay;
    project.articulations = previous.articulations;
    project.keyswitches = previous.keyswitches;
    project.envelope = previous.envelope;
    project.ui = previous.ui;
    project.effects = previous.effects;
    project.nextEffectNumber = previous.nextEffectNumber;
    project.modulators = previous.modulators;
    project.nextModulatorNumber = previous.nextModulatorNumber;
  } else {
    addControl(project, null, 'volume'); // a new instrument starts with a Volume control
  }

  for (const { path, file } of picked.files) {
    let info = null;
    let readError = null;
    if (path.toLowerCase().endsWith('.wav')) {
      try {
        info = await readWavInfo(file);
      } catch (err) {
        readError = err.message;
      }
    }

    let parsed = null;
    let parseError = null;
    try {
      parsed = parseFilename(path);
    } catch (err) {
      parseError = err.message;
    }

    project.samples.push(
      createSample({ path, sizeBytes: file.size, info, readError, parsed, parseError }),
    );
  }

  if (previous) {
    const report = mergeSamples(project, previous.samples);
    render();
    summary.textContent += `. ${describeMerge(report)}`;
  } else {
    autoMap(project);
    render();
  }
});

// e.g. "Kept 38 files, added 3 (1 new zone: Thumb C5 v1), removed 1: a.wav."
function describeMerge({ kept, added, newZones, removed }) {
  const zoneNames = newZones.map((key) => {
    const sample = project.samples.find((s) => zoneKey(s) === key);
    return `${sample.name} ${midiToNoteName(sample.fileNote)} v${sample.velocityLayer}`;
  });
  let text = `Kept ${kept} files`;
  if (added > 0) {
    text += `, added ${added}`;
    if (zoneNames.length > 0) {
      text += ` (${zoneNames.length} new zone${zoneNames.length > 1 ? 's' : ''}: ${zoneNames.join(', ')})`;
    }
  }
  if (removed.length > 0) text += `, removed ${removed.length}: ${removed.join(', ')}`;
  return `${text}.`;
}

// A fresh auto-map of every zone. Root notes go back to the filename's note;
// loops are kept.
resetMappingButton.addEventListener('click', () => {
  if (!confirm('Reset all key and velocity ranges and root notes to the automatic mapping?')) return;
  for (const sample of project.samples) sample.rootNote = sample.fileNote;
  autoMap(project);
  render();
});

roundRobinSelect.addEventListener('change', () => {
  project.roundRobinMode = roundRobinSelect.value;
  renderExport();
});

exportButton.addEventListener('click', () => {
  download(xmlPreview.textContent, `${project.folderName || 'preset'}.dspreset`, 'application/xml');
});

saveButton.addEventListener('click', () => {
  download(projectToJson(project), `${project.folderName || 'project'}.dsproject.json`, 'application/json');
});

loadButton.addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', () => {
  const file = loadInput.files[0];
  loadInput.value = ''; // so picking the same file again still triggers "change"
  if (file) loadProjectFile(file);
});

// Dropping a project file anywhere on the page loads it too. Without
// preventDefault on dragover the browser would open the file instead.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json')) {
    alert(`${file.name} is not a project file. Drop a .dsproject.json file to load it.`);
    return;
  }
  loadProjectFile(file);
});

async function loadProjectFile(file) {
  let loaded;
  try {
    loaded = projectFromJson(await file.text());
  } catch (err) {
    // The current project (if any) is left as it was.
    alert(`Could not load ${file.name}: ${err.message}`);
    return;
  }
  project = loaded.project;
  // The loaded project may be a different folder: waveforms need a re-pick.
  setAudioFiles([]);
  render();
  const when = loaded.savedAt ? ` (saved ${loaded.savedAt.toLocaleString()})` : '';
  summary.textContent += `. Loaded from ${file.name}${when}.`;
}

// Turns text into a file and makes the browser download it.
function download(text, fileName, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  // Free the temporary link once the download has started.
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function render() {
  saveButton.disabled = false;
  const samples = project.samples;
  const unparsed = samples.filter((s) => s.parseError !== null).length;
  const unreadable = samples.filter((s) => s.readError !== null).length;
  summary.textContent =
    `${project.folderName}: ${samples.length} audio files, ` +
    `${samples.length - unparsed} parsed, ${unparsed} not parsed` +
    (unreadable > 0 ? `, ${unreadable} could not be read` : '');

  tableBody.replaceChildren(...samples.map(renderRow));
  // After a zone edit, redraw everything so the table and XML stay in sync.
  renderGrid(gridContainer, zoneDetails, project, render, renderExport);
  mappingSection.hidden = false;
  renderReleaseEditor(releaseContainer, project, render, renderExport);
  releaseSection.hidden = false;
  renderKeyswitchEditor(keyswitchContainer, project, render, renderExport);
  keyswitchSection.hidden = false;
  renderChokeEditor(chokeContainer, project, renderExport);
  chokeSection.hidden = false;
  renderGlobalEditor(globalContainer, project, renderExport);
  globalSection.hidden = false;
  // Ticking the envelope adds or removes controls, so redraw those too.
  renderEnvelopeEditor(envelopeContainer, project, renderInstrument);
  envelopeSection.hidden = false;
  // Effect changes also change what controls can target, so redraw those too.
  renderEffectsEditor(effectsContainer, project, renderInstrument);
  effectsSection.hidden = false;
  // Modulator changes add, remove or restart controls, so redraw those too.
  renderModulatorsEditor(modulatorsContainer, project, renderControlsAndExport);
  modulatorsSection.hidden = false;
  renderControlsEditor(controlsContainer, project, renderExport);
  controlsSection.hidden = false;
  renderExport();
}

function renderInstrument() {
  // Modulator targets list the effects' parameters.
  renderModulatorsEditor(modulatorsContainer, project, renderControlsAndExport);
  renderControlsAndExport();
}

function renderControlsAndExport() {
  renderControlsEditor(controlsContainer, project, renderExport);
  renderExport();
}

function renderExport() {
  const samples = project.samples;
  const exported = samples.filter(isExportable).length;
  const unparsed = samples.filter((s) => s.parseError !== null).length;
  const zones = getZones(project);
  const usesRoundRobin = zones.some((zone) => zone.length > 1);

  exportSummary.textContent =
    `${exported} samples in ${zones.length} zones will be exported` +
    (unparsed > 0 ? `, ${unparsed} skipped (not parsed)` : '') +
    '.';

  // The mode only matters when there are round-robins.
  roundRobinRow.hidden = !usesRoundRobin;
  roundRobinSelect.value = project.roundRobinMode;

  const xml = buildPresetXml(project);
  const problems = checkPreset(project, xml);
  const listItem = (text) => {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  };
  // Warnings are shown but don't block the export; problems do.
  exportWarnings.replaceChildren(...findWarnings(project).messages.map((m) => listItem(`Warning: ${m}`)));
  exportProblems.replaceChildren(...problems.map(listItem));
  exportButton.disabled = problems.length > 0;
  xmlPreview.textContent = xml;
  exportSection.hidden = false;
}

function renderRow(sample) {
  const row = document.createElement('tr');
  addCell(row, sample.path);

  if (sample.parseError !== null) {
    addCell(row, sample.parseError, 'problem', 4);
  } else {
    addCell(row, sample.name);
    addCell(row, `${midiToNoteName(sample.rootNote)} (${sample.rootNote})`);
    addCell(row, sample.velocityLayer, 'number');
    addCell(row, sample.roundRobin, 'number');
  }

  addCell(row, formatSize(sample.sizeBytes), 'number');

  if (sample.readError !== null) {
    addCell(row, sample.readError, 'problem', 5);
  } else if (sample.frames === null) {
    addCell(row, 'not read (WAV only for now)', 'muted', 5);
  } else {
    addCell(row, sample.sampleRate, 'number');
    addCell(row, sample.channels, 'number');
    addCell(row, sample.bitDepth, 'number');
    addCell(row, sample.frames, 'number');
    addCell(row, `${(sample.frames / sample.sampleRate).toFixed(2)} s`, 'number');
  }
  return row;
}

// textContent (not innerHTML) so odd characters in filenames can't break the page.
function addCell(row, text, className = '', colSpan = 1) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  cell.colSpan = colSpan;
  row.append(cell);
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
