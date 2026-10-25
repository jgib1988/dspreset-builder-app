// Works out each sample's key and velocity ranges from its parsed values and
// stores them on the sample (loNote, hiNote, loVel, hiVel). The export only
// reads these fields, so later the mapping grid can edit them directly.

// Every sample whose filename was parsed is exported.
export function isExportable(sample) {
  return sample.parseError === null;
}

// Release samples (their name is in project.releaseNames) play when a key is
// released. They're mapped and exported separately from the normal ones.
export function isRelease(project, sample) {
  return (project.releaseNames ?? []).includes(sample.name);
}

// The sample's articulation number (key switching), or 0 for none.
export function articulationOf(project, sample) {
  return project.articulations?.[sample.name] ?? 0;
}

// The articulation numbers in use, lowest first.
export function usedArticulations(project) {
  const used = project.samples.filter(isExportable).map((s) => articulationOf(project, s));
  return [...new Set(used)].filter((n) => n > 0).sort((a, b) => a - b);
}

// An articulation's name for menus: its sample names, e.g. "Sustain" or
// "Sustain / Legato".
export function articulationLabel(project, articulation) {
  const names = project.samples.filter((s) => isExportable(s) && articulationOf(project, s) === articulation).map((s) => s.name);
  return [...new Set(names)].sort().join(' / ');
}

// Samples that are mapped together: the same articulation, and both normal or
// both release. Different sets normally cover the same keys on purpose.
export function mappingSet(project, sample) {
  return `${articulationOf(project, sample)}|${isRelease(project, sample)}`;
}

// A "zone" is a set of round-robin variations of one sound: samples with the
// same name, filename note and velocity layer. They always share the same key
// and velocity ranges, and the grid draws them as one rectangle.
export function zoneKey(sample) {
  return `${sample.name}|${sample.fileNote}|${sample.velocityLayer}`;
}

// Returns the zones as arrays of samples, each sorted by round-robin number.
export function getZones(project) {
  const zones = new Map();
  for (const sample of project.samples.filter(isExportable)) {
    const key = zoneKey(sample);
    if (!zones.has(key)) zones.set(key, []);
    zones.get(key).push(sample);
  }
  return [...zones.values()].map((zone) => zone.sort((a, b) => a.roundRobin - b.roundRobin));
}

export function autoMap(project) {
  for (const sample of project.samples) {
    sample.loNote = sample.hiNote = sample.loVel = sample.hiVel = null;
  }

  // Each mapping set (articulation, normal or release) is mapped on its own,
  // so e.g. a release sample on a key without a normal sample doesn't split
  // the normal samples' ranges.
  const sets = new Map();
  for (const sample of project.samples.filter(isExportable)) {
    const key = mappingSet(project, sample);
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(sample);
  }
  for (const samples of sets.values()) mapSet(samples);
}

// Auto-maps one mapping set of samples.
function mapSet(samples) {
  const layers = uniqueSorted(samples.map((s) => s.velocityLayer));

  layers.forEach((layer, index) => {
    const inLayer = samples.filter((s) => s.velocityLayer === layer);
    const [loVel, hiVel] = velocityRange(index, layers.length);
    const notes = uniqueSorted(inLayer.map((s) => s.fileNote));

    // "Stretch to nearest": each key plays the sample with the nearest root note.
    // The lowest sample stretches down to 0 and the highest up to 127.
    for (const sample of inLayer) {
      const i = notes.indexOf(sample.fileNote);
      sample.loNote = i === 0 ? 0 : splitPoint(notes[i - 1], notes[i]) + 1;
      sample.hiNote = i === notes.length - 1 ? 127 : splitPoint(notes[i], notes[i + 1]);
      sample.loVel = loVel;
      sample.hiVel = hiVel;
    }
  });
}

// The highest key that still belongs to the lower of two neighbouring root
// notes: halfway between them, e.g. 60 and 64 -> 62.
function splitPoint(lower, upper) {
  return Math.floor((lower + upper) / 2);
}

// Splits velocity 1–127 evenly. index 0 is the softest layer.
// 2 layers -> 1–63, 64–127. 3 layers -> 1–42, 43–84, 85–127.
function velocityRange(index, count) {
  const lo = Math.floor((index * 127) / count) + 1;
  const hi = Math.floor(((index + 1) * 127) / count);
  return [lo, hi];
}

function uniqueSorted(numbers) {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

// Re-picking the folder: `project.samples` holds the freshly read files and
// `previousSamples` the ones from before. Files are matched by path:
// - still there: keep their root note, key/velocity ranges and loop settings
//   (header info comes from the fresh read, in case the file was edited);
// - new, in a zone that already exists (e.g. another round-robin): copy that
//   zone's root note and ranges;
// - new, in a new zone: the ranges auto-map would give it, leaving the other
//   zones alone (so it may overlap them);
// - gone: dropped (they're simply not in the fresh list).
// Returns what happened, for the summary.
export function mergeSamples(project, previousSamples) {
  const previous = new Map(previousSamples.map((s) => [s.path, s]));
  const kept = new Map(); // zone key -> a kept sample in that zone
  const added = [];

  for (const sample of project.samples) {
    const old = previous.get(sample.path);
    if (old) {
      for (const key of KEPT_FIELDS) sample[key] = old[key];
      if (isExportable(sample)) kept.set(zoneKey(sample), sample);
    } else {
      added.push(sample);
    }
  }

  // Where auto-map would put everything, worked out on copies so nothing
  // already mapped changes.
  const copies = project.samples.map((s) => ({ ...s }));
  autoMap({ ...project, samples: copies });

  const newZones = new Set();
  for (const sample of added.filter(isExportable)) {
    const existing = kept.get(zoneKey(sample));
    const source = existing ?? copies[project.samples.indexOf(sample)];
    for (const key of ['rootNote', 'loNote', 'hiNote', 'loVel', 'hiVel']) sample[key] = source[key];
    if (!existing) newZones.add(zoneKey(sample));
  }

  const paths = new Set(project.samples.map((s) => s.path));
  return {
    kept: project.samples.length - added.length,
    added: added.length,
    newZones: [...newZones],
    removed: previousSamples.filter((s) => !paths.has(s.path)).map((s) => s.path),
  };
}

// After a name is marked or unmarked as release samples, or its articulation
// changes (so it's in a different mapping set): gives that name's samples
// the ranges auto-map would give them now, leaving every other zone (and
// root notes) as they are.
export function remapName(project, name) {
  const copies = project.samples.map((s) => ({ ...s }));
  autoMap({ ...project, samples: copies });
  project.samples.forEach((sample, i) => {
    if (sample.name !== name || !isExportable(sample)) return;
    for (const key of ['loNote', 'hiNote', 'loVel', 'hiVel']) sample[key] = copies[i][key];
  });
}

// What a sample keeps when the folder is re-picked.
const KEPT_FIELDS = ['rootNote', 'loNote', 'hiNote', 'loVel', 'hiVel', 'start', 'end', 'loopEnabled', 'loopStart', 'loopEnd', 'loopCrossfade'];
