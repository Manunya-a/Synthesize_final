
(function () {
  'use strict';

  const App = window.App;
  const cfg = App.config;
  const engine = App.engine;
  const voices = App.voices;
  const music = App.music;

  const seq = (App.sequencer = {
    timer: null,
    step: 0,     
    total: 0,           
    nextTime: 0,       
    queue: [],         
  });

  function bassIsE(total) {
    return Math.floor(total / cfg.STEPS) % 2 === 1;
  }

  function arpMidi(cycleIndex, total, octaveUp) {
    let midi = music.noteToMidi(cfg.ARP_CYCLE[cycleIndex % cfg.ARP_CYCLE.length]);
    if (bassIsE(total) && midi % 12 === 0) midi -= 1;
    return midi + (octaveUp ? 12 : 0) + cfg.MODES[App.state.mode].octave;   
  }

  function sweepAt(total) {
    const phase = (total / cfg.STEPS / cfg.SWEEP_BARS) % 1;
    return 0.45 + 1.15 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
  }

  function triggerTrack(track, step, cell, time, stepDur, total) {
    if (!cell) return null;
    if (track === 's1') {
      const idx = step + cfg.S1_EXTRA_OFFSET[cell];
      voices.playSynth('synth1', arpMidi(idx, total, true), time, stepDur * 0.8, cfg.S1_EXTRA_VELOCITY[cell], sweepAt(total));
      return 'synth1';
    }
    if (track === 's2') {
      voices.playSynth('synth2', music.noteToMidi(cfg.S2_NOTES[cell]), time, stepDur * 1.8, 0.8, 1);
      return 'synth2';
    }
    const vel = cfg.DRUM_VELOCITY[cell];
    if (track === 'kick') voices.playKick(time, vel);
    if (track === 'snare') voices.playSnare(time, vel);
    if (track === 'hat') voices.playHat(time, vel);
    return 'drums';
  }


  function playMain(step, time, stepDur, total) {
    const accent = cfg.ARP_ACCENT_STEPS.indexOf(step) >= 0;
    voices.playSynth('synth1', arpMidi(step, total, false), time, stepDur * 0.9,
      accent ? 1 : 0.8, (accent ? 1.35 : 1) * sweepAt(total));

    if (step % 8 === 0) {                                       
      const note = cfg.MAIN_BASS[bassIsE(total) ? 1 : 0];
      voices.playSynth('synth2', music.noteToMidi(note), time, stepDur * 7, 1, 1);
    }
    const kick = cfg.MAIN_KICK[step];
    if (kick) voices.playKick(time, kick);
  }



  function stepDuration() {
    return 60 / App.state.tempo / 4;
  }

  function scheduleStep(step, time) {
    const stepDur = stepDuration();
    const hits = ['synth1'];
    playMain(step, time, stepDur, seq.total);
    if (step % 8 === 0) hits.push('synth2');
    if (cfg.MAIN_KICK[step]) hits.push('drums');
    cfg.TRACKS.forEach((t) => {
      const cell = App.state.pattern[t.id][step];
      const source = triggerTrack(t.id, step, cell, time, stepDur, seq.total);
      if (source && hits.indexOf(source) < 0) hits.push(source);
    });
    seq.queue.push({ time, step, hits });
  }

  function tick() {
    const ctx = engine.ctx;
    while (seq.nextTime < ctx.currentTime + cfg.LOOKAHEAD) {
      scheduleStep(seq.step, seq.nextTime);
      seq.nextTime += stepDuration();
      seq.step = (seq.step + 1) % cfg.STEPS;
      seq.total += 1;
    }
  }

 

  seq.start = function () {
    if (App.state.playing) return;
    const ctx = engine.ensure();
    seq.step = 0;
    seq.total = 0;
    seq.queue = [];
    seq.nextTime = ctx.currentTime + 0.06;
    App.state.playing = true;
    tick();
    seq.timer = setInterval(tick, cfg.TIMER_MS);
  };

  seq.stop = function () {
    if (!App.state.playing) return;
    clearInterval(seq.timer);
    seq.timer = null;
    seq.queue = [];
    App.state.playing = false;
  };

  seq.toggle = function () {
    if (App.state.playing) seq.stop();
    else seq.start();
    return App.state.playing;
  };


  seq.clear = function () {
    App.state.pattern = {};
    cfg.TRACKS.forEach((t) => { App.state.pattern[t.id] = new Array(cfg.STEPS).fill(0); });
  };

  seq.preview = function (track, step, cell) {
    const ctx = engine.ensure();
    return triggerTrack(track, step, cell, ctx.currentTime + 0.01, stepDuration(), 0);
  };

  seq.consumeDue = function (now) {
    const due = [];
    while (seq.queue.length && seq.queue[0].time <= now) due.push(seq.queue.shift());
    return due;
  };
})();
