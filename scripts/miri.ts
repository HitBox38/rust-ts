// The isolated Miri oracle (plan-m6 D1, A7; lane harness-m6a; see scripts/lib/miri.ts).
//
//   bun scripts/miri.ts setup     install (if needed) the pinned nightly with miri + rust-src into $RUST_TS_DATA/rustup-miri
//                                 (RUSTUP_HOME; CARGO_HOME $RUST_TS_DATA/cargo-miri), build the Miri sysroot for
//                                 UPSTREAM.json rust.miri.target into $RUST_TS_DATA/miri-sysroot, verify both, and run a
//                                 hello world. Idempotent: an installed toolchain and an up-to-date sysroot are kept.
//   bun scripts/miri.ts status    the checks alone (no install, no build); exit 1 on a problem
//   bun scripts/miri.ts time --suite S [--jobs N] [--timeout-ms N] [--filter X]
//                                 run only the oracle side of every case of Miri suite S (never cached), with each
//                                 process's user time and max RSS: the heavy-case measurement of plan-m6 A7. Writes
//                                 $RUST_TS_DATA/tmp/miri-time/<S>-<run id>.jsonl and prints the summary and the slowest.
//
// The oracle toolchain is never touched: setup checks that it has exactly its pinned components before and after,
// and every rustup / cargo process it starts gets an environment built from scratch whose RUSTUP_HOME / CARGO_HOME are
// the isolated homes (asserted before each spawn), so no inherited RUSTUP_HOME, RUSTUP_TOOLCHAIN, CARGO_* or MIRI_*
// variable can redirect it. Full logs go to $RUST_TS_DATA/tmp/miri-setup/.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { suite as getSuite } from "../harness/suites.ts";
import { DATA, PIN, UPSTREAM, die, ensureDir, nowId, parseArgs, pool, requireUpstream, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import {
  MIRI_CARGO_HOME,
  MIRI_CASE_ENV,
  MIRI_RUSTUP_HOME,
  MIRI_SYSROOT,
  miriBinary,
  miriOracleKey,
  miriOracleProblem,
  miriPin,
  miriSysrootHash,
  miriToolchainDir,
  miriToolchainName,
  verifyMiriOracle,
} from "./lib/miri.ts";
import { oracleHost, oracleSysroot, verifyOraclePin } from "./lib/oracle.ts";
import { installedComponents, oracleToolchainError, pinnedComponents } from "./lib/toolchain.ts";

const LOGS = join(DATA, "tmp", "miri-setup");

/** The oracle toolchain's component check, fresh (not memoized like `verifyOracleToolchain`). */
function oracleClean(when: string): void {
  const sysroot = oracleSysroot();
  const bad = oracleToolchainError(sysroot, PIN.components, oracleHost(), basename(sysroot));
  if (bad !== undefined) die(`${when}: ${bad}`);
}

/** Variables passed through from the caller to setup's processes (proxies, certificates, rustup's mirrors). */
const PASSED = ["HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "TEMP", "TMP", "USERPROFILE", "SYSTEMROOT", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "RUSTUP_DIST_SERVER", "RUSTUP_UPDATE_ROOT"];

/** A fresh environment for a rustup / cargo process of the isolated toolchain (see the header). */
function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of PASSED) if (process.env[k] !== undefined) env[k] = process.env[k]!;
  Object.assign(env, extra, { RUSTUP_HOME: MIRI_RUSTUP_HOME, CARGO_HOME: MIRI_CARGO_HOME });
  // The oracle's rustup home is the parent of its toolchains directory; the isolated one must never be it.
  const oracleHome = resolve(dirname(dirname(oracleSysroot())));
  if (resolve(env.RUSTUP_HOME!) === oracleHome) die(`refusing to run: the isolated RUSTUP_HOME ${env.RUSTUP_HOME} is the oracle's (${oracleHome})`);
  return env;
}

