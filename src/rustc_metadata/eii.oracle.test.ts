// Oracle check of `get_externally_implementable_items` and its `Decodable` (rmeta/decoder.ts, eii.rs:9), which only the report
// suite run-pass-aux-miri otherwise reaches: no protected case has an EII in another crate. Metadata built by the pinned rustc,
// read by the port; stderr and exit code byte for byte, from `tests/ui/eii/duplicate/duplicate1.rs` with a default added.
//
// What the decoded value shows here: the crates and `DefId`s of the impls, `EiiDecl::name`, and `EiiImpl::is_default`, as
// the default in a third crate is not a third explicit implementation. `run-pass-aux-miri`'s 16 `tests/ui/eii` cases are the
// run-time side.
import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const HERE = join(import.meta.dir, "eii_oracle");
const WORK = join(DATA, "tmp", "eii-oracle-test", `${process.env.RUST_TS_AGENT ?? "default"}-${process.pid}`);
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}

function sysroot_or_undefined(): string | undefined {
  try {
    if (!Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`)) return undefined;
    return Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim();
  } catch {
    return undefined;
  }
}
const SYSROOT = sysroot_or_undefined();
const SKIP = SYSROOT === undefined && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

function args(file: string, ...externs: string[]): string[] {
  return [
    file,
    "--edition=2021",
    "--crate-type=rlib",
    "--emit=metadata",
    "--target=x86_64-unknown-linux-gnu",
    "-Awarnings",
    "--sysroot",
    SYSROOT!,
    "-L",
    WORK,
    "--out-dir",
    WORK,
    ...externs.flatMap((e) => ["--extern", `${e}=${join(WORK, `lib${e}.rmeta`)}`]),
  ];
}
function spawn(cmd: string[]): { stdout: string; stderr: string; code: number } {
  const r = Bun.spawnSync(cmd, { cwd: HERE, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}

test.skipIf(SKIP)(
  "an EII's decl, default and two explicit impls, each in another crate: the error is the oracle's",
  () => {
    mkdirSync(WORK, { recursive: true });
    try {
      for (const a of [args("decl.rs"), args("impl1.rs", "decl"), args("impl2.rs", "decl")]) {
        const aux = spawn([...RUSTC, ...a]);
        expect(aux.stderr).toBe("");
        expect(aux.code).toBe(0);
      }
      const both = args("both.rs", "impl1", "impl2");
      const oracle = spawn([...RUSTC, ...both]);
      const port = spawn([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...both]);
      expect(oracle.code).toBe(1);
      // The program does reach the check, and the default is not counted as a third explicit implementation.
      expect(oracle.stderr).toContain("multiple implementations of `#[eii1]`");
      expect(oracle.stderr).not.toContain("in addition to these two");
      expect(port.stderr).toBe(oracle.stderr);
      expect(port.stdout).toBe(oracle.stdout);
      expect(port.code).toBe(oracle.code);
    } finally {
      rmSync(WORK, { recursive: true, force: true });
    }
  },
  120_000,
);
