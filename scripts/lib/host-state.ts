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
 * SIGTERM can be ignored, but a child of it can still hold stdout open, so `sampleHost` holds the limit on the whole read. Unref'd,
 * so a read whose command has gone but whose stdout is held does not keep a finished gate alive; a live command can, up to the limit.
 */
export async function commandOutput(cmd: string[], limitMs = 5_000): Promise<string | undefined> {
  if (!existsSync(cmd[0]!)) return undefined;
  try {
    const p = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: limitMs, killSignal: "SIGKILL" });
    p.unref();
    // Bun's own timeout dies with this process, so a `process.exit` during a read would leave the command behind (review harness-w41 N1).
    const killAtExit = () => p.kill("SIGKILL");
    process.on("exit", killAtExit);
    void p.exited.finally(() => process.off("exit", killAtExit));
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
 * The readers with a read still unsettled past the limit (review root-w40-check F2). A command stuck past SIGKILL, or whose child holds
 * its stdout, is a process and a descriptor that outlive the gate: started again on every sample they reach the per-user process limit
 * across about 3 gates without a reboot, each mark waits out the limit, and nothing says so. So such a reader is not started again until
 * that read settles, and one `note:` says so. Past the limit only: a mark can overlap a healthy poll, and must still get its own reading.
 * That leaves at most two reads of a reader per gate, the two that overlapped as it stuck. Report only, like the rest of this file.
 */
export class StuckReads {
  private readonly past = new Map<string, number>();
  private readonly noted = new Set<string>();

  constructor(private readonly note: (line: string) => void) {}

  isStuck(reader: string): boolean {
    return (this.past.get(reader) ?? 0) > 0;
  }

  pastLimit(reader: string, reading: Promise<unknown>, limitMs: number): void {
    this.past.set(reader, (this.past.get(reader) ?? 0) + 1);
    const settled = () => void this.past.set(reader, this.past.get(reader)! - 1);
    reading.then(settled, settled);
    if (this.noted.has(reader)) return;
    this.noted.add(reader);
    this.note(`note: host reader ${reader} is stuck: a read has not ended ${limitMs / 1000} s after it started, so it is not started again until it does, and gate.json has null for it. A process stuck past SIGKILL lasts until a reboot: check \`ps\`, and reboot before the next gate if it is there`);
  }
}

/**
 * One sample. Never throws or hangs, whatever a reader does: `gateRun` awaits samples between suites, so a reader that never
 * answered would stop the gate. The timer is kept referenced: the gate's top-level await does not need that today, but a caller
 * without one would otherwise exit silently, 0 and with no gate.json, during such a read.
 */
export async function sampleHost(r: HostReaders, readLimitMs = READ_LIMIT_MS, stuck?: StuckReads): Promise<HostSample> {
  const read = async (reader: "pmset" | "swapusage"): Promise<string | undefined> => {
    if (stuck?.isStuck(reader)) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reading = r[reader]();
      return await Promise.race([
        reading,
        new Promise<undefined>((res) => {
          timer = setTimeout(() => {
            stuck?.pastLimit(reader, reading, readLimitMs);
            res(undefined);
          }, readLimitMs);
        }),
      ]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  };
  const [pmset, swap] = await Promise.all([read("pmset"), read("swapusage")]);
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
  /** Whether the reading `gateRun` took before this log was on battery; undefined if it had none. */
  firstOnBattery: boolean | undefined;
  /** Shared with the reading `gateRun` took before this log: that read can be the stuck one. */
  stuck: StuckReads;
  /** `sampleHost`'s limit; tests shorten it. */
  readLimitMs?: number;
}

/** What gate.json keeps of a run (`host`). */
export interface HostRecord {
  allowBattery: boolean;
  /**
   * Each move to battery during the run, and, without `--allow-battery`, a first reading on battery: the refusal reads only one
   * sample, and it may have had no reading. Not a run started on battery with the flag.
   */
  powerLost: { at: string; percent: number | null }[];
  /**
   * Polls and suite edges in time order; see `HostLogOptions.keepEveryMs`. Power is known only at these readings, so a spell on battery
   * that starts and ends between two of them, up to `pollMs` long (60 s on a real gate), shows neither here nor in `powerLost`: the wave
   * 40a gate's 10 s spell during `expanded` is only in `pmset -g log` (review w40a-audit N4).
   */
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
  /** The last sample had no power reading, so a change seen next happened some time before it was seen. */
  private unread = false;

  constructor(
    private readonly readers: HostReaders,
    private readonly opts: HostLogOptions,
  ) {
    this.onBattery = opts.firstOnBattery;
  }

  /** Follows the power source; a sample with no reading says nothing about it. Whether the source changed. */
  private follow(s: HostSample): boolean {
    if (s.power === null) {
      this.unread = true;
      return false;
    }
    const was = this.onBattery;
    const unread = this.unread;
    this.unread = false;
    this.onBattery = s.power.onBattery;
    if (was === s.power.onBattery) return false;
    if (was === undefined && (!s.power.onBattery || this.opts.allowBattery)) return false;
    const charge = s.power.percent === null ? "" : ` at ${s.power.percent}%`;
    // After no reading at all or a failed one, T is only when it was seen: the move happened some time before it.
    const when = was === undefined || unread ? "by" : "at";
    if (s.power.onBattery) {
      this.powerLost.push({ at: s.at, percent: s.power.percent });
      this.opts.note(`note: power lost ${when} ${s.at}: this gate now runs on battery${charge}, slower, and a timeout from here on may be false (\`host\` in gate.json)`);
    } else this.opts.note(`note: power back ${when} ${s.at}${charge}`);
    return true;
  }

  private keep(s: HostSample): HostSample {
    this.samples.push(s);
    this.keptAt = Date.parse(s.at);
    return s;
  }

  /** A sample that is always kept: the run's and each suite's start and end. */
  async mark(): Promise<HostSample> {
    const s = await sampleHost(this.readers, this.opts.readLimitMs, this.opts.stuck);
    this.follow(s);
    return this.keep(s);
  }

  /** One poll; the timer's body. Skipped while the last one is still reading. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const s = await sampleHost(this.readers, this.opts.readLimitMs, this.opts.stuck);
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
