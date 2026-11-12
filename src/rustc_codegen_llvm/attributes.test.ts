// Oracle facts for attributes.rs (lane cg-types-attrs): the function attribute groups the pinned rustc emits for the fns of
// cg_types_attrs_test/attrs.rs (x86_64-unknown-linux-gnu, `--emit=llvm-ir`, no LLVM passes), under a few flag sets.
// The port applies what `llfn_attrs_from_instance` computes before its first call into another lane's stub (the `optimize`
// arms, `inline_attr`) plus `frame_pointer_type_attr` (cg_types_attrs_test/run.ts `attrs`). The oracle's group, less the
// attributes only the unreached rest adds (`NOT_YET`), must equal the port's set.
import { expect, test } from "bun:test";
import { both } from "./cg_types_attrs_test/both.ts";

/** Attributes added after the first stop (`Session::must_emit_unwind_tables`, `llvm_util::target_cpu`, `needs_plt` in
 *  `declare_raw_fn`, ...): `nonlazybind` (declare.rs), `uwtable`, `cold`, `"probe-stack"`, `"target-cpu"`. */
const NOT_YET = /^(nonlazybind|uwtable|cold|"probe-stack"=.*|"target-cpu"=.*)$/;

/** `attributes #N = { a b "k"="v" }` split into attributes (string values contain no spaces here). */
function split(group: string): string[] {
  return group.split(" ").filter((a) => a !== "");
}

for (const flags of [["-Copt-level=0"], ["-Copt-level=0", "-Zinline-llvm=no"], ["-Copt-level=0", "-Cforce-frame-pointers=yes"], ["-Copt-level=s", "-Cno-prepopulate-passes"], ["-Copt-level=z", "-Cno-prepopulate-passes"]]) {
  test(`attributes: the ported attribute fns give the oracle's set (${flags.join(" ")})`, () => {
    const r = both("attrs", "attrs.rs", flags);
    if (r === undefined) return;
    const groups = new Map<string, string>();
    for (const m of r.oracle_ir.matchAll(/^attributes (#\d+) = \{ (.*) \}$/gm)) groups.set(m[1]!, m[2]!);
    const oracle = new Map<string, string[]>();
    for (const m of r.oracle_ir.matchAll(/^define void @(a_\w+)\(\) unnamed_addr (#\d+)/gm)) oracle.set(m[1]!, split(groups.get(m[2]!)!).filter((a) => !NOT_YET.test(a)));
    expect(oracle.size).toBe(8);
    const ours = new Map<string, string[]>();
    for (const m of r.ours.matchAll(/^attrs (a_\w+) ?(.*)$/gm)) ours.set(m[1]!, split(m[2]!));
    expect(ours.size).toBe(8);
    // As sets: the IR model's printer keeps insertion order where LLVM sorts by attribute kind (handoff, for the llir lanes).
    for (const [name, attrs] of oracle) expect(`${name}: ${[...(ours.get(name) ?? [])].sort().join(" ")}`).toBe(`${name}: ${[...attrs].sort().join(" ")}`);
  }, 120_000);
}
