// Oracle test for lane bm-rest's builtin macros: `#[test]`/`#[bench]`/`#[test_case]` (test.rs), the
// `--test` harness (test_harness.rs), the proc-macro harness (proc_macro_harness.rs), `asm!`/
// `global_asm!`/`naked_asm!` (asm.rs), `#[global_allocator]` (global_allocator.rs), the EII attributes
// (eii.rs) and the contract attributes (contracts.rs). Runs rest_oracle/run.ts (the port) on
// rest_oracle/cases.txt and compares its stdout and stderr, case by case, with out.stdout / out.stderr
// recorded from the rustc-dev probe rest_oracle/probe.rs (see its header for how to regenerate them).
// A pending case (pending column not `-`) is recorded by the probe but must stop at an `unported` path on
// the port; clear its pending column once the path is ported.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "rest_oracle");

/** `== <case>` headers split a stream into sections (the text before the first header is ""). */
function sections(text: string): Map<string, string> {
  const m = new Map<string, string>();
  let cur = "";
  let buf: string[] = [];
  for (const line of text.split("\n")) {
    const h = /^== (\S+)$/.exec(line);
    if (h) {
      m.set(cur, buf.join("\n"));
      cur = h[1]!;
      buf = [];
    } else {
      buf.push(line);
    }
  }
  m.set(cur, buf.join("\n"));
  return m;
}

const pending = new Set(
  readFileSync(join(DIR, "cases.txt"), "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("#") && l.trim() !== "")
    .map((l) => l.split(" | "))
    .filter((f) => f[4] !== "-")
    .map((f) => f[0]!),
);

const run = Bun.spawnSync(["bun", join(DIR, "run.ts"), join(DIR, "cases.txt")], {
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
});
const got = { stdout: sections(run.stdout.toString()), stderr: sections(run.stderr.toString()) };
const want = {
  stdout: sections(readFileSync(join(DIR, "out.stdout"), "utf8")),
  stderr: sections(readFileSync(join(DIR, "out.stderr"), "utf8")),
};

test("run.ts exits like the probe and prints every case", () => {
  expect(run.exitCode).toBe(0);
  expect([...got.stdout.keys()]).toEqual([...want.stdout.keys()]);
  expect([...got.stderr.keys()]).toEqual([...want.stderr.keys()]);
});

for (const name of want.stdout.keys()) {
  if (name === "") continue;
  if (pending.has(name)) {
    test(`bm-rest case ${name} (pending: stops at an unported path)`, () => {
      expect(got.stdout.get(name) ?? "").toContain("UNPORTED: ");
    });
    continue;
  }
  test(`bm-rest case ${name}`, () => {
    const out = got.stdout.get(name) ?? "";
    expect(out.includes("UNPORTED")).toBe(false);
    expect(out).toBe(want.stdout.get(name)!);
    expect(got.stderr.get(name)).toBe(want.stderr.get(name)!);
  });
}
