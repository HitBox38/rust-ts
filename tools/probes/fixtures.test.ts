// The committed oracle fixtures that a registered probe regenerates (lane harness-w36; scripts/probes.ts
// `PROBE_FIXTURES`, `bun scripts/probes.ts fixture`): each fixture must equal its probe's stdout byte for byte, so a
// fixture can neither drift from the probe nor be edited by hand.
//   randstream (tools/probes/randstream) -> src/vendor/rand/stdrng.oracle.txt (lane vendor-rand)
//   miriaddr   (tools/probes/miriaddr)   -> src/miri/alloc_addresses/addresses.oracle.txt (lane miri-alloc)
//   mirisched  (tools/probes/mirisched)  -> src/miri/concurrency/scheduler.oracle.txt (lane miri-threads-fix)
//   mirimath   (tools/probes/mirimath)   -> src/miri/math.oracle.txt (lane miri-eval-fix; host libm results, so the
//                                           test runs only on the fixture's host and is skipped elsewhere with the
//                                           reason printed, like src/miri/math.test.ts; lane harness-w37)
//   miripaths  (tools/probes/miripaths)  -> tools/probes/miripaths/paths.oracle.txt (lane miri-shims-a's script; the
//                                           `ORACLE` table of src/miri/shims/os_str.test.ts, checked below)
//   miriepoll  (tools/probes/miriepoll)  -> tools/probes/miriepoll/epoll.oracle.txt (lane harness-w38; a program the Miri
//                                           oracle runs from source: needs `bun scripts/miri.ts setup`, not a build)
// A binary built from other sources than this tree's fails its test (scripts/probes.ts `probeStaleness`; review
// harness-w38 L3). Without a built probe its test is a visible skip; RUST_TS_REQUIRE_PROBES=1 (the gate) makes that a failure. The
// literal probeBinary("<name>") calls let the gate's unit-test pre-check (scripts/probes.ts `oracleTestProbes`) see
// that these tests need the probes. The host is RUST_TS_HOST_TUPLE (the environment, else the repo's `.env.local`, which
// scripts/lib/common.ts loads), as for src/miri/math.test.ts through `host_tuple()`;
// src/rustc_driver_impl/print.oracle.test.ts checks it against the oracle's `rustc -vV`.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { mergeEnv } from "../../scripts/lib/env.ts";
import { miriOracleProblem } from "../../scripts/lib/miri.ts";
import { PROBE_FIXTURES, fixtureSelection, probeBinary, probeFixtureCmd, probeNames, probeStaleness } from "../../scripts/probes.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBES: [string, string | undefined][] = [
  ["randstream", probeBinary("randstream")],
  ["miriaddr", probeBinary("miriaddr")],
  ["mirisched", probeBinary("mirisched")],
  ["mirimath", probeBinary("mirimath")],
  ["miripaths", probeBinary("miripaths")],
  ["miriepoll", undefined],
];
const HOST = process.env.RUST_TS_HOST_TUPLE;

test("every PROBE_FIXTURES entry is checked here, and every fixture is committed", () => {
  expect(PROBES.map(([n]) => n).sort()).toEqual(Object.keys(PROBE_FIXTURES).sort());
  for (const f of Object.values(PROBE_FIXTURES)) expect(existsSync(join(REPO, f.fixture))).toBe(true);
});

test("`fixture` with no names leaves another host's fixture alone; a named one is an error", () => {
  const hosted = Object.entries(PROBE_FIXTURES).filter(([, f]) => f.host !== undefined).map(([n]) => n);
  expect(hosted.length).toBeGreaterThan(0);
  const elsewhere = fixtureSelection([], () => "another-host");
  expect(elsewhere.errors).toEqual([]);
  expect(elsewhere.run).toEqual(Object.keys(PROBE_FIXTURES).filter((n) => !hosted.includes(n)));
  expect(elsewhere.skipped.length).toBe(hosted.length);
  expect(elsewhere.skipped[0]).toContain("this host is another-host; not rewritten");
  expect(fixtureSelection([hosted[0]!], () => "another-host").errors.length).toBe(1);
  expect(fixtureSelection(["no-such-probe"], () => "another-host").errors[0]).toContain("has no fixture");
  const here = PROBE_FIXTURES[hosted[0]!]!.host!;
  expect(fixtureSelection([hosted[0]!], () => here)).toEqual({ run: [hosted[0]!], skipped: [], errors: [] });
});

test("paths.oracle.txt is the ORACLE table of src/miri/shims/os_str.test.ts", () => {
  const table = readFileSync(join(REPO, "src/miri/shims/os_str.test.ts"), "utf8");
  const rows = readFileSync(join(REPO, PROBE_FIXTURES.miripaths!.fixture), "utf8").trimEnd().split("\n");
  expect(rows.length).toBe(16);
  // Rust's `{:?}` of these strings is the TypeScript literal.
  for (const row of rows) expect(table).toContain(`  [${row.split("\t").join(", ")}],\n`);
  expect(table.split("\n").filter((l) => l.startsWith("  [\"")).length).toBe(rows.length);
});

