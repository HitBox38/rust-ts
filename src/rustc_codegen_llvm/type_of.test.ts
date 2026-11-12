// Oracle facts for type_of.rs / type_.rs (lane cg-types-attrs): the LLVM type the pinned rustc gives each layout shape of
// cg_types_attrs_test/types.rs on x86_64-unknown-linux-gnu, read from its `--emit=llvm-ir`:
// - `llvm_type`: the element type of the `getelementptr` in `g_<Name>` (`x.add(i)` on a `*const Name`);
// - `immediate_llvm_type`: the return type of `i_<Name>` (scalars and scalar pairs, returned directly);
// - the named struct definitions (`%Name = type { .. }`, `<{ .. }>` when packed), field order and padding fillers included.
// The port computes the same from the layouts (cg_types_attrs_test/run.ts `types`) and prints them through the IR model.
import { expect, test } from "bun:test";
import { both } from "./cg_types_attrs_test/both.ts";

test("type_of: llvm_type, immediate_llvm_type and named struct bodies match the oracle's IR (x86_64-unknown-linux-gnu)", () => {
  const r = both("types", "types.rs", ["-Copt-level=0"]);
  if (r === undefined) return;
  const ours = new Map<string, string>();
  for (const line of r.ours.split("\n")) {
    const m = /^(llvm_type|immediate) (\w+) (.*)$/.exec(line);
    if (m) ours.set(`${m[1]} ${m[2]}`, m[3]!);
  }
  const geps = [...r.oracle_ir.matchAll(/^define ptr @g_(\w+)\(.*\nstart:\n\s+%\S+ = getelementptr inbounds nuw (.*), ptr %x, i64 %i$/gm)];
  expect(geps.length).toBe(18);
  for (const [, name, ty] of geps) expect(`${name}: ${ours.get(`llvm_type ${name}`)}`).toBe(`${name}: ${ty}`);
  const rets = [...r.oracle_ir.matchAll(/^define (?:zeroext |signext |noundef |align \d+ )*(.+?) @i_(\w+)\(/gm)];
  expect(rets.length).toBe(6);
  for (const [, ty, name] of rets) expect(`${name}: ${ours.get(`immediate ${name}`)}`).toBe(`${name}: ${ty}`);
  const defs = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("%")).sort();
  expect(defs(r.ours)).toEqual(defs(r.oracle_ir));
  expect(defs(r.ours).length).toBe(10);
}, 120_000);
