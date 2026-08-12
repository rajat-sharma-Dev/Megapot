/**
 * Sound.
 *
 * Every sound in this game is synthesised at runtime by the Web Audio API —
 * there is not one audio file in the repository. That is a deliberate trade:
 * a racing game needs an engine note that tracks speed and a boost that opens up
 * when you hold it, and a sampled loop can't do either without a pile of
 * crossfades. Synthesis gives us a continuously variable engine for a few dozen
 * lines, ships nothing, and has no licensing to get wrong.
 *
 * Three rules the rest of the app relies on:
 *
 *  · Nothing is created until the first user gesture. Browsers refuse to start
 *    an AudioContext without one, and a context created too early sits
 *    permanently suspended — the classic "no sound until you reload" bug.
 *  · Every call is safe before the context exists. The UI should never have to
 *    ask whether audio is ready before making a noise.
 *  · Mute is a master gain ramp, not a teardown, so muting mid-race doesn't
 *    leave a dangling engine oscillator running silently forever.
 */

export type SfxName =
  | 'click'
  | 'hover'
  | 'back'
  | 'confirm'
  | 'error'
  | 'cell'
  | 'fuel'
  | 'trap'
  | 'hit'
  | 'nearMiss'
  | 'orb'
  | 'steal'
  | 'stolen'
  | 'countdown'
  | 'go'
  | 'finish'
  | 'win'
  | 'lose'
  | 'ticket'
  | 'seatJoin'
  | 'lock';

type Ctx = AudioContext;

/** Fade applied when muting, long enough not to click, short enough to obey. */
const MUTE_RAMP = 0.08;

