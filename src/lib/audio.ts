// Contexto de áudio singleton — criado uma vez e reutilizado
// O desbloqueio acontece no primeiro clique/toque do usuário
let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx) {
    _ctx = new ((window as any).AudioContext || (window as any).webkitAudioContext)();
  }
  return _ctx;
}

// Chame isso em qualquer gesto do usuário (click, touchstart)
// para garantir que o contexto esteja ativo quando um pedido chegar
export function unlockAudio() {
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
  } catch {}
}

function scheduleBeeps(ctx: AudioContext, freqs: number[], interval: number, vol = 0.28) {
  freqs.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * interval;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.55);
  });
}

// Beep simples para alertas do menu lateral (2 tons curtos)
export function playAlertBeep() {
  try {
    const ctx = getCtx();
    const play = () => scheduleBeeps(ctx, [880, 1100], 0.18);
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch {}
}

// Alarme completo para a aba do cardápio digital (acorde C5-E5-G5 × 2)
export function playOrderAlarm() {
  try {
    const ctx = getCtx();
    const play = () => {
      const notes = [523, 659, 784];
      notes.forEach((f, i) => {
        [1, 2].forEach((mult, hi) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.value = f * mult;
          const t = ctx.currentTime + i * 0.21;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.32 / (hi + 1), t + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.start(t);
          osc.stop(t + 0.6);
        });
      });
      // Segunda frase
      const t2 = ctx.currentTime + 0.85;
      [523, 659, 784].forEach((f, i) => {
        [1, 2].forEach((mult, hi) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.value = f * mult;
          const t = t2 + i * 0.21;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.32 / (hi + 1), t + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          osc.start(t);
          osc.stop(t + 0.6);
        });
      });
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
    } else {
      play();
    }
  } catch {}
}
