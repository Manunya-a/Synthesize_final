
(function () {
  'use strict';

  const App = window.App;
  const cfg = App.config;

  const engine = (App.engine = {
    ctx: null,        // AudioContext (появляется после ensure())
    channels: {},     // { 'ch-s1': { input, panner, volume, analyser }, ... }
    fx: {},           // узлы эффектов
    bus: null,        // общая шина
    shelf: null,      // фильтр низких частот (его поднимает «Изнанка»)
    master: null,     // общая громкость
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* Плавно перевести параметр к новому значению (без щелчков) */
  function ramp(param, value, speed) {
    param.setTargetAtTime(value, engine.ctx.currentTime, speed || 0.03);
  }


  
  engine.ensure = function () {
    if (!engine.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      engine.ctx = new Ctx();
      build();
      engine.applyAll();
    }
    if (engine.ctx.state === 'suspended') engine.ctx.resume();
    return engine.ctx;
  };

  function build() {
    const ctx = engine.ctx;

    /* --- каналы --- */
    cfg.TRACKS.forEach((t) => {
      if (engine.channels[t.channel]) return;
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      const volume = ctx.createGain();
      const analyser = ctx.createAnalyser();    
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      input.connect(panner);
      panner.connect(volume);
      volume.connect(analyser);
      engine.channels[t.channel] = { input, panner, volume, analyser };
    });

    /* --- шина и фильтр низких частот --- */
    engine.bus = ctx.createGain();
    engine.shelf = ctx.createBiquadFilter();
    engine.shelf.type = 'lowshelf';
    engine.shelf.frequency.value = 160;
    Object.values(engine.channels).forEach((ch) => ch.volume.connect(engine.bus));
    engine.bus.connect(engine.shelf);

    /* --- эффекты по порядку --- */
    let tail = engine.shelf;
    tail = buildDistortion(ctx, tail);
    tail = buildDelay(ctx, tail);
    tail = buildReverb(ctx, tail);
    tail = buildGlitch(ctx, tail);

    /* --- выход: общая громкость → лимитер → колонки --- */
    engine.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    tail.connect(engine.master);
    engine.master.connect(limiter);
    limiter.connect(ctx.destination);
  }

  /* Эффект «сухой + мокрый»: dry — оригинал, wet — обработанный звук. Возвращает выход. */
  function mixStage(ctx, input) {
    const out = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    input.connect(dry);
    dry.connect(out);
    wet.connect(out);
    return { out, dry, wet };
  }

  /* DISTORTION: звук пропускается через «изогнутую» кривую — вершины волны срезаются */
  function buildDistortion(ctx, input) {
    const stage = mixStage(ctx, input);
    const pre = ctx.createGain();
    pre.gain.value = 2.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    const tone = ctx.createBiquadFilter();     
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    input.connect(pre);
    pre.connect(shaper);
    shaper.connect(tone);
    tone.connect(stage.wet);
    engine.fx['fx-distortion'] = { dry: stage.dry, wet: stage.wet };
    return stage.out;
  }

  
  function buildDelay(ctx, input) {
    const stage = mixStage(ctx, input);
    const delay = ctx.createDelay(2);
    const feedback = ctx.createGain();
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 1800;
    input.connect(delay);
    delay.connect(dark);
    dark.connect(feedback);
    feedback.connect(delay);                   
    dark.connect(stage.wet);
    engine.fx['fx-delay'] = { dry: stage.dry, wet: stage.wet, delay, feedback };
    return stage.out;
  }

  /* REVERB: «комната». ConvolverNode умножает звук на импульс — затухающий шум */
  function buildReverb(ctx, input) {
    const stage = mixStage(ctx, input);
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 3.2, 2.6);
    input.connect(convolver);
    convolver.connect(stage.wet);
    engine.fx['fx-reverb'] = { dry: stage.dry, wet: stage.wet };
    return stage.out;
  }

  /** Импульс комнаты: шум, который затихает; чем дальше — тем он темнее (как в настоящей комнате) */
  function makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const k = 0.55 - 0.45 * t;              
        lp += k * ((Math.random() * 2 - 1) - lp);
        data[i] = lp * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  /* GLITCH: быстрый «рубильник» громкости. Квадратная волна LFO то открывает, то закрывает звук */
  function buildGlitch(ctx, input) {
    const gate = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.value = 8;
    lfo.connect(depth);
    depth.connect(gate.gain);                   
    lfo.start();
    input.connect(gate);
    engine.fx['fx-glitch'] = { gate, lfo, depth };
    return gate;
  }



  /** Сколько эффекта реально звучит: учитывает выключатель и режим мира/изнанки */
  engine.effectiveAmount = function (id) {
    const s = App.state[id];
    if (!s.on) return 0;
    const m = cfg.MODES[App.state.mode].fx[id];
    return clamp(s.amount * m.mul + m.add, 0, 1);
  };

  function applyFx(id) {
    if (!engine.ctx) return;
    const a = engine.effectiveAmount(id);
    const f = engine.fx[id];
    if (id === 'fx-distortion') {
      ramp(f.wet.gain, a * 0.55);
      ramp(f.dry.gain, 1 - a * 0.45);
    } else if (id === 'fx-delay') {
      ramp(f.wet.gain, a * 0.75);
      ramp(f.feedback.gain, a > 0 ? 0.28 + a * 0.3 : 0);
    } else if (id === 'fx-reverb') {
      ramp(f.wet.gain, a * 1.1);
      ramp(f.dry.gain, 1 - a * 0.25);
    } else if (id === 'fx-glitch') {
      // gate.gain колеблется между (1 − a) и 1
      ramp(f.gate.gain, 1 - a / 2);
      ramp(f.depth.gain, a / 2);
    }
  }

  
  function applyTempo() {
    if (!engine.ctx) return;
    const beat = 60 / App.state.tempo;
    ramp(engine.fx['fx-delay'].delay.delayTime, beat * 0.75, 0.05);
    ramp(engine.fx['fx-glitch'].lfo.frequency, 4 / beat * 0.5, 0.05);   
  }

  function applyMaster() {
    if (!engine.ctx) return;
    const v = App.state.muted ? 0 : App.state.master;
    ramp(engine.master.gain, v * v * 1.2, 0.04);
  }

  function applyChannel(id) {
    if (!engine.ctx) return;
    const s = App.state[id];
    const ch = engine.channels[id];
    const boost = id === 'ch-s2' ? cfg.MODES[App.state.mode].bass : 1;   
    ramp(ch.volume.gain, s.volume * s.volume * 1.5 * boost);
    ramp(ch.panner.pan, (s.pan - 0.5) * 2);
  }

  
  engine.applyParam = function (path) {
    if (!engine.ctx) return;                    
    const [head] = path.split('.');
    if (head === 'tempo') applyTempo();
    else if (head === 'master') applyMaster();
    else if (head.indexOf('ch-') === 0) applyChannel(head);
    else if (head.indexOf('fx-') === 0) applyFx(head);
  };

  engine.applyAll = function () {
    if (!engine.ctx) return;
    applyMaster();
    applyTempo();
    Object.keys(engine.channels).forEach(applyChannel);
    ['fx-distortion', 'fx-delay', 'fx-reverb', 'fx-glitch'].forEach(applyFx);
    ramp(engine.shelf.gain, cfg.MODES[App.state.mode].shelfDb, 0.25);
  };


  engine.applyMode = function () {
    engine.applyAll();
  };

  const buffers = {};
  engine.getLevel = function (channelId) {
    const ch = engine.channels[channelId];
    if (!ch) return 0;
    const data = buffers[channelId] || (buffers[channelId] = new Float32Array(ch.analyser.fftSize));
    ch.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    return clamp(peak * 2.4, 0, 1);
  };
})();
