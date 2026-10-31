// Shared helpers for harness scripts. Output conventions (for agents):
//   - keep stdout short; write details to files under $RUST_TS_DATA
//   - failures print a single line starting with "ERROR:" so they can be grepped
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeEnv } from "./env.ts";

export const REPO = resolve(import.meta.dir, "..", "..");

export interface UpstreamPin {
  repo: string;
  commit: string;
  commitDate: string;
  release: string;
  toolchain: string;
  nightlyName: string;
  sparse: string[];
  /**
   * Git submodules of the checkout that are initialized (shallow, at the commit the pin records) by `bun
   * scripts/upstream.ts fetch`: `library/backtrace`, which std `#[path]`s into (plan-m5 D2, lane harness-m5c).
   */
  submodules?: string[];
}

export const PIN: UpstreamPin = JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")).rust;

// Bun only auto-loads .env.local from the cwd; scripts may run from anywhere (e.g. the upstream checkout).
const envLocal = join(REPO, ".env.local");
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
  }
}

/** Large, regenerable data (upstream checkout, oracle cache, run outputs). Never committed. */
export const DATA = resolve(process.env.RUST_TS_DATA ?? join(REPO, ".data"));
/** Where `scripts/lane.ts` creates per-agent git worktrees. */
export const LANES = resolve(process.env.RUST_TS_LANES ?? join(DATA, "lanes"));
export const UPSTREAM = join(DATA, "rust");
export const ORACLE_CACHE = join(DATA, "oracle-cache");
export const RUNS = join(DATA, "runs");

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

export function die(msg: string): never {
  console.log(`ERROR: ${msg}`);
  process.exit(1);
}

export function requireUpstream(): string {
  if (!existsSync(join(UPSTREAM, "compiler"))) die(`upstream checkout missing at ${UPSTREAM}; run: bun scripts/upstream.ts fetch`);
  return UPSTREAM;
}

export interface ProcResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
  ms: number;
  /**
   * The process's resource usage as `wait4` reports it (Bun `Subprocess.resourceUsage()`; it includes the
   * descendants the process waited for): user/system CPU and max resident set size, in bytes (on macOS the
   * same number `/usr/bin/time -l` prints). Bun 1.4.3 converts `ru_maxrss` to bytes on every platform (it is KiB on
   * Linux: src/spawn_sys/spawn_process.rs `RusageFields::maxrss`); common.test.ts checks the unit on the host.
   * `undefined` when Bun reports none. Recorded by the heavy suites (harness/suites.ts `Suite.heavy`; difftest.ts
   * `usageOf` records a missing or implausible one as unavailable).
   */
  usage?: { userMs: number; sysMs: number; maxRssBytes: number };
}

/**
 * Run a command. `env` is merged over the inherited environment; a `null` value removes the
 * variable (e.g. compiletest's `unset-rustc-env`). On Windows names match case-insensitively
 * (scripts/lib/env.ts `mergeEnv`).
 */
export async function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string | null> } = {}): Promise<ProcResult> {
  const start = performance.now();
  const env = mergeEnv(process.env, opts.env);
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? REPO,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env,
  });
  let timedOut = false;
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs)
    : undefined;
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (timer) clearTimeout(timer);
  const ru = proc.resourceUsage();
  const usage = ru ? { userMs: Number(ru.cpuTime.user) / 1000, sysMs: Number(ru.cpuTime.system) / 1000, maxRssBytes: ru.maxRSS } : undefined;
  return { stdout, stderr, code, timedOut, ms: performance.now() - start, usage };
}

/** Run an async fn over items with bounded concurrency, preserving result order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, onDone?: (n: number) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
      onDone?.(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function hash(s: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha1").update(s).digest("hex");
}

export function parseArgs(argv: string[]): { _: string[]; [k: string]: string | boolean | string[] } {
  const out: { _: string[]; [k: string]: string | boolean | string[] } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) out[a.slice(2)] = argv[++i]!;
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

/** Run id: timestamp + agent/lane + random suffix, so concurrent agents never collide. */
export function nowId(): string {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const who = (process.env.RUST_TS_AGENT ?? "root").replace(/[^\w-]/g, "");
  return `${ts}-${who}-${Math.random().toString(36).slice(2, 6)}`;
}
