// The project data is the app's single source of truth. The .dspreset XML
// will be generated from it on export (step 4). Later steps add fields to
// each sample (e.g. loop points).

// The docs' default envelope curve shapes (-100 = log, 0 = linear, 100 = exp).
// Curves still at these values aren't exported.
export const CURVE_DEFAULTS = { attackCurve: -100, decayCurve: 100, releaseCurve: 100 };

export function createProject(folderName) {
  return {
    folderName,
    // How Decent Sampler picks between round-robins (docs: seqMode).
    roundRobinMode: 'round_robin',
    // Instrument volume, linear (docs: volume on <groups>, default 1.0).
    // Only exported when changed.
    volume: 1,
    // How much velocity affects loudness, 0–1 (docs: ampVelTrack). null means
    // not written, so Decent Sampler's own default applies.
    velocityTracking: null,
    // Instrument tuning in semitones and pan offset (−100 to 100) (docs:
    // globalTuning, globalPan on <groups>). Only exported when not 0.
    globalTuning: 0,
    globalPan: 0,
    // One amp envelope for the whole instrument (docs: attack, decay, sustain,
    // release on <groups>). Only exported when `enabled` is true. Times in
    // seconds, sustain 0–1. These names are what UI controls will bind to.
    envelope: { enabled: false, attack: 0, decay: 0, sustain: 1, release: 0.5, ...CURVE_DEFAULTS },
    // Instrument-wide effects in processing order, e.g.
    // { id: 'fx1', kind: 'filter', type: 'lowpass', frequency: 800, resonance: 0.7 }.
    effects: [],
    // Counter for effect ids, so an id is never reused after an effect is removed.
    nextEffectNumber: 1,
    // LFOs, e.g. { id: 'lfo1', kind: 'lfo', enabled: true, shape: 'sine',
    // frequency: 5, modAmount: 1, delayTime: 0, scope: 'global', targets:
    // [{ effectId: null, key: 'globalTuning', behavior: 'modulate', min: -0.2, max: 0.2 }] }.
    // See modulators.js.
    modulators: [],
    nextModulatorNumber: 1,
    // Decent Sampler's window (docs: <ui>), only exported when there are
    // controls. bgColor is 8-digit ARGB. Each control is e.g.
    // { kind: 'knob', effectId: 'fx1', key: 'frequency', label: 'Frequency',
    //   style: 'knob', minValue: 0, maxValue: 22000 }
    // or { kind: 'button', effectId: 'fx1', key: 'enabled' }.
    // effectId is the id of the effect or modulator (e.g. 'lfo1') the control
    // belongs to, or null for Global controls (volume, velocity tracking, tuning,
    // pan) and Amp envelope controls.
    // positions: null for the automatic layout, or each panel's dragged
    // position, keyed 'global', 'amp' or the effect id, e.g. { amp: { x: 8, y: 8 } }.
    ui: { bgColor: 'FF2A2A2A', controls: [], positions: null },
    // Sample names whose samples play when a key is released (docs: trigger
    // "release"), e.g. ['PianoRel']. They're exported in their own groups.
    releaseNames: [],
    // How much quieter a release sample gets per second the key was held, in
    // dB (docs: releaseTriggerDecay). null means not written (no decay).
    releaseDecay: null,
    // Release samples play to the end of the file instead of following the
    // instrument's amp envelope (docs: ampEnvEnabled="false" on their groups).
    releaseIgnoresEnvelope: false,
    // Choke groups by sample name, e.g. { HatOpen: 1, HatClosed: 1 }: samples
    // in the same group cut each other off (docs: tags, silencedByTags).
    chokeGroups: {},
    // How a cut-off sample stops: 'fast' (immediately, the docs' default),
    // 'normal' (the amp envelope's release; docs: silencingMode) or 'decay'
    // (a fade over chokeDecay seconds; docs: silencingDecay).
    chokeMode: 'fast',
    chokeDecay: 0.05,
    // Key switching: articulation number by sample name, e.g. { Sustain: 1,
    // Pizz: 2 }, and each articulation's keyswitch note, e.g. { 1: 24, 2: 25 }.
    // Names without an articulation always play. The lowest articulation used
    // is on when the preset loads.
    articulations: {},
    keyswitches: {},
    samples: [],
  };
}

// `info` is the result of readWavInfo, or null if the header wasn't read.
// `readError` explains why reading the header failed, or is null.
// `parsed` is the result of parseFilename, or null if it failed.
// `parseError` explains why the filename didn't match the format, or is null.
export function createSample({ path, sizeBytes, info, readError, parsed, parseError }) {
  return {
    path, // relative to the instrument folder, e.g. "Samples/Piano_C3_v1_rr1.wav"
    sizeBytes,
    sampleRate: info ? info.sampleRate : null,
    channels: info ? info.channels : null,
    bitDepth: info ? info.bitDepth : null,
    frames: info ? info.frames : null,
    readError,
    name: parsed ? parsed.name : null,
    rootNote: parsed ? parsed.rootNote : null, // can be changed in the grid
    fileNote: parsed ? parsed.rootNote : null, // the note in the filename; never changes
    velocityLayer: parsed ? parsed.velocityLayer : null,
    roundRobin: parsed ? parsed.roundRobin : null,
    parseError,
    // Key and velocity ranges, set by autoMap (mapping.js).
    loNote: null,
    hiNote: null,
    loVel: null,
    hiVel: null,
    // Trim in frames, set in the Trim and loop box (loops.js). null means the
    // file's own start/end, and nothing is exported.
    start: null,
    end: null,
    // Loop settings in frames, set in the Trim and loop box (loops.js).
    loopEnabled: false,
    loopStart: null,
    loopEnd: null,
    loopCrossfade: 0,
  };
}
