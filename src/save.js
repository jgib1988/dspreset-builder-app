// Saving and loading the project data (the app's single source of truth) as
// a JSON file. No audio is saved: only paths, header info and settings.
//
// The file is wrapped with the app name and a format version, so a later
// version of the app can recognise older files and update them.

import { createProject, createSample } from './project.js';

const APP = 'dspreset-builder';
const VERSION = 1;

export function projectToJson(project) {
  return JSON.stringify({ app: APP, version: VERSION, savedAt: new Date().toISOString(), project }, null, 2);
}

// Returns { project, savedAt }, or throws an Error saying what's wrong.
export function projectFromJson(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON');
  }
  if (file === null || typeof file !== 'object' || file.app !== APP) {
    throw new Error('This is not a project file from this app');
  }
  if (file.version > VERSION) throw new Error('This project was saved by a newer version of the app');
  if (file.version !== VERSION) throw new Error(`Unknown project file version "${file.version}"`);
  const saved = file.project;
  if (saved === null || typeof saved !== 'object' || !Array.isArray(saved.samples) || !Array.isArray(saved.effects)) {
    throw new Error('The project data in this file is incomplete');
  }
  return { project: withDefaults(saved), savedAt: file.savedAt ? new Date(file.savedAt) : null };
}

// Fills in anything missing from a saved project with today's defaults, so
// files saved before a setting existed still load (e.g. no panel positions
// means the automatic layout).
function withDefaults(saved) {
  const defaults = createProject(saved.folderName ?? '');
  const emptySample = createSample({ path: '', sizeBytes: 0, info: null, readError: null, parsed: null, parseError: null });
  return {
    ...defaults,
    ...saved,
    envelope: { ...defaults.envelope, ...saved.envelope },
    ui: {
      ...defaults.ui,
      ...saved.ui,
      controls: (saved.ui?.controls ?? []).map((c) => (c.kind === 'knob' ? { scale: 'linear', ...c } : c)),
    },
    effects: saved.effects.map((e) => ({ enabled: true, ...e })),
    samples: saved.samples.map((s) => ({ ...emptySample, ...s })),
  };
}
