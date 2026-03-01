// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── AudioContext Mock ────────────────────────────────────────────────────────

/** Number of AudioContext constructor calls since last reset. */
let constructorCallCount: number;

/** All instances created by the mock constructor, in order. */
let instances: Record<string, unknown>[];

function makeMockMethods() {
  return {
    createOscillator: vi.fn(() => ({
      connect: vi.fn(),
      frequency: { value: 0 },
      type: "sine" as OscillatorType,
      start: vi.fn(),
      stop: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    })),
  };
}

beforeEach(() => {
  vi.resetModules();
  constructorCallCount = 0;
  instances = [];

  // Use a regular function (not arrow) so `new AudioContext()` works
  globalThis.AudioContext = function MockAudioContext(this: Record<string, unknown>) {
    constructorCallCount++;
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
    Object.assign(this, makeMockMethods());
    instances.push(this);
  } as unknown as typeof AudioContext;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("playNewFileChime", () => {
  it("creates oscillator and gain nodes", async () => {
    const { playNewFileChime } = await import("../utils/sound");
    playNewFileChime();

    const ctx = instances[0];
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(ctx.createGain).toHaveBeenCalledTimes(2);
  });

  it("does not throw when AudioContext is unavailable", async () => {
    globalThis.AudioContext = function () {
      throw new Error("not supported");
    } as unknown as typeof AudioContext;

    const { playNewFileChime } = await import("../utils/sound");
    expect(() => playNewFileChime()).not.toThrow();
  });
});

describe("playConfirmChime", () => {
  it("creates oscillator and gain nodes", async () => {
    const { playConfirmChime } = await import("../utils/sound");
    playConfirmChime();

    const ctx = instances[0];
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
    expect(ctx.createGain).toHaveBeenCalledTimes(2);
  });

  it("does not throw when AudioContext is unavailable", async () => {
    globalThis.AudioContext = function () {
      throw new Error("not supported");
    } as unknown as typeof AudioContext;

    const { playConfirmChime } = await import("../utils/sound");
    expect(() => playConfirmChime()).not.toThrow();
  });
});

describe("shared AudioContext", () => {
  it("reuses the same AudioContext across multiple chime calls", async () => {
    const { playNewFileChime, playConfirmChime } = await import("../utils/sound");

    playNewFileChime();
    playNewFileChime();
    playConfirmChime();

    expect(constructorCallCount).toBe(1);
  });

  it("re-creates the AudioContext if the previous one was closed", async () => {
    const { playNewFileChime } = await import("../utils/sound");

    playNewFileChime();
    expect(constructorCallCount).toBe(1);

    // Mutate the actual instance held by the module
    instances[0].state = "closed";

    playNewFileChime();
    expect(constructorCallCount).toBe(2);
  });
});
