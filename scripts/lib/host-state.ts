// What the host was doing while a gate ran (lane harness-w41; docs/reviews/perf-near-limit.md, question c). The wave 39 gate ran on
// battery from 12:41 to 17:14, and `hir-tree` ran 3.5x slower and `mir` 2.8x. A timeout there can become a false protected loss, and so
// a STOP. So `scripts/gate.ts run` refuses to start on battery unless told otherwise, and records power, load and swap through the run.
// **Everything here is a report:** no status, loss or pass reads it, and a reader that fails gives `null`, never an error.
// No imports beyond node:, so unit tests can load it without scripts/lib/common.ts.
import { existsSync } from "node:fs";
import { loadavg } from "node:os";

export interface PowerState {
  /** As `pmset` prints it: `AC Power`, `Battery Power`, `UPS Power`. */
  source: string;
  /** Running on this machine's own battery. A desktop on a UPS is not: nothing there says it runs slower. */
  onBattery: boolean;
  /** Charge; null where there is no internal battery. */
  percent: number | null;
}

export interface HostSample {
  at: string;
  /** Null: no `pmset`, or it printed nothing this reads. */
  power: PowerState | null;
  /** 1, 5 and 15 minutes. */
  load: number[];
  /** Null: no `sysctl`, or it printed nothing this reads. */
  swapUsedMb: number | null;
}

/** Where a sample comes from; tests pass fakes, not an unplugged laptop. A reader's failure is `undefined`. */
export interface HostReaders {
  pmset(): Promise<string | undefined>;
  swapusage(): Promise<string | undefined>;
  load(): number[];
  now(): Date;
}

/** `pmset -g batt`: `Now drawing from 'AC Power'`, then, with a battery, ` -InternalBattery-0 (id=...)\t100%; charged; ...`. */
export function parsePower(text: string): PowerState | undefined {
  const source = /^Now drawing from '([^'\n]+)'/m.exec(text)?.[1];
  if (source === undefined) return undefined;
  const percent = /^\s*-InternalBattery\S*[^\n]*?\s(\d+)%;/m.exec(text)?.[1];
  return { source, onBattery: source === "Battery Power", percent: percent === undefined ? null : Number(percent) };
}

/** `sysctl -n vm.swapusage`: `total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)`. */
export function parseSwapUsedMb(text: string): number | undefined {
  const m = /\bused = ([\d.]+)([KMG])\b/.exec(text);
  if (m === null) return undefined;
  return Number(m[1]) * (m[2] === "G" ? 1024 : m[2] === "K" ? 1 / 1024 : 1);
}

/**
 * Stdout of a command given by absolute path; undefined if it is not there or fails. A command past `limitMs` is SIGKILLed, as
 * SIGTERM can be ignored, but a child of it can still hold stdout open, so `sampleHost` holds the limit on the whole read. Unref'd:
 * a read still running must not keep a finished gate alive.
 */
export async function commandOutput(cmd: string[], limitMs = 5_000): Promise<string | undefined> {
  if (!existsSync(cmd[0]!)) return undefined;
  try {
    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: limitMs, killSignal: "SIGKILL" });
    p.unref();
    const [text, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return code === 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export const REAL_HOST: HostReaders = {
  pmset: () => commandOutput(["/usr/bin/pmset", "-g", "batt"]),
  swapusage: () => commandOutput(["/usr/sbin/sysctl", "-n", "vm.swapusage"]),
  load: () => loadavg(),
  now: () => new Date(),
};

/** How long a sample waits for a reader; past `commandOutput`'s limit, so that a killed command is seen as failed first. */
const READ_LIMIT_MS = 6_000;

/**
 * One sample. Never throws or hangs, whatever a reader does: `gateRun` awaits samples between suites, so a reader that never
 * answered would stop the gate. The timer is kept referenced: it may be all that keeps the loop alive during such a read.
 */
export async function sampleHost(r: HostReaders, readLimitMs = READ_LIMIT_MS): Promise<HostSample> {
  const read = async (f: () => Promise<string | undefined>): Promise<string | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([f(), new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), readLimitMs); })]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };
  const [pmset, swap] = await Promise.all([read(() => r.pmset()), read(() => r.swapusage())]);
  return { at: r.now().toISOString(), power: pmset === undefined ? null : (parsePower(pmset) ?? null), load: r.load(), swapUsedMb: swap === undefined ? null : (parseSwapUsedMb(swap) ?? null) };
}

