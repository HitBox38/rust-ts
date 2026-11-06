// Rewrites the committed oracle output of ../aarch64.oracle.test.ts (lane abi-vtable; not a port).
//   bun src/rustc_target/callconv/aarch64_oracle/regen.ts
//
// Writes oracle/<file> from the pinned rustc, for each of CASES: the program is compiled at -O (some attributes are only
// computed for release builds, see tests/ui/abi/debug.rs) in this directory, so the path in the output stays the same from
// any checkout. Both programs are `#![no_core]`, so neither side needs a `rust-std` for the target. The first line of each
// file is the exit code; the rest is stderr, unchanged.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../../scripts/lib/common.ts";
import { abi_args, CASES, HERE, test_env } from "./common.ts";

const out = join(DATA, "tmp", "aarch64-abi-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(join(HERE, "oracle"), { recursive: true });
for (const c of CASES) {
  rmSync(out, { recursive: true, force: true });
  const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, ...abi_args(c, out)], { cwd: HERE, env: test_env(), stdout: "pipe", stderr: "pipe" });
  if (r.stdout.length !== 0) throw new Error(`ERROR: unexpected stdout from the oracle for ${c.file} on ${c.target}`);
  writeFileSync(join(HERE, "oracle", c.oracle), `${r.exitCode}\n${r.stderr.toString()}`);
}
