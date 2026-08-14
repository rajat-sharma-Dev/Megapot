/**
 * Sound.
 *
 * Every sound in this game is synthesised at runtime by the Web Audio API —
 * there is not one audio file in the repository. Synthesis gives us a boost roar
 * that can last exactly as long as the fuel does, ships nothing, and has no
 * licensing to get wrong.
 *
 * **The race has no continuous sound bed.** Two were built and both were cut;
 * the reasoning is at `startEngine()` and it is the most important thing in this
 * file. What a race sounds like is punctuation over silence — pickups, hits,
 * near misses, steals, the orb — plus the boost roar, which only happens when
 * the player asks for it and costs them fuel.
 *
 * Four rules the rest of the app relies on:
 *
 *  · Nothing is created until the first user gesture. Browsers refuse to start
 *    an AudioContext without one, and a context created too early sits
 *    permanently suspended — the classic "no sound until you reload" bug.
 *  · Every call is safe before the context exists. The UI should never have to
 *    ask whether audio is ready before making a noise.
 *  · Mute is a gain ramp, not a teardown, so muting mid-race doesn't leave a
 *    dangling loop running silently forever.
 *  · Effects and music are separate buses with separate switches, because people
 *    tire of them at very different rates.
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

/** Music sits well under the effects — it is a bed, not a soundtrack. */
const MUSIC_LEVEL = 0.32;

export class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private muted = false;
  private volume = 0.7;

  // There is no engine loop. See startEngine() for why.

  private sfxEnabled = true;
  private musicEnabled = true;

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
      this.sfxBus.gain.value = this.sfxEnabled ? 1 : 0;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicEnabled ? MUSIC_LEVEL : 0;
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

  /**
   * Silence effects or music independently of each other.
   *
   * Separate switches rather than one mute because they fail differently: a
   * looping music bed is the thing people get sick of on the tenth race, while
   * the effects are the game telling you what just happened and are worth
   * keeping. Making someone choose between all of it and none of it is what
   * leads to all of it being off.
   *
   * Ramped rather than set, so toggling mid-race doesn't click.
   */
  setSfxEnabled(on: boolean) {
    this.sfxEnabled = on;
    if (!on) this.setBoost(false);
    this.rampBus(this.sfxBus, on ? 1 : 0);
  }

  setMusicEnabled(on: boolean) {
    this.musicEnabled = on;
    if (!on) this.stopMusic();
    this.rampBus(this.musicBus, on ? MUSIC_LEVEL : 0);
  }

  private rampBus(bus: GainNode | null, to: number) {
    if (!this.ctx || !bus) return;
    const t = this.now();
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.linearRampToValueAtTime(to, t + MUTE_RAMP);
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
    if (!this.ensure() || this.muted || !this.sfxEnabled) return;
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
   * There is no continuous engine bed, and that is the design.
   *
   * Two versions of one were tried and both were rejected in playtesting. First
   * a sawtooth through a resonant lowpass — a real engine note, and genuinely
   * unpleasant: a saw holds a fixed pitch with a full harmonic stack sitting in
   * the ear's most sensitive band, so over seventy seconds it stops reading as
   * an engine and starts reading as a buzz. Then filtered noise, a wind rush
   * with no fundamental at all, which was the textbook fix. It was still
   * irritating.
   *
   * The conclusion is that the timbre was never the problem: an unbroken sound
   * held under a browser tab for seventy seconds is fatiguing whatever it is
   * made of. So the bed is gone. What is left is punctuation — pickups, hits,
   * near misses, steals, the orb — over silence, which makes each of them land
   * far harder than it did when competing with a drone. The only sustained
   * sound in a race is now the boost roar, and the player chooses when that
   * happens and pays fuel for it.
   *
   * These three methods are kept as no-ops rather than deleted so the race view
   * needs no conditional bookkeeping, and so the intent above survives next to
   * the code instead of only in a commit message.
   */
  startEngine() {
    /* Intentionally silent — see the note above. */
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setEngineSpeed(_speedRatio: number, _stunned = false) {
    /* Intentionally silent — see the note above. */
  }

  /** Tear down every sustained sound a race can leave running. */
  stopEngine() {
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
    if (!this.musicEnabled) return;
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
    if (!this.ctx || !this.musicBus || !this.musicEnabled) return;
    const t = this.now();
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(0.05, t + 0.15);
    this.musicBus.gain.linearRampToValueAtTime(this.musicEnabled ? MUSIC_LEVEL : 0, t + seconds);
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
