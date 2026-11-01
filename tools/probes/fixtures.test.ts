// The committed oracle fixtures that a registered probe regenerates (lane harness-w36; scripts/probes.ts
// `PROBE_FIXTURES`, `bun scripts/probes.ts fixture`): each fixture must equal its probe's stdout byte for byte, so a
// fixture can neither drift from the probe nor be edited by hand.
//   randstream (tools/probes/randstream) -> src/vendor/rand/stdrng.oracle.txt (lane vendor-rand)
//   miriaddr   (tools/probes/miriaddr)   -> src/miri/alloc_addresses/addresses.oracle.txt (lane miri-alloc)
// Without a built probe its test is a visible skip; RUST_TS_REQUIRE_PROBES=1 (the gate) makes that a failure. The
// literal probeBinary("<name>") calls let the gate's unit-test pre-check (scripts/probes.ts `oracleTestProbes`) see
// that these tests need the probes.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { PROBE_FIXTURES, probeBinary } from "../../scripts/probes.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBES: [string, string][] = [
  ["randstream", probeBinary("randstream")],
  ["miriaddr", probeBinary("miriaddr")],
];

test("every PROBE_FIXTURES entry is checked here, and every fixture is committed", () => {
  expect(PROBES.map(([n]) => n).sort()).toEqual(Object.keys(PROBE_FIXTURES).sort());
  for (const f of Object.values(PROBE_FIXTURES)) expect(existsSync(join(REPO, f))).toBe(true);
});

for (const [name, bin] of PROBES) {
  const fixture = PROBE_FIXTURES[name]!;
  const built = existsSync(bin);
  const t = built || REQUIRE_PROBES ? test : test.skip;
  t(`${fixture} equals the ${name} probe's output${built ? "" : ` (skipped: probe not built; bun scripts/probes.ts build ${name})`}`, () => {
    expect(built).toBe(true);
    const r = Bun.spawnSync([bin], { stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode, r.stderr.toString()).toBe(0);
    const out = r.stdout.toString();
    const want = readFileSync(join(REPO, fixture), "utf8");
    // Compare line counts first so a mismatch reports something short.
    expect(out.split("\n").length).toBe(want.split("\n").length);
    const lines = out.split("\n");
    const first = want.split("\n").findIndex((l, i) => l !== lines[i]);
    expect(first).toBe(-1);
    expect(out === want).toBe(true);
  });
}
