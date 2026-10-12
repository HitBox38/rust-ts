// rust-ts tests (not an upstream test file) for the hand-ported parts of rustc_feature.
import { expect, test } from "bun:test";
import { create_default_session_globals_then, DUMMY_SP } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { Panic } from "../std/panic.ts";
import { PLAIN } from "../std/fmt.ts"; // Debug of Symbol is the quoted string (symbol.rs `impl Debug for Symbol`)
import {
  find_feature_issue,
  find_gated_cfg,
  Features,
  GateIssue,
  is_builtin_attr_name,
  TRACK_FEATURE,
  UnstableFeatures,
} from "./lib.ts";
import { debug_Feature } from "./lib.ts";
import { ACCEPTED_LANG_FEATURES } from "./accepted.ts";

test("Features: enabled / per-feature methods / incomplete / internal", () => {
  create_default_session_globals_then(() => {
    const tracked: Symbol[] = [];
    const prev = TRACK_FEATURE.swap((s) => tracked.push(s));
    try {
      const f = Features.default();
      expect(f.gca()).toBe(false);
      f.set_enabled_lang_feature({ gate_name: sym.gca_adts, attr_sp: DUMMY_SP, stable_since: undefined });
      f.set_enabled_lib_feature({ gate_name: Symbol.intern("core_intrinsics"), attr_sp: DUMMY_SP });
      f.set_enabled_lib_feature({ gate_name: Symbol.intern("foo_internals"), attr_sp: DUMMY_SP });
      f.set_enabled_lib_feature({ gate_name: Symbol.intern("foo_bar"), attr_sp: DUMMY_SP });
      expect(f.gca_adts()).toBe(true);
      expect(f.gca()).toBe(true); // gca_min_const_items() is false, gca_adts() true
      expect(tracked).toEqual([sym.gca_adts, sym.gca_adts]);
      expect(f.enabled_features_iter_stable_order().map(([s]) => Symbol.as_str(s))).toEqual(["gca_adts", "core_intrinsics", "foo_internals", "foo_bar"]);
      expect(f.incomplete(sym.gca_adts)).toBe(true);
      expect(f.incomplete(sym.rustc_attrs)).toBe(false);
      expect(f.internal(sym.rustc_attrs)).toBe(true);
      expect(f.internal(sym.gca_adts)).toBe(false);
      // Library features: never incomplete; internal by name.
      expect(f.incomplete(Symbol.intern("foo_bar"))).toBe(false);
      expect(f.internal(Symbol.intern("core_intrinsics"))).toBe(true);
      expect(f.internal(Symbol.intern("foo_internals"))).toBe(true);
      expect(f.internal(Symbol.intern("foo_bar"))).toBe(false);
      expect(() => f.internal(Symbol.intern("not_enabled"))).toThrow(new Panic("`not_enabled` was not listed in `declare_features`"));
    } finally {
      TRACK_FEATURE.swap(prev);
    }
  });
});

test("find_feature_issue / to_nonzero / Debug", () => {
  create_default_session_globals_then(() => {
    expect(find_feature_issue(sym.type_changing_struct_update, GateIssue.Language)).toBe(86555);
    expect(find_feature_issue(sym.allocator_internals, GateIssue.Language)).toBe(undefined);
    expect(find_feature_issue(sym.box_syntax, GateIssue.Language)).toBe(49733); // removed
    expect(find_feature_issue(sym.asm_const, GateIssue.Language)).toBe(93332); // accepted
    expect(find_feature_issue(sym.asm_const, { $: "Library", _0: 7 })).toBe(7);
    expect(() => find_feature_issue(Symbol.intern("nope"), GateIssue.Language)).toThrow(new Panic("feature `nope` is not declared anywhere"));
    expect(debug_Feature(ACCEPTED_LANG_FEATURES[0]!, PLAIN)).toBe('Feature { name: "test_accepted_feature", since: "1.0.0", issue: None }');
    expect(debug_Feature(ACCEPTED_LANG_FEATURES[1]!, PLAIN)).toBe('Feature { name: "aarch64_target_feature", since: "1.61.0", issue: Some(44839) }');
  });
});

test("find_gated_cfg / is_builtin_attr_name / UnstableFeatures", () => {
  const g = find_gated_cfg(sym.target_has_reliable_f128)!;
  expect([g[0], g[1]]).toEqual([sym.target_has_reliable_f128, sym.cfg_target_has_reliable_f16_f128]);
  const f = Features.default();
  expect(g[2](f)).toBe(false);
  f.set_enabled_lang_feature({ gate_name: sym.cfg_target_has_reliable_f16_f128, attr_sp: DUMMY_SP, stable_since: undefined });
  expect(g[2](f)).toBe(true);
  expect(find_gated_cfg(sym.test)).toBe(undefined);
  expect(is_builtin_attr_name(sym.rustc_dummy)).toBe(true);
  expect(is_builtin_attr_name(sym.cfg)).toBe(true);
  expect(is_builtin_attr_name(sym.test)).toBe(false);
  expect(UnstableFeatures.from_environment_value(undefined, { $: "Err", _0: "NotPresent" })).toBe("Allow");
  expect(UnstableFeatures.is_nightly_build("Allow")).toBe(true);
  expect(UnstableFeatures.is_nightly_build("Cheat")).toBe(true);
  expect(UnstableFeatures.is_nightly_build("Disallow")).toBe(false);
});