export class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private muted = false;
  private volume = 0.7;

  // Engine loop — a wind rush plus a sub hum. No oscillator drone; see startEngine.
  private engineSrc: AudioBufferSourceNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineSubGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  // Boost loop
  private boostSrc: AudioBufferSourceNode | null = null;
  private boostGain: GainNode | null = null;
  private boostFilter: BiquadFilterNode | null = null;

  // Music
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;
  private musicNextTime = 0;

  private noiseBuffer: AudioBuffer | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Create the context if we're allowed to, and resume it if the browser
   * suspended it. Safe to call on every interaction — it's a no-op once warm.
   */
  ensure(): boolean {
    if (typeof window === 'undefined') return false;

    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;

      try {
        this.ctx = new AC();
      } catch {
        return false;
      }

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
    }

    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx.state !== 'closed';
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : this.volume, t + MUTE_RAMP);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  isMuted() {
    return this.muted;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * A short burst of white noise, cached.
   *
   * Impacts, tyre scrub and the boost roar are all noise through different
   * filters — generating the buffer once and reusing it is both cheaper and
   * what makes them sound like they belong to the same machine.
   */
  private noise(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (this.noiseBuffer) return this.noiseBuffer;

    const len = Math.floor(this.ctx.sampleRate * 1.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  /** One enveloped oscillator. The workhorse behind most of the short sounds. */
  private tone(opts: {
    freq: number;
    to?: number;
    type?: OscillatorType;
    dur?: number;
    gain?: number;
    delay?: number;
    attack?: number;
    bus?: GainNode | null;
  }) {
    if (!this.ctx || !this.sfxBus) return;
    const {
      freq, to, type = 'sine', dur = 0.18, gain = 0.25, delay = 0, attack = 0.008,
    } = opts;

    const t0 = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g).connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** Filtered noise burst — impacts, whooshes, sparks. */
  private noiseBurst(opts: {
    dur?: number;
    gain?: number;
    freq?: number;
    q?: number;
    type?: BiquadFilterType;
    sweepTo?: number;
    delay?: number;
  }) {
    if (!this.ctx || !this.sfxBus) return;
    const buf = this.noise();
    if (!buf) return;

    const {
      dur = 0.2, gain = 0.2, freq = 1200, q = 1, type = 'bandpass', sweepTo, delay = 0,
    } = opts;
    const t0 = this.now() + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    if (sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    }

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ── One-shots ────────────────────────────────────────────────────────────

  play(name: SfxName, opts: { pitch?: number } = {}) {
    if (!this.ensure() || this.muted) return;
    const p = opts.pitch ?? 1;

    switch (name) {
      case 'click':
        this.tone({ freq: 660 * p, to: 880 * p, type: 'triangle', dur: 0.07, gain: 0.13 });
        break;
      case 'hover':
        this.tone({ freq: 1400 * p, type: 'sine', dur: 0.04, gain: 0.05 });
        break;
      case 'back':
        this.tone({ freq: 520, to: 330, type: 'triangle', dur: 0.1, gain: 0.12 });
        break;
      case 'confirm':
        this.tone({ freq: 587.33, type: 'triangle', dur: 0.1, gain: 0.16 });
        this.tone({ freq: 880, type: 'triangle', dur: 0.16, gain: 0.14, delay: 0.07 });
        break;
      case 'error':
        this.tone({ freq: 200, to: 120, type: 'sawtooth', dur: 0.26, gain: 0.16 });
        break;

      // A rising two-note blip: the sound of a number going up.
      case 'cell':
        this.tone({ freq: 880 * p, type: 'triangle', dur: 0.07, gain: 0.15 });
        this.tone({ freq: 1318.5 * p, type: 'triangle', dur: 0.11, gain: 0.13, delay: 0.05 });
        break;

      // Warmer and lower than a point cell, because fuel is a different kind of
      // good news and the ear should be able to tell them apart without looking.
      case 'fuel':
        this.tone({ freq: 330, to: 494, type: 'sine', dur: 0.2, gain: 0.2 });
        this.noiseBurst({ dur: 0.16, gain: 0.05, freq: 2600, sweepTo: 700 });
        break;

      // Falls, where everything good rises.
      case 'trap':
        this.tone({ freq: 420, to: 150, type: 'sawtooth', dur: 0.28, gain: 0.18 });
        break;

      case 'hit':
        this.noiseBurst({ dur: 0.3, gain: 0.34, freq: 900, sweepTo: 90, q: 0.7 });
        this.tone({ freq: 140, to: 48, type: 'sine', dur: 0.32, gain: 0.34 });
        break;

      case 'nearMiss':
        this.noiseBurst({ dur: 0.24, gain: 0.1, freq: 500, sweepTo: 3200, q: 3 });
        break;

      // Four notes of a bright major arpeggio — the only sound in the game that
      // gets to be triumphant mid-race.
      case 'orb':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.34, gain: 0.17, delay: i * 0.055 }),
        );
        this.noiseBurst({ dur: 0.5, gain: 0.06, freq: 3000, sweepTo: 8000, q: 2 });
        break;

      case 'steal':
        this.tone({ freq: 300, to: 1500, type: 'sawtooth', dur: 0.16, gain: 0.2 });
        this.noiseBurst({ dur: 0.12, gain: 0.12, freq: 4000, q: 4 });
        break;

      case 'stolen':
        this.tone({ freq: 900, to: 220, type: 'sawtooth', dur: 0.24, gain: 0.17 });
        break;

      case 'countdown':
        this.tone({ freq: 440 * p, type: 'square', dur: 0.12, gain: 0.16 });
        break;

      case 'go':
        this.tone({ freq: 880, type: 'square', dur: 0.35, gain: 0.22 });
        this.tone({ freq: 1760, type: 'triangle', dur: 0.3, gain: 0.1, delay: 0.02 });
        this.noiseBurst({ dur: 0.5, gain: 0.12, freq: 400, sweepTo: 6000, q: 1 });
        break;

      case 'finish':
        [659.25, 830.61, 987.77].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.15, delay: i * 0.04 }),
        );
        break;

      // A five-note fanfare. Long, loud, and completely unlike any other sound
      // here — winning the pot is the moment the whole game exists for.
      case 'win':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.7, gain: 0.19, delay: i * 0.09 }),
        );
        this.tone({ freq: 130.81, type: 'sine', dur: 1.2, gain: 0.22, delay: 0.36 });
        this.noiseBurst({ dur: 1.1, gain: 0.07, freq: 2000, sweepTo: 9000, q: 1.5, delay: 0.3 });
        break;

      case 'lose':
        [440, 392, 349.23, 293.66].forEach((f, i) =>
          this.tone({ freq: f, type: 'triangle', dur: 0.42, gain: 0.13, delay: i * 0.13 }),
        );
        break;

      // Metallic, high, and slow to decay — a ticket landing should sound
      // physically different from points landing.
      case 'ticket':
        [1046.5, 1567.98, 2093].forEach((f, i) =>
          this.tone({ freq: f, type: 'sine', dur: 1.4, gain: 0.13, delay: i * 0.06 }),
        );
        this.noiseBurst({ dur: 1.6, gain: 0.05, freq: 6000, sweepTo: 12000, q: 0.8 });
        break;

      case 'seatJoin':
        this.tone({ freq: 523.25 * p, type: 'triangle', dur: 0.13, gain: 0.15 });
        break;

      case 'lock':
        this.tone({ freq: 220, to: 110, type: 'square', dur: 0.2, gain: 0.18 });
        this.noiseBurst({ dur: 0.24, gain: 0.14, freq: 1600, sweepTo: 200, q: 1 });
        break;
    }
  }

  // ── Engine loop ──────────────────────────────────────────────────────────

  /**
   * Start the continuous engine bed.
   *
   * This used to be a sawtooth oscillator through a resonant lowpass — a real
   * engine note, and genuinely unpleasant. A saw drone holds a fixed pitch with
   * a full harmonic stack sitting right in the ear's most sensitive band, so
   * over a seventy-second race it stops reading as an engine and starts reading
   * as a buzz you want to turn off. Pitch tracking made it worse, not better:
   * the harmonics sweep with it and the whole thing whines.
   *
   * It is now a **wind rush** — filtered noise, no fundamental, nothing to lock
   * onto — plus a sub-bass hum well below where fatigue lives. Noise conveys
   * speed at least as well (it is what actually sells motion in racing games)
   * and can be listened to indefinitely. It also leaves the boost roar, which is
   * also noise but brighter and much louder, clearly distinguishable from it.
   *
   * Calling this twice is a no-op, so the race view can call it on every mount
   * without bookkeeping.
   */
  startEngine() {
    if (!this.ensure() || this.engineSrc || !this.ctx || !this.sfxBus) return;
    const buf = this.noise();
    if (!buf) return;

    const t = this.now();

    // The rush.
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.0001, t);
    this.engineGain.gain.exponentialRampToValueAtTime(0.04, t + 0.5);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    // Q stays low deliberately: a resonant peak here is a whistle, which is the
    // same problem as the saw in a different costume.
    this.engineFilter.Q.value = 0.6;
    this.engineFilter.frequency.value = 520;

    this.engineSrc = this.ctx.createBufferSource();
    this.engineSrc.buffer = buf;
    this.engineSrc.loop = true;
    this.engineSrc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
    this.engineSrc.start(t);

    // A sub hum for weight. Low enough to be felt rather than heard, and quiet
    // enough that a laptop speaker mostly won't reproduce it at all.
    this.engineSubGain = this.ctx.createGain();
    this.engineSubGain.gain.setValueAtTime(0.0001, t);
    this.engineSubGain.gain.exponentialRampToValueAtTime(0.022, t + 0.6);

    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = 'sine';
    this.engineSub.frequency.value = 46;
    this.engineSub.connect(this.engineSubGain).connect(this.sfxBus);
    this.engineSub.start(t);
  }

  /**
   * Track the car.
   *
   * @param speedRatio current speed over base speed — 1 is cruising, 1.7 is a
   *                   full boost, below 1 is a stun.
   * @param stunned    closes the filter right down, so a hit is audible as a
   *                   sudden loss of air as well as visible.
   */
  setEngineSpeed(speedRatio: number, stunned = false) {
    if (!this.ctx || !this.engineFilter || !this.engineGain) return;
    const r = Math.max(0.2, Math.min(2.2, speedRatio));
    const t = this.now();

    // setTargetAtTime rather than a ramp: this is called 60 times a second and
    // needs to glide, not to schedule 60 competing ramps.
    this.engineFilter.frequency.setTargetAtTime(stunned ? 240 : 300 + r * 1250, t, 0.09);
    // Volume rides with speed too — standing still should be near-silent.
    this.engineGain.gain.setTargetAtTime(stunned ? 0.018 : 0.012 + r * 0.032, t, 0.12);
    this.engineSub?.frequency.setTargetAtTime(38 + r * 20, t, 0.1);
  }

  stopEngine() {
    if (!this.ctx) return;
    const t = this.now();

    for (const g of [this.engineGain, this.engineSubGain]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    }

    try {
      this.engineSrc?.stop(t + 0.35);
      this.engineSub?.stop(t + 0.35);
    } catch {
      // Already stopped — harmless.
    }

    this.engineSrc = null;
    this.engineSub = null;
    this.engineSubGain = null;
    this.engineGain = null;
    this.engineFilter = null;

    this.setBoost(false);
  }

  // ── Boost loop ───────────────────────────────────────────────────────────

  /**
   * The boost roar: looping noise through a resonant bandpass that opens while
   * held. Held rather than triggered, because boost in this game is a tank you
   * spend, not a button you tap — the sound has to be able to last as long as
   * the fuel does.
   */
  setBoost(on: boolean) {
    if (!this.ensure() || !this.ctx || !this.sfxBus) return;
    const t = this.now();

    if (on) {
      if (this.boostSrc) return;
      const buf = this.noise();
      if (!buf) return;

      this.boostSrc = this.ctx.createBufferSource();
      this.boostSrc.buffer = buf;
      this.boostSrc.loop = true;

      this.boostFilter = this.ctx.createBiquadFilter();
      this.boostFilter.type = 'bandpass';
      this.boostFilter.frequency.setValueAtTime(400, t);
      this.boostFilter.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
      this.boostFilter.Q.value = 1.4;

      this.boostGain = this.ctx.createGain();
      this.boostGain.gain.setValueAtTime(0.0001, t);
      this.boostGain.gain.exponentialRampToValueAtTime(0.16, t + 0.08);

      this.boostSrc.connect(this.boostFilter).connect(this.boostGain).connect(this.sfxBus);
      this.boostSrc.start(t);
    } else {
      if (!this.boostSrc) return;
      const src = this.boostSrc;
      const gain = this.boostGain;
      this.boostSrc = null;
      this.boostGain = null;
      this.boostFilter = null;

      gain?.gain.cancelScheduledValues(t);
      gain?.gain.setValueAtTime(gain.gain.value || 0.0001, t);
      gain?.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      try {
        src.stop(t + 0.22);
      } catch {
        // Already stopped — harmless.
      }
    }
  }

  // ── Music bed ────────────────────────────────────────────────────────────

  /**
   * A sixteen-step arpeggio over a two-chord loop, scheduled a beat ahead.
   *
   * Scheduled with `setInterval` feeding absolute AudioContext times rather than
   * playing notes on the timer itself: a JS timer drifts by tens of milliseconds
   * under load, which on a rhythmic loop is instantly audible, whereas the audio
   * clock does not drift at all.
   */
  startMusic() {
    if (!this.ensure() || this.musicTimer || !this.ctx) return;

    this.musicStep = 0;
    this.musicNextTime = this.now() + 0.1;

    const STEP = 0.14;
    const CHORDS = [
      [146.83, 220, 293.66, 349.23], // Dm
      [130.81, 196, 261.63, 329.63], // Cmaj
      [174.61, 261.63, 349.23, 440], // Fmaj
      [110, 164.81, 220, 277.18], // Am
    ];

    const schedule = () => {
      if (!this.ctx || !this.musicBus) return;
      const horizon = this.now() + 0.35;

      while (this.musicNextTime < horizon) {
        const step = this.musicStep;
        const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
        const t = this.musicNextTime;

        // Arpeggio voice.
        const note = chord[step % chord.length] * (step % 8 >= 4 ? 2 : 1);
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1800;
        osc.type = 'triangle';
        osc.frequency.value = note;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 1.6);
        osc.connect(f).connect(g).connect(this.musicBus);
        osc.start(t);
        osc.stop(t + STEP * 2);

        // Bass on the downbeat.
        if (step % 4 === 0) {
          const b = this.ctx.createOscillator();
          const bg = this.ctx.createGain();
          b.type = 'sine';
          b.frequency.setValueAtTime(chord[0] / 2, t);
          bg.gain.setValueAtTime(0.0001, t);
          bg.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
          bg.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 3);
          b.connect(bg).connect(this.musicBus);
          b.start(t);
          b.stop(t + STEP * 3.2);
        }

        this.musicNextTime += STEP;
        this.musicStep = (step + 1) % 32;
      }
    };

    schedule();
    this.musicTimer = setInterval(schedule, 120);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  /** Duck the music under a moment that needs the room — a win, a ticket. */
  duckMusic(seconds = 2) {
    if (!this.ctx || !this.musicBus) return;
    const t = this.now();
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.05, t + 0.15);
    this.musicBus.gain.linearRampToValueAtTime(0.32, t + seconds);
  }

  /** Tear everything down. Called when the provider unmounts. */
  dispose() {
    this.stopMusic();
    this.stopEngine();
    try {
      void this.ctx?.close();
    } catch {
      // Closing an already-closed context throws in some browsers.
    }
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;
  }
}

/**
 * One engine for the whole app, on `globalThis` so a hot reload doesn't leave a
 * second AudioContext running alongside the first.
 */
const g = globalThis as unknown as { __rallySfx?: SoundEngine };
export const sfx: SoundEngine = (g.__rallySfx ??= new SoundEngine());
