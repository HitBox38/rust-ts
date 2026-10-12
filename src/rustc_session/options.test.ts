// Unit tests of options.rs behavior that the oracle test (one flag per rustc run) does not reach:
// target-modifier collection across flags, mitigation resets, reparse.
import { expect, test } from "bun:test";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { CodegenOptions, CodegenOptionsTargetModifiers, CollectedOptions, OptionsTargetModifiers, TargetModifier, UnstableOptions } from "./options.ts";
import type { EarlyDiagCtxt, Matches } from "./stand_ins.ts";

const dcx: EarlyDiagCtxt = {
  early_warn: () => {},
  early_fatal: (m: string): never => {
    throw new Error(m);
  },
  early_struct_fatal: (m: string): Diag => {
    throw new Error(m);
  },
};
const matches = (prefix: string, args: [number, string][]): Matches => ({ opt_strs_pos: (nm) => (nm === prefix ? args : []) });

test("defaults", () => {
  const z = UnstableOptions.default();
  expect(z.ui_testing).toBe(false);
  expect(z.parse_crate_root_only).toBe(false);
  expect(z.unpretty).toBe(undefined);
  expect(z.threads).toBe(undefined);
  expect(z.dump_mir_dir).toBe("mir_dump");
  expect(z.uninit_const_chunk_threshold).toBe(16);
  expect(z.cross_crate_inline_threshold).toEqual({ $: "Sometimes", _0: 100 });
  const c = CodegenOptions.default();
  expect(c.opt_level).toBe("0");
  expect(c.embed_bitcode).toBe(true);
  expect(c.remark).toEqual({ $: "Some", _0: [] });
  // each default() builds fresh mutable values
  expect(CodegenOptions.default().link_args).not.toBe(c.link_args);
});

test("-Z sanitizer target modifiers accumulate; others are replaced", () => {
  const collected = CollectedOptions.default();
  const z = UnstableOptions.build(
    dcx,
    matches("Z", [
      [1, "sanitizer=address"],
      [3, "sanitizer=leak"],
      [5, "regparm=2"],
      [7, "regparm=3"],
      [9, "ui-testing"],
    ]),
    collected,
  );
  expect(z.ui_testing).toBe(true);
  expect(z.regparm).toBe(3);
  expect(collected.target_modifiers.get(OptionsTargetModifiers.UnstableOptions("Sanitizer"))).toBe("address,leak");
  expect(collected.target_modifiers.get(OptionsTargetModifiers.UnstableOptions("Regparm"))).toBe("3");
  const mods = CodegenOptions.default();
  const out: TargetModifier[] = [];
  z.gather_target_modifiers(out, collected.target_modifiers);
  mods.gather_target_modifiers(out, collected.target_modifiers);
  expect(out.map((m) => [m.opt.$, m.opt._0, m.value_name])).toEqual([
    ["UnstableOptions", "Regparm", "3"],
    ["UnstableOptions", "Sanitizer", "address,leak"],
  ]);
});

test("mitigations: a later -Z stack-protector resets allow-partial-mitigations", () => {
  const collected = CollectedOptions.default();
  UnstableOptions.build(
    dcx,
    matches("Z", [
      [1, "allow-partial-mitigations=stack-protector"],
      [3, "allow-partial-mitigations=control-flow-guard"],
    ]),
    collected,
  );
  expect([...collected.mitigations.map.entries()].map(([k, v]) => [k, v.index, v.allowed])).toEqual([
    ["StackProtector", 1, true],
    ["ControlFlowGuard", 3, true],
  ]);
  collected.mitigations.reset_mitigation("StackProtector", 5);
  collected.mitigations.reset_mitigation("ControlFlowGuard", 2);
  expect([...collected.mitigations.map.entries()].map(([k, v]) => [k, v.index, v.allowed])).toEqual([
    ["StackProtector", 5, undefined],
    ["ControlFlowGuard", 3, true],
  ]);
});

test("reparse / is_target_modifier", () => {
  expect(CodegenOptionsTargetModifiers.reparse("TargetCpu", "x86-64")).toEqual({ prefix: "C", name: "target-cpu", tech_value: 'Some("x86-64")' });
  expect(CodegenOptionsTargetModifiers.reparse("TargetCpu", "")).toEqual({ prefix: "C", name: "target-cpu", tech_value: "None" });
  expect(OptionsTargetModifiers.reparse(OptionsTargetModifiers.UnstableOptions("Regparm"), "2").tech_value).toBe("Some(2)");
  expect(OptionsTargetModifiers.reparse(OptionsTargetModifiers.UnstableOptions("FixedX18"), "").tech_value).toBe("true");
  expect(new TargetModifier(OptionsTargetModifiers.UnstableOptions("Retpoline"), "no").extend()).toEqual({ prefix: "Z", name: "retpoline", tech_value: "false" });
  expect(OptionsTargetModifiers.is_target_modifier("target-cpu")).toBe(true);
  expect(OptionsTargetModifiers.is_target_modifier("reg_struct_return")).toBe(true);
  expect(OptionsTargetModifiers.is_target_modifier("ui-testing")).toBe(false);
});
