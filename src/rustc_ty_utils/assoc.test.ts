// Lane assoc-opaque: the `associated_item_def_ids`, `associated_types_for_impl_traits_in_trait_or_impl` and
// `associated_item` providers (rustc_ty_utils/assoc.rs) on a no_core trait, a trait impl and an inherent impl, through
// the ported driver (assoc_test/run.ts). The expected report (assoc_test/assoc.expected.txt) was checked by reading
// assoc.rs: definition order, RPITITs (none: every fn maps to `[]`, an inherent impl to `{}`), `has_self` from the
// first `fn_arg_idents` entry, and the container of each item.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "assoc_test");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

test("assoc_test/assoc.rs: associated items of a trait, a trait impl and an inherent impl", () => {
  const s = sysroot();
  if (s === undefined) {
    if (REQUIRE) throw new Error("ERROR: oracle sysroot missing");
    return;
  }
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--crate-type", "lib", "--edition=2021", "assoc.rs"];
  const r = Bun.spawnSync(["bun", join(DIR, "run.ts"), ...args], { cwd: DIR, env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" }, stdout: "pipe", stderr: "pipe" });
  expect({ exit: r.exitCode, stdout: r.stdout.toString() }).toEqual({ exit: 0, stdout: readFileSync(join(DIR, "assoc.expected.txt"), "utf8") });
}, 120_000);
