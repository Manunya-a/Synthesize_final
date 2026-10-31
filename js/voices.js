/* ==========================================================================
   voices.js — «музыканты»: как звучит одна нота Synth 1 / Synth 2 и каждый барабан.
   Каждый вызов создаёт новые одноразовые узлы, которые сами удаляются после звука.
   Время (time) — секунды по часам AudioContext, поэтому ноты попадают точно в долю.
   ========================================================================== */
(function () {
  'use strict';

  const App = window.App;
  const cfg = App.config;
  const engine = App.engine;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- синтезаторы ---------- */

  /**
   * Сыграть одну ноту синтезатора.
   * @param {string} source  'synth1' или 'synth2'
   * @param {number} midi    номер ноты
   * @param {number} time    когда начать (секунды AudioContext)
   * @param {number} dur     как долго держать (секунды)
   * @param {number} vel     громкость 0…1
   * @param {number} bright  множитель яркости (акцент + «качание» фильтра)
   */
  function playSynth(source, midi, time, dur, vel, bright) {
    const ctx = engine.ctx;
    const voice = cfg.VOICE[source];
    const settings = App.state[source];                  // волна, атака, затухание
    const mode = cfg.MODES[App.state.mode];
    const channelId = source === 'synth1' ? 'ch-s1' : 'ch-s2';
    const freq = App.music.midiToFreq(midi);

    /* Два генератора с лёгкой расстройкой — звук «плавает», как у аналоговых синтов */
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = oscB.type = settings.wave;
    oscA.frequency.value = oscB.frequency.value = freq;
    oscA.detune.value = -voice.detune;
    oscB.detune.value = voice.detune;

    /* Фильтр (спрятан от пользователя): срезает яркие верха, «щипок» в начале ноты */
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = voice.q;
    const keyed = Math.pow(freq / 130.8, voice.keytrack);           // высокие ноты чуть ярче
    const base = clamp(voice.cutoff * mode.cutoff * keyed * (bright || 1), 90, 14000);
    const peak = clamp(base * voice.pluck, 90, 16000);
    filter.frequency.setValueAtTime(peak, time);
    filter.frequency.exponentialRampToValueAtTime(base, time + voice.pluckTime);

    /* Огибающая громкости: attack (нарастание) → держим → release (затухание) */
    const attack = Math.min(0.004 + settings.attack * settings.attack * 0.8, dur * 0.9);
    const release = 0.05 + settings.release * settings.release * 1.8;
    const level = voice.level * vel;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(level, time + attack);

    let held = level;                                               // громкость в момент отпускания
    if (voice.decay > 0) {                                          // бас: после щипка немного оседает
      const target = level * voice.sustain;
      const tau = voice.decay / 3;
      env.gain.setTargetAtTime(target, time + attack, tau);
      held = target + (level - target) * Math.exp(-(dur - attack) / tau);
    }
    env.gain.setValueAtTime(Math.max(held, 0.0002), time + dur);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur + release);

    oscA.connect(filter);
    oscB.connect(filter);

    /* Бас в «Изнанке» получает чистый синус для веса */
    let sub = null;
    if (source === 'synth2' && mode.sub > 0) {
      sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq;
      const subGain = ctx.createGain();
      subGain.gain.value = mode.sub;
      sub.connect(subGain);
      subGain.connect(filter);
    }

    filter.connect(env);
    env.connect(engine.channels[channelId].input);

    const end = time + dur + release + 0.05;
    [oscA, oscB, sub].forEach((o) => {
      if (!o) return;
      o.start(time);
      o.stop(end);
    });
    oscA.onended = () => {                                          // чистим за собой
      [oscA, oscB, sub, filter, env].forEach((n) => n && n.disconnect());
    };
  }

  /* ---------- барабаны ---------- */

  /* Белый шум — основа малого барабана и тарелки. Один буфер на всех. */
  let noiseBuffer = null;
  function getNoise() {
    if (!noiseBuffer) {
      const ctx = engine.ctx;
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function noiseSource(time, dur) {
    const src = engine.ctx.createBufferSource();
    src.buffer = getNoise();
    src.start(time, Math.random() * 0.5);
    src.stop(time + dur);
    return src;
  }

  /* KICK: синус, частота быстро падает со 115 до 44 Гц — мягкий «тук», как сердцебиение */
  function playKick(time, vel) {
    const ctx = engine.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const volume = vel * App.state.drums.kick;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(115, time);
    osc.frequency.exponentialRampToValueAtTime(44, time + 0.12);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.9 * volume, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    osc.connect(env);
    env.connect(engine.channels['ch-dr'].input);
    osc.start(time);
    osc.stop(time + 0.45);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  /* SNARE: шум через полосовой фильтр + короткий тон барабана */
  function playSnare(time, vel) {
    const ctx = engine.ctx;
    const volume = vel * App.state.drums.snare;
    const out = engine.channels['ch-dr'].input;

    const noise = noiseSource(time, 0.25);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 0.8;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(0.0001, time);
    nEnv.gain.linearRampToValueAtTime(0.55 * volume, time + 0.003);
    nEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    noise.connect(band);
    band.connect(nEnv);
    nEnv.connect(out);

    const tone = ctx.createOscillator();
    const tEnv = ctx.createGain();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(200, time);
    tone.frequency.exponentialRampToValueAtTime(130, time + 0.09);
    tEnv.gain.setValueAtTime(0.0001, time);
    tEnv.gain.linearRampToValueAtTime(0.4 * volume, time + 0.003);
    tEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    tone.connect(tEnv);
    tEnv.connect(out);
    tone.start(time);
    tone.stop(time + 0.14);
    noise.onended = () => { [noise, band, nEnv, tone, tEnv].forEach((n) => n.disconnect()); };
  }

  /* HAT: шум, у которого оставлены только самые высокие частоты, и очень короткий */
  function playHat(time, vel) {
    const ctx = engine.ctx;
    const volume = vel * App.state.drums.hat;
    const noise = noiseSource(time, 0.08);
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 7200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.32 * volume, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    noise.connect(high);
    high.connect(env);
    env.connect(engine.channels['ch-dr'].input);
    noise.onended = () => { [noise, high, env].forEach((n) => n.disconnect()); };
  }

  App.voices = { playSynth, playKick, playSnare, playHat };
})();
