/**
 * Plays a short rising two-tone chime (new file detected).
 * Safe to call even if audio is unavailable — errors are silently ignored.
 */
export function playNewFileChime(): void {
  try {
    const ctx = new AudioContext();

    const playTone = (freq: number, startTime: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    };

    playTone(880, ctx.currentTime);
    playTone(1100, ctx.currentTime + 0.15);
  } catch {
    // Audio not available — ignore
  }
}

/**
 * Plays a descending two-tone alert (file may be open — confirm delete).
 * Distinct from the rising new-file chime so the user can tell them apart.
 */
export function playConfirmChime(): void {
  try {
    const ctx = new AudioContext();

    const playTone = (freq: number, startTime: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.35, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      osc.start(startTime);
      osc.stop(startTime + 0.3);
    };

    playTone(660, ctx.currentTime);
    playTone(440, ctx.currentTime + 0.15);
  } catch {
    // Audio not available — ignore
  }
}
