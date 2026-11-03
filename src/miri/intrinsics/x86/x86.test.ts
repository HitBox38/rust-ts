// Lane miri-x86-a: intrinsics/x86/{mod,sse,sse2,sse3,ssse3,sse41,sse42} against the Miri oracle.
//
// Each probe (probes/<name>.rs) runs end to end on the port, and its output must equal the fixture the isolated Miri
// produced for it (probes/regen.sh; the fixtures are never edited by hand):
// - the value probes call every `llvm.x86.*` name of these files directly and dump the results' raw bytes, default and
//   with `-Zmiri-deterministic-floats` where floats are involved, so the seeded float noise of `rcp` / `rsqrt` and the NaN
//   choices of the float operations are compared bit for bit;
// - the `err_*` probes compare the whole stderr (the diagnostics) and the exit status;
// - the two `*_panic` probes compare the panic text and the exit status: the ICE frame around it is the driver's.
//
// The port's driver stops `unported` on `-C target-feature` (docs/handoff/miri-x86-a.md), so `probes/driver.ts` grants the
// features the oracle got from that flag.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../../scripts/lib/common.ts";
import { MIRI_CARGO_HOME, MIRI_RUSTUP_HOME, MIRI_SYSROOT } from "../../../../scripts/lib/miri.ts";

const DIR = join(import.meta.dir, "probes");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const HAVE = existsSync(MIRI_SYSROOT);
if (!HAVE) console.log(`SKIP: no Miri sysroot at ${MIRI_SYSROOT} (bun scripts/miri.ts setup); RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

/** Interpreting these under load takes minutes; bun's default of 5 s is meant for unit tests. */
const TIMEOUT_MS = 20 * 60_000;
const DET = "-Zmiri-deterministic-floats";

const SSE3 = "sse3";
const SSSE3 = `${SSE3},ssse3`;
const SSE41 = `${SSSE3},sse4.1`;
const SSE42 = `${SSE41},sse4.2`;

interface Case {
  /** The fixture is `probes/<fixture>.oracle.{out,stderr,exit}`. */
  readonly fixture: string;
  readonly probe: string;
  readonly features: string;
  readonly flags: readonly string[];
}
const VALUES: readonly Case[] = [
  { fixture: "sse", probe: "sse", features: "", flags: [] },
  { fixture: "sse.det", probe: "sse", features: "", flags: [DET] },
  { fixture: "sse2", probe: "sse2", features: "", flags: [] },
  { fixture: "sse2.det", probe: "sse2", features: "", flags: [DET] },
  { fixture: "ssse3", probe: "ssse3", features: SSSE3, flags: [] },
  { fixture: "sse41", probe: "sse41", features: SSE41, flags: [] },
  { fixture: "sse41.det", probe: "sse41", features: SSE41, flags: [DET] },
  { fixture: "sse42", probe: "sse42", features: SSE42, flags: [] },
  { fixture: "adx_pclmul", probe: "adx_pclmul", features: "pclmulqdq,vpclmulqdq,avx512f", flags: [] },
];
const err = (probe: string, features = ""): Case => ({ fixture: probe, probe, features, flags: [] });
const ERRORS: readonly Case[] = [
  err("err_feature_sse3"),
  err("err_feature_ssse3"),
  err("err_feature_sse41"),
  err("err_feature_sse42"),
  err("err_feature_pclmul"),
  err("err_cmp_avx"),
  err("err_unknown_x86"),
  err("err_unknown_sse"),
  err("err_unknown_sse2"),
  err("err_argcount"),
  err("err_uninit"),
  err("err_ldu_null", SSE3),
];
const PANICS: readonly Case[] = [err("err_cmp_imm_panic"), err("err_round_panic", SSE41)];

async function run(c: Case): Promise<{ stdout: Buffer; stderr: string; exit: number }> {
  const proc = Bun.spawn(
    [process.execPath, "driver.ts", "--sysroot", MIRI_SYSROOT, "--target", "x86_64-unknown-linux-gnu", "--edition=2021", ...c.flags, `${c.probe}.rs`],
    {
      cwd: DIR,
      env: {
        HOME: process.env.HOME ?? "",
        PATH: process.env.PATH ?? "",
        RUST_TS_DATA: DATA,
        RUSTUP_HOME: MIRI_RUSTUP_HOME,
        CARGO_HOME: MIRI_CARGO_HOME,
        X86_PROBE_FEATURES: c.features,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout: Buffer.from(stdout), stderr, exit };
}
const fixture = (c: Case, ext: string): string => readFileSync(join(DIR, `${c.fixture}.oracle.${ext}`), "utf8");

/** Fails naming the first differing byte and its surroundings, not with two 100 KB buffers. */
function expect_same_bytes(got: Buffer, c: Case, stderr: string): void {
  const want = readFileSync(join(DIR, `${c.fixture}.oracle.out`));
  if (got.equals(want)) return;
  let i = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) i++;
  const around = (b: Buffer): string => b.subarray(Math.max(0, i - 48), i + 48).toString("latin1").replace(/[^\x20-\x7e]/g, (x) => `\\x${x.charCodeAt(0).toString(16).padStart(2, "0")}`);
  throw new Error(`first difference at byte ${i} (lengths ${want.length} / ${got.length})\n  oracle: ${around(want)}\n  port:   ${around(got)}\nstderr: ${stderr.slice(0, 2000)}`);
}

for (const c of VALUES) {
  test.skipIf(!HAVE && !REQUIRE)(`values: ${c.fixture}`, async () => {
    const { stdout, stderr, exit } = await run(c);
    expect_same_bytes(stdout, c, stderr);
    expect(stderr).toBe(fixture(c, "stderr"));
    expect(String(exit)).toBe(fixture(c, "exit").trim());
  }, TIMEOUT_MS);
}

for (const c of ERRORS) {
  test.skipIf(!HAVE && !REQUIRE)(`diagnostics: ${c.fixture}`, async () => {
    const { stdout, stderr, exit } = await run(c);
    expect(stderr).toBe(fixture(c, "stderr"));
    expect_same_bytes(stdout, c, stderr);
    expect(String(exit)).toBe(fixture(c, "exit").trim());
  }, TIMEOUT_MS);
}

for (const c of PANICS) {
  test.skipIf(!HAVE && !REQUIRE)(`panic text: ${c.fixture}`, async () => {
    const { stderr, exit } = await run(c);
    const lines = fixture(c, "stderr").split("\n");
    const at = lines.findIndex((l) => l.includes(" panicked at "));
    expect(at).toBeGreaterThanOrEqual(0);
    const message = lines[at + 1]!;
    expect(stderr).toContain(`internal compiler error: ${message}\n`);
    expect(String(exit)).toBe(fixture(c, "exit").trim());
  }, TIMEOUT_MS);
}
