// Rewrites the committed oracle output of ../linker_args.oracle.test.ts (lane ssa-linker; not a port). Run by hand only:
//   bun src/rustc_codegen_ssa/back/linker_oracle/regen.ts
//
// For each of CASES (common.ts) it runs the pinned rustc with `--print link-args` and the fake linker, and writes
//   oracle/<case>.args  the printed line (std's `Command` Debug), normalised (common.ts `normalise`); empty when nothing links
//   oracle/<case>.list  the exported-symbols file the linker was given, unchanged, when there is one
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";
import { oracleSysroot } from "../../../../scripts/lib/oracle.ts";
import { CASES, HERE, case_args, fake_cc, normalise } from "./common.ts";

const work = join(DATA, "tmp", "linker-args-oracle", process.env.RUST_TS_AGENT ?? "default");
const sysroot = oracleSysroot();
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "fake"), { recursive: true });
mkdirSync(join(HERE, "oracle"), { recursive: true });
const capture = join(work, "list");
writeFileSync(join(work, "fake", "cc"), fake_cc(capture));
chmodSync(join(work, "fake", "cc"), 0o755);

for (const c of CASES) {
  rmSync(capture, { force: true });
  mkdirSync(join(work, "out", c.name), { recursive: true });
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "link-args", ...case_args(c, work, sysroot)], {
    cwd: work,
    env: { ...process.env, RUSTUP_AUTO_INSTALL: "0", RUSTC_ICE: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = r.stdout.toString();
  // `-Cstrip` on an Apple target runs `rust-objcopy` on the output after the link; the fake linker wrote none, so that step
  // fails, but at the pin rustc only warns about it ("stripping debug info with `rust-objcopy` failed") and exits 0. Every
  // case must exit 0. The line is printed before the linker runs.
  if (r.exitCode !== 0) {
    throw new Error(`ERROR: oracle failed for ${c.name}: ${r.stderr.toString().slice(0, 2000)}`);
  }
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  if (lines.length > 1) throw new Error(`ERROR: more than one line printed for ${c.name}`);
  writeFileSync(join(HERE, "oracle", `${c.name}.args`), lines.length === 0 ? "" : `${normalise(lines[0]!, work, sysroot)}\n`);
  const list_out = join(HERE, "oracle", `${c.name}.list`);
  rmSync(list_out, { force: true });
  if (existsSync(capture)) writeFileSync(list_out, readFileSync(capture));
  console.log(`${c.name}: exit ${r.exitCode}, ${lines.length === 0 ? "no link" : "link-args"}${existsSync(capture) ? ", list" : ""}`);
}
