// Oracle test for `#[derive]` (derive.rs) and the derive infrastructure (deriving/mod.rs,
// deriving/generic/mod.rs): runs derive_oracle/run.ts (the port) on derive_oracle/cases.txt and compares
// its stdout and stderr, case by case, with out.stdout / out.stderr recorded from the rustc-dev probe
// derive_oracle/probe.rs (see its header for how to regenerate them). Pending cases need lane
// bm-derive-b (the individual derives): the probe records their output, the port must stop at an
// `unported` path; once bm-derive-b lands, clear their pending column and they must match.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "derive_oracle");

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

test("run.ts exits like the probe's run_compiler (FatalError caught) and prints every case", () => {
  expect(run.exitCode).toBe(0);
  expect([...got.stdout.keys()]).toEqual([...want.stdout.keys()]);
  expect([...got.stderr.keys()]).toEqual([...want.stderr.keys()]);
});

for (const name of want.stdout.keys()) {
  if (name === "") continue;
  if (pending.has(name)) {
    test(`derive case ${name} (pending: stops at an unported path)`, () => {
      expect(got.stdout.get(name) ?? "").toStartWith("UNPORTED: ");
    });
    continue;
  }
  test(`derive case ${name}`, () => {
    const out = got.stdout.get(name) ?? "";
    expect(out.startsWith("UNPORTED")).toBe(false);
    expect(out).toBe(want.stdout.get(name)!);
    expect(got.stderr.get(name)).toBe(want.stderr.get(name)!);
  });
}