/** Runs a setup step with output to a log file; dies (one `ERROR:` line naming the log) if it fails. */
async function step(name: string, cmd: string[], env: Record<string, string>, cwd: string): Promise<string> {
  if (env.RUSTUP_HOME !== MIRI_RUSTUP_HOME || env.CARGO_HOME !== MIRI_CARGO_HOME) die(`refusing to run ${name}: not in the isolated homes`);
  ensureDir(LOGS);
  const log = join(LOGS, `${name}.log`);
  const proc = Bun.spawn(cmd, { cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  writeFileSync(log, `$ ${cmd.join(" ")}\n--- stdout ---\n${out}\n--- stderr ---\n${err}\n--- exit: ${code} ---\n`);
  if (code !== 0) die(`${name} failed (exit ${code}); log: ${log}`);
  return out + err;
}

async function setup(): Promise<void> {
  oracleClean("before setup, the oracle toolchain is not clean");
  const pin = miriPin();
  const name = miriToolchainName();
  const dir = miriToolchainDir();
  const rustup = Bun.which("rustup");
  ensureDir(MIRI_RUSTUP_HOME);
  ensureDir(MIRI_CARGO_HOME);
  // 1. The toolchain.
  if (!existsSync(dir)) {
    if (!rustup) die("rustup not found on PATH (needed once to install the isolated Miri toolchain)");
    console.log(`installing ${PIN.nightlyName} (minimal + miri, rust-src) into ${MIRI_RUSTUP_HOME} ...`);
    await step("toolchain-install", [rustup, "toolchain", "install", PIN.nightlyName, "--profile", "minimal", "--component", "miri,rust-src", "--no-self-update"], isolatedEnv(), MIRI_RUSTUP_HOME);
  } else {
    // Only the two components setup adds can be added; anything else is a problem to look at, not to fix here.
    const want = pinnedComponents(pin.components, oracleHost());
    let have: string[] = [];
    try {
      have = installedComponents(dir);
    } catch {}
    const add = [
      ...(want.some((c) => c.startsWith("miri-preview-")) && !have.some((c) => c.startsWith("miri-preview-")) ? ["miri"] : []),
      ...(want.includes("rust-src") && !have.includes("rust-src") ? ["rust-src"] : []),
    ];
    if (add.length) {
      if (!rustup) die("rustup not found on PATH (needed to add components to the isolated Miri toolchain)");
      console.log(`adding ${add.join(", ")} to the isolated ${name} ...`);
      await step("component-add", [rustup, "component", "add", "--toolchain", name, ...add], isolatedEnv(), MIRI_RUSTUP_HOME);
    }
  }
  const bad = miriOracleProblem({ sysroot: false });
  if (bad !== undefined) die(bad);
  // 2. The sysroot (cargo-miri's setup is itself idempotent: rustc-build-sysroot keeps an up-to-date one).
  const scratch = mkdtempSync(join(tmpdir(), "rust-ts-miri-setup-"));
  try {
    const env = isolatedEnv({
      PATH: `${join(dir, "bin")}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      RUSTUP_TOOLCHAIN: name,
      MIRI_SYSROOT,
      MIRI_LIB_SRC: join(dir, "lib", "rustlib", "src", "rust", "library"),
    });
    const out = await step("sysroot", [join(dir, "bin", process.platform === "win32" ? "cargo.exe" : "cargo"), "miri", "setup", "--target", pin.target], env, scratch);
    console.log(`sysroot: ${/Preparing a sysroot|Compiling/.test(out) ? "built" : "up to date"} (${MIRI_SYSROOT})`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  verifyMiriOracle();
  oracleClean("after setup, the oracle toolchain is not clean");
  await smoke();
  report();
}

/** Miri runs a std hello world on the sysroot (the miri-hello case's argv, outside the upstream checkout). */
async function smoke(): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "rust-ts-miri-hello-"));
  try {
    writeFileSync(join(scratch, "hello.rs"), 'fn main() {\n    println!("Hello, world!");\n}\n');
    const r = await run([miriBinary(), "hello.rs", "--sysroot", MIRI_SYSROOT, "--target", miriPin().target], {
      cwd: scratch,
      env: caseEnv({ ...MIRI_CASE_ENV }),
      timeoutMs: 60_000,
    });
    if (r.code !== 0 || r.stdout !== "Hello, world!\n") die(`Miri hello world: exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 100))}, stderr ${JSON.stringify(r.stderr.slice(0, 200))}`);
    console.log(`hello world: ok (${r.ms.toFixed(0)} ms)`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function report(): void {
  const s = miriSysrootHash();
  console.log(`ok: Miri toolchain ${miriToolchainName()} at ${PIN.commit.slice(0, 12)} (RUSTUP_HOME=${MIRI_RUSTUP_HOME}); sysroot ${s.files} files, ${(s.bytes / 1e6).toFixed(0)} MB; oracle key ${miriOracleKey().slice(0, 12)}`);
}

async function status(): Promise<void> {
  const sysroot = oracleSysroot();
  const o = oracleToolchainError(sysroot, PIN.components, oracleHost(), basename(sysroot));
  console.log(o === undefined ? `ok    oracle toolchain ${basename(sysroot)}: pinned components, no rust-src` : `ERROR: ${o}`);
  const m = miriOracleProblem({ sysroot: true });
  if (m !== undefined) console.log(`ERROR: ${m}`);
  else report();
  if (o !== undefined || m !== undefined) process.exit(1);
}

interface Timing {
  id: string;
  code: number;
  timedOut: boolean;
  wallMs: number;
  userMs: number | null;
  maxRssMb: number | null;
}

async function time(a: ReturnType<typeof parseArgs>): Promise<void> {
  if (typeof a.suite !== "string") die("usage: bun scripts/miri.ts time --suite <name> [--jobs N] [--timeout-ms N] [--filter X]");
  requireUpstream();
  await verifyOraclePin();
  const s = getSuite(a.suite);
  if (!s.miri) die(`suite ${s.name} is not a Miri suite`);
  verifyMiriOracle();
  let cases = s.cases();
  if (typeof a.filter === "string") cases = cases.filter((c) => c.id.includes(a.filter as string));
  const jobs = Number(a.jobs ?? Math.max(1, availableParallelism() - 2));
  const timeoutMs = Number(a["timeout-ms"] ?? s.oracleTimeoutMs ?? s.timeoutMs);
  const t0 = performance.now();
  const rows = await pool(cases, jobs, async (c): Promise<Timing> => {
    const r = await run(s.oracle([c]), { cwd: s.cwd ?? UPSTREAM, timeoutMs, env: caseEnv(c.env) });
    return {
      id: c.id,
      code: r.code,
      timedOut: r.timedOut,
      wallMs: Math.round(r.ms),
      userMs: r.usage ? Math.round(r.usage.userMs) : null,
      maxRssMb: r.usage ? Math.round(r.usage.maxRssBytes / 1e6) : null,
    };
  });
  const out = join(ensureDir(join(DATA, "tmp", "miri-time")), `${s.name}-${nowId()}.jsonl`);
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const codes = new Map<string, number>();
  for (const r of rows) codes.set(r.timedOut ? "timeout" : `exit ${r.code}`, (codes.get(r.timedOut ? "timeout" : `exit ${r.code}`) ?? 0) + 1);
  const user = rows.map((r) => r.userMs ?? 0).sort((x, y) => x - y);
  const q = (p: number) => user[Math.min(user.length - 1, Math.floor(p * user.length))] ?? 0;
  const total = user.reduce((x, y) => x + y, 0);
  console.log(`${s.name}: ${rows.length} cases, ${[...codes].map(([k, v]) => `${k}: ${v}`).join(", ")}; user p50 ${q(0.5)} ms, p99 ${q(0.99)} ms, max ${user.at(-1) ?? 0} ms, total ${(total / 1000).toFixed(1)} s; wall ${((performance.now() - t0) / 1000).toFixed(0)} s with ${jobs} jobs (timeout ${timeoutMs} ms)`);
  for (const r of [...rows].sort((x, y) => (y.userMs ?? 0) - (x.userMs ?? 0)).slice(0, Number(a.top ?? 15))) {
    console.log(`  ${r.timedOut ? "TIMEOUT" : `exit ${r.code}`}  user ${r.userMs} ms  wall ${r.wallMs} ms  rss ${r.maxRssMb} MB  ${r.id}`);
  }
  console.log(`details: ${out}`);
}

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];
if (cmd === "setup") await setup();
else if (cmd === "status") await status();
else if (cmd === "time") await time(a);
else console.log("usage: bun scripts/miri.ts setup | status | time --suite <name> [--jobs N] [--timeout-ms N] [--filter X]");
