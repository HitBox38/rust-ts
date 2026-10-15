// Lane coherence: coherence/* on small `#![no_core]` crates through the ported driver (coherence_test/run.ts), against
// the pinned rustc.
//
// 1. `pieces` (coherence_test/run.ts): the per-impl checks of `coherent_trait` and the two inherent-impl checks print
//    exactly the oracle rustc's stderr (E0199 / E0200 / E0390 / E0118 / E0592 / E0658 / E0322 / E0328 / E0120 / E0321
//    and the specialization-trait / restricted-trait errors). The crates are otherwise clean (no wfcheck error, no
//    overlapping impls, no negative auto impls).
// 2. Crates whose checks reach other lanes' stubs (`specialization_graph_of`, extern `TraitDef` decoding, `param_env`'s
//    `normalize_param_env_or_error`, `dyn` lowering) print the oracle's stderr or stop at one of `PENDING`. Each of them
//    is pinned to the oracle's error codes, so it turns into an exact match when those lanes land.
// 3. Inherent impls and their collection order: `inherent_impls` (and `crate_incoherent_impls`) of a crate computed by
//    the port equal the lists the oracle encoded into the crate's metadata (decoded by rustc_metadata from a second
//    crate that has it as `--extern`).
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const DIR = join(import.meta.dir, "coherence_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
const OUT = mkdtempSync(join(tmpdir(), "rust-ts-coherence-"));

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const args = (s: string, file: string, extra: string[] = []): string[] => [
  "--sysroot",
  s,
  "--edition=2021",
  "--crate-type",
  "lib",
  "--emit=metadata",
  "-o",
  join(OUT, file.replace(/\.rs$/, ".rmeta")),
  ...extra,
  file,
];

/** Builds `file` with the oracle into `OUT/lib<name>.rmeta` (an `--extern` for the crates below). */
function oracle_rmeta(s: string, file: string): string {
  const name = file.replace(/\.rs$/, "");
  const out = join(OUT, `lib${name}.rmeta`);
  const r = run(["rustc", `+${PIN.toolchain}`, "--sysroot", s, "--edition=2021", "--crate-type", "lib", "--emit=metadata", "-o", out, file]);
  expect(r.exit).toBe(0);
  return out;
}

/** The exact `unported(..)` texts the PENDING crates stop at today (other lanes' stubs; re-pinned by merge-w17). */
const PENDING = new Set([
  "rustc_metadata::rmeta::decoder::cstore_impl: Decodable for ty::TraitDef", // an extern trait
  "is_sized_raw provider (not ported)", // orphan_local_auto.rs (the PseudoCanonicalInput<Ty> key is ported: small-gaps-19)
  "rustc_middle::ty::normalize_erasing_regions::TyCtxt::try_normalize_erasing_regions", // coerce_unsized.rs
]);

/** PENDING_CRATES cases that print the oracle's stderr since merge-w17: they must not stop. */
const NOW_EXACT = new Set(["unsafety.rs", "object_overlap.rs", "inherent_dyn.rs"]);

const EXACT: [string, string, number][] = [
  // [mode, file, number of errors the oracle reports]
  ["pieces", "unsafety.rs", 4],
  ["pieces", "inherent_err.rs", 5],
  ["pieces", "manual.rs", 6],
  ["pieces", "drop.rs", 2],
  ["pieces", "orphan_local_auto_ok.rs", 0],
];

for (const [mode, file, n] of EXACT) {
  test(`coherence_test/${file}: ${mode} prints the oracle's stderr`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file)]);
    const ours = run(["bun", join(DIR, "run.ts"), mode, ...args(s, file)]);
    // `n` errors and the "aborting due to" line.
    expect([...oracle.stderr.matchAll(/^error/gm)].length).toBe(n === 0 ? 0 : n + 1);
    expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

const PENDING_CRATES: [string, string, string[], string | undefined][] = [
  // [mode, file, error codes the oracle reports, `--extern` aux crate]
  ["check", "unsafety.rs", ["E0199", "E0200", "E0199", "E0200"], undefined],
  ["pieces", "orphan_e0210.rs", ["E0210", "E0210"], "orphan_aux.rs"],
  ["pieces", "orphan_e0117.rs", ["E0117", "E0117"], "orphan_aux.rs"],
  ["pieces", "orphan_auto.rs", ["E0321", "E0117"], "orphan_aux.rs"],
  ["pieces", "orphan_local_auto.rs", ["E0321"], undefined],
  ["pieces", "copy.rs", ["E0204", "E0206"], undefined],
  ["pieces", "coerce_unsized.rs", ["E0375", "E0377"], undefined],
  ["pieces", "object_overlap.rs", ["E0371"], undefined],
  ["pieces", "inherent_dyn.rs", ["E0785"], undefined],
];

for (const [mode, file, codes, aux] of PENDING_CRATES) {
  test(`coherence_test/${file}: ${mode} prints the oracle's stderr, or stops as PENDING`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const extra = aux === undefined ? [] : ["--extern", `${aux.replace(/\.rs$/, "")}=${oracle_rmeta(s, aux)}`];
    const oracle = run(["rustc", `+${PIN.toolchain}`, ...args(s, file, extra)]);
    expect([...oracle.stderr.matchAll(/^error\[(E\d+)\]/gm)].map((m) => m[1])).toEqual(codes);
    const ours = run(["bun", join(DIR, "run.ts"), mode, ...args(s, file, extra)]);
    const m = /unported: (.*)\n/.exec(ours.stderr);
    if (NOW_EXACT.has(file)) expect(m).toBeNull();
    if (m !== null) expect(PENDING).toContain(m[1]!);
    else expect({ exit: ours.exit, stderr: ours.stderr }).toEqual({ exit: oracle.exit, stderr: oracle.stderr });
  }, 120_000);
}

const ORDER: [string, string, string][] = [
  // [file, local mode, extern mode]
  ["inherent.rs", "inherent", "extern"],
  ["inherent_core.rs", "inherent", "extern"],
  ["inherent_core.rs", "incoherent", "extern-incoherent"],
];

for (const [file, local, ext] of ORDER) {
  test(`coherence_test/${file}: ${local} equals the oracle's metadata (${ext})`, () => {
    const s = sysroot();
    if (s === undefined) {
      if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
      return;
    }
    const name = file.replace(/\.rs$/, "");
    const rmeta = oracle_rmeta(s, file);
    const ours = run(["bun", join(DIR, "run.ts"), local, ...args(s, file)]);
    expect(ours.exit).toBe(0);
    const user = join(OUT, `${name}_user.rs`);
    writeFileSync(user, `#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\nextern crate ${name};\n`);
    const theirs = run(["bun", join(DIR, "run.ts"), ext, ...args(s, user, ["--extern", `${name}=${rmeta}`])]);
    expect(theirs.exit).toBe(0);
    const lines = ours.stdout.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(3);
    expect(theirs.stdout.replaceAll(` ${name}::`, " ")).toBe(ours.stdout);
  }, 120_000);
}
