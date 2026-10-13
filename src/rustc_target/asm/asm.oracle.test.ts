// Oracle test for lane target-asm's `rustc_target::asm` (mod.rs, x86.rs, aarch64.rs, wasm.rs): runs
// asm_oracle/run.ts (the port) and compares its stdout, section by section (`== <target>[@<arch>]`), with
// out.stdout recorded from the rustc-dev probe asm_oracle/probe.rs (see its header for how to regenerate it).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "asm_oracle");

/** `== <name>` headers split a stream into sections (the text before the first header is ""). */
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

const run = Bun.spawnSync(["bun", join(DIR, "run.ts")], { stdout: "pipe", stderr: "pipe" });
const got = sections(run.stdout.toString());
const want = sections(readFileSync(join(DIR, "out.stdout"), "utf8"));

test("run.ts exits cleanly and prints every section", () => {
  expect(run.stderr.toString()).toBe("");
  expect(run.exitCode).toBe(0);
  expect([...got.keys()]).toEqual([...want.keys()]);
});

for (const name of want.keys()) {
  if (name === "") continue;
  test(`asm oracle ${name}`, () => {
    expect(got.get(name)).toBe(want.get(name)!);
  });
}