test("no built probe comes from other sources than this tree's", () => {
  const built = probeNames().filter((n) => existsSync(probeBinary(n)));
  const seen = built.map((n) => probeStaleness(n));
  const unknown = seen.filter((s) => s.state === "unknown").length;
  if (unknown) console.log(`fixtures.test.ts: ${unknown} of ${built.length} built probes were built before source stamps and cannot be checked until the next bun scripts/probes.ts build`);
  expect(seen.flatMap((s) => (s.state === "stale" ? [s.why] : []))).toEqual([]);
});

const probesCli = (...args: string[]) => {
  const p = Bun.spawnSync([process.execPath, join(REPO, "scripts/probes.ts"), ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};

test("the CLI on a probe it cannot build: one ERROR line with what to do, no stack trace", () => {
  for (const cmd of ["build", "path"]) {
    const miri = probesCli(cmd, "miriepoll");
    expect(miri).toEqual({ code: 1, out: "ERROR: probe 'miriepoll' has no cargo build: the Miri oracle runs its source; run: bun scripts/miri.ts setup, then bun scripts/probes.ts fixture miriepoll\n", err: "" });
    const unknown = probesCli(cmd, "no-such-probe");
    expect(unknown).toEqual({ code: 1, out: "ERROR: no probe 'no-such-probe' (no tools/probes/no-such-probe/Cargo.toml.in)\n", err: "" });
  }
}, 60_000);

test("a Miri fixture's environment stays scrubbed through run(), as `fixture` runs it", () => {
  const child = `
const { run } = await import(${JSON.stringify(join(REPO, "scripts/lib/common.ts"))});
const { PROBE_FIXTURES, probeFixtureCmd } = await import(${JSON.stringify(join(REPO, "scripts/probes.ts"))});
const { env } = probeFixtureCmd("miriepoll", PROBE_FIXTURES.miriepoll);
const r = await run([process.execPath, "-e", "console.log(JSON.stringify(['MIRI_BE_RUSTC', 'MIRI_LOG', 'RUSTC_LOG', 'RUSTUP_HOME'].map((k) => process.env[k] ?? null)))"], { env });
console.log(r.stdout.trim());
`;
  const p = Bun.spawnSync([process.execPath, "-e", child], { cwd: REPO, env: { ...process.env, MIRI_BE_RUSTC: "host", MIRI_LOG: "debug", RUSTC_LOG: "debug" }, stdout: "pipe", stderr: "pipe" });
  expect(p.exitCode, p.stderr.toString()).toBe(0);
  const [beRustc, log, rustcLog, rustupHome] = JSON.parse(p.stdout.toString().trim().split("\n").at(-1)!) as (string | null)[];
  expect([beRustc, log, rustcLog]).toEqual([null, null, null]);
  expect(rustupHome).toContain("rustup-miri");
}, 60_000);

for (const [name, bin] of PROBES) {
  const f = PROBE_FIXTURES[name]!;
  const { fixture, host } = f;
  // What the fixture's probe needs, or undefined when it is there.
  const missing = f.miri ? (miriOracleProblem({ sysroot: true }) === undefined ? undefined : "the Miri oracle is not set up; bun scripts/miri.ts setup") : existsSync(bin!) ? undefined : `probe not built; bun scripts/probes.ts build ${name}`;
  // A host-specific fixture on another host: skipped (not a missing probe, so also under RUST_TS_REQUIRE_PROBES=1).
  const otherHost = host !== undefined && host !== HOST ? `skipped: ${fixture} holds the results of host ${host}, this host is ${HOST ?? "unknown (RUST_TS_HOST_TUPLE unset)"}` : undefined;
  if (otherHost) console.log(`fixtures.test.ts: ${name}: ${otherHost}`);
  const t = otherHost ? test.skip : missing === undefined || REQUIRE_PROBES ? test : test.skip;
  // (Under RUST_TS_REQUIRE_PROBES=1 a missing probe runs, and fails: its title must not say skipped.)
  const note = otherHost ? ` (${otherHost})` : missing === undefined ? "" : REQUIRE_PROBES ? ` (required, missing: ${missing})` : ` (skipped: ${missing})`;
  t(`${fixture} equals the ${name} probe's output${note}`, () => {
    expect(missing).toBeUndefined();
    const { cmd, env } = probeFixtureCmd(name, f);
    const r = Bun.spawnSync(cmd, { env: mergeEnv(process.env, env), stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const out = r.stdout.toString();
    const want = readFileSync(join(REPO, fixture), "utf8");
    // Compare line counts first so a mismatch reports something short.
    expect(out.split("\n").length).toBe(want.split("\n").length);
    const lines = out.split("\n");
    const first = want.split("\n").findIndex((l, i) => l !== lines[i]);
    expect(first).toBe(-1);
    expect(out === want).toBe(true);
  }, 120_000);
}