/** The refusal of a gate about to start: one line, no `ERROR:` (the caller's `die` adds it). Undefined on AC, or with no battery or `pmset` to ask. */
export function batteryRefusal(power: PowerState | null, allowBattery: boolean): string | undefined {
  if (!power?.onBattery || allowBattery) return undefined;
  const charge = power.percent === null ? "" : ` at ${power.percent}%`;
  return `this host is on battery${charge}, and a gate on battery runs up to 3.5x slower, so a timeout can become a false protected loss and a STOP (docs/reviews/perf-near-limit.md); plug it in, or pass --allow-battery`;
}

export interface HostLogOptions {
  /** How often to look at the power source. */
  pollMs: number;
  /** A poll's sample is kept if the power changed or this long has passed since the last one kept. */
  keepEveryMs: number;
  /** A `note:` line, as soon as power is lost or back. */
  note: (line: string) => void;
  /** `--allow-battery`: a run may start on battery, so a first reading on battery is not news. */
  allowBattery: boolean;
}

/** What gate.json keeps of a run (`host`). */
export interface HostRecord {
  allowBattery: boolean;
  /**
   * Each move to battery during the run, and, without `--allow-battery`, a first reading on battery: the refusal reads only one
   * sample, and it may have had no reading. Not a run started on battery with the flag.
   */
  powerLost: { at: string; percent: number | null }[];
  /** Polls and suite edges in time order; see `HostLogOptions.keepEveryMs`. */
  samples: HostSample[];
}

/** The run's record, kept in memory and written with gate.json, so that nothing here can write into the tree during a gate. */
export class HostLog {
  readonly samples: HostSample[] = [];
  readonly powerLost: { at: string; percent: number | null }[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private onBattery: boolean | undefined;
  private keptAt = -Infinity;

  constructor(
    private readonly readers: HostReaders,
    private readonly opts: HostLogOptions,
  ) {}

  /** Follows the power source; a sample with no reading says nothing about it. Whether the source changed. */
  private follow(s: HostSample): boolean {
    if (s.power === null) return false;
    const was = this.onBattery;
    this.onBattery = s.power.onBattery;
    if (was === s.power.onBattery) return false;
    if (was === undefined && (!s.power.onBattery || this.opts.allowBattery)) return false;
    const charge = s.power.percent === null ? "" : ` at ${s.power.percent}%`;
    if (s.power.onBattery) {
      this.powerLost.push({ at: s.at, percent: s.power.percent });
      this.opts.note(`note: power lost at ${s.at}: this gate now runs on battery${charge}, slower, and a timeout from here on may be false (\`host\` in gate.json)`);
    } else this.opts.note(`note: power back at ${s.at}${charge}`);
    return true;
  }

  private keep(s: HostSample): HostSample {
    this.samples.push(s);
    this.keptAt = Date.parse(s.at);
    return s;
  }

  /** A sample that is always kept: the run's and each suite's start and end. */
  async mark(): Promise<HostSample> {
    const s = await sampleHost(this.readers);
    this.follow(s);
    return this.keep(s);
  }

  /** One poll; the timer's body. Skipped while the last one is still reading. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const s = await sampleHost(this.readers);
      const changed = this.follow(s);
      if (changed || Date.parse(s.at) - this.keptAt >= this.opts.keepEveryMs) this.keep(s);
    } finally {
      this.polling = false;
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  record(allowBattery: boolean): HostRecord {
    return { allowBattery, powerLost: this.powerLost, samples: this.samples };
  }
}
