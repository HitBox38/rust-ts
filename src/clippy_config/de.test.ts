// de.rs and types.rs, the parts that need no TOML parsing (vendor-toml is wave 42):
// - `create_value_list_msg` and `find_closest_match` against the oracle clippy-driver (oracle/de.oracle.json, made by
//   oracle/capture.ts): the "possible values" notes at several `--diagnostic-width`s, pretty (`pretty-json`) and not
//   (`json`), and the "did you mean" suggestions of unknown field names and bad enum values;
// - the `FromDefault` impls' values, the `conf_enum!` tables, the types' `Debug` and the hand impls' defaults;
// - every `Deserialize` impl reaches toml only through de.ts's toml surface, which stops (`unported`) until vendor-toml.
import { expect, test } from "bun:test";
import { ConfField } from "./conf.gen.ts";
import {
  DeValue,
  type DiagCtxt,
  Deserialize_for_String,
  Deserialize_for_Vec,
  Deserialize_for_bool,
  Deserialize_for_u64,
  FromDefault_for_bool,
  FromDefault_for_u64,
  FromDefault_slice_for_HashSet,
  FromDefault_slice_for_Vec,
  FromDefault_str_for_String,
  FromDefault_unit_for_HashSet,
  FromDefault_unit_for_Option,
  FromDefault_unit_for_Vec,
  type TomlValue,
  create_value_list_msg,
  find_closest_match,
} from "./de.ts";
import {
  Deserialize_for_SourceItemOrdering,
  FromDefault_for_InherentImplLintScope,
  FromDefault_unit_for_SourceItemOrdering,
  FromDefault_unit_for_SourceItemOrderingModuleItemGroupings,
  FromDefault_unit_for_SourceItemOrderingTraitAssocItemKinds,
  FromDefault_unit_for_SourceItemOrderingWithinModuleItemGroupings,
  FromDefault_unit_for_TraitImplItemOrder,
  InherentImplLintScope,
  MatchLintBehaviour,
  SourceItemOrderingCategory,
  SourceItemOrderingModuleItemGroupings,
  SourceItemOrderingModuleItemKind,
  SourceItemOrderingTraitAssocItemKind,
  SourceItemOrderingWithinModuleItemGroupings,
  TraitImplItemOrder,
  debug_SourceItemOrdering,
  debug_SourceItemOrderingModuleItemGroupings,
  debug_SourceItemOrderingTraitAssocItemKinds,
  debug_SourceItemOrderingWithinModuleItemGroupings,
} from "./types.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { PLAIN, PRETTY } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import oracle from "./oracle/de.oracle.json";

const LISTS: Record<string, readonly string[]> = {
  conf_fields: ConfField.SUGG_NAMES,
  module_item_kinds: SourceItemOrderingModuleItemKind.NAMES,
  inherent_impl_lint_scope: InherentImplLintScope.NAMES,
  "inherent-impl-lint-scope": InherentImplLintScope.NAMES,
  "matches-for-let-else": MatchLintBehaviour.NAMES,
  "trait-impl-item-order": TraitImplItemOrder.NAMES,
};

test("create_value_list_msg against the oracle (39 notes)", () => {
  expect(oracle.value_lists.length).toBe(39);
  for (const v of oracle.value_lists) {
    const got = create_value_list_msg({ width: v.width, render_pretty: v.render_pretty }, LISTS[v.list]!);
    expect(`${v.list} @${v.width}${v.render_pretty ? "" : " json"}\n${got}`).toBe(`${v.list} @${v.width}${v.render_pretty ? "" : " json"}\n${v.message}`);
  }
});

test("create_value_list_msg edge cases", () => {
  // one line: at most 8 values whose `` `x`, `` forms fit in the width
  expect(create_value_list_msg({ width: 40, render_pretty: true }, ["ab", "cd"])).toBe("possible values: `ab`, `cd`");
  expect(create_value_list_msg({ width: 35, render_pretty: true }, ["ab", "cd"])).toBe("possible values:\nab\ncd");
  expect(create_value_list_msg({ width: 35, render_pretty: false }, ["ab", "cd"])).toBe("possible values:\nab\ncd");
  // the one-line form takes at most 8 values (`values.len() <= 8`): 28 + 8 * (1 + 2 + 2) = 68 fits a width of 68
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  expect(create_value_list_msg({ width: 68, render_pretty: true }, eight)).toBe(
    "possible values: `a`, `b`, `c`, `d`, `e`, `f`, `g`, `h`",
  );
  expect(create_value_list_msg({ width: 67, render_pretty: false }, eight)).toBe("possible values:\na\nb\nc\nd\ne\nf\ng\nh");
  expect(create_value_list_msg({ width: 500, render_pretty: false }, [...eight, "i"])).toBe(
    "possible values:\na\nb\nc\nd\ne\nf\ng\nh\ni",
  );
  // nine short values: a third column would save only 2 rows (`needed_rows + 3 <= row_count` fails), so two columns;
  // no trailing spaces on the right edge
  const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  expect(create_value_list_msg({ width: 200, render_pretty: true }, nine)).toBe("possible values:\na    f\nb    g\nc    h\nd    i\ne");
});

test("find_closest_match against the oracle (22 suggestions)", () => {
  expect(oracle.suggestions.length).toBe(22);
  for (const s of oracle.suggestions) {
    const probe = s.kind === "field" ? s.field : s.value;
    expect(`${probe} -> ${find_closest_match(probe, LISTS[s.names]!) ?? null}`).toBe(`${probe} -> ${s.suggestion}`);
  }
});

test("find_closest_match: `_`/case are not edits; the first of equal distances wins (`min_by_key`)", () => {
  expect(find_closest_match("aa", ["ab", "ba"])).toBe("ab");
  expect(find_closest_match("aa", ["ba", "ab"])).toBe("ba");
  expect(find_closest_match("A_B", ["a-b", "a_b"])).toBe("a-b");
  expect(find_closest_match("abcdefgh", ["zzzzzzzz"])).toBeUndefined();
});

test("FromDefault: passthrough, unit, str and slice impls", () => {
  expect(FromDefault_for_bool.from_default(true)).toBe(true);
  expect(FromDefault_for_bool.display_default(false)).toBe("false");
  expect(FromDefault_for_u64.from_default(18446744073709551615n)).toBe(18446744073709551615n);
  expect(FromDefault_for_u64.display_default(16384n)).toBe("16384");
  expect(FromDefault_unit_for_Option.from_default(null)).toBeUndefined();
  expect(FromDefault_unit_for_Option.display_default(null)).toBe("");
  expect(FromDefault_unit_for_Vec.from_default(null)).toEqual([]);
  expect(FromDefault_unit_for_Vec.display_default(null)).toBe("[]");
  expect(FromDefault_unit_for_HashSet.from_default(null)).toEqual(new Set());
  expect(FromDefault_unit_for_HashSet.display_default(null)).toBe("[]");
  expect(FromDefault_str_for_String.from_default("a\"b")).toBe('a"b');
  // `DisplayStr` is `Debug` of the str
  expect(FromDefault_str_for_String.display_default('a"b\n')).toBe('"a\\"b\\n"');
  expect(FromDefault_str_for_String.display_default("\u{1}\u{7f}'é")).toBe('"\\u{1}\\u{7f}\'é"');
  const v = FromDefault_slice_for_Vec(FromDefault_str_for_String);
  expect(v.from_default(["x", "y"])).toEqual(["x", "y"]);
  expect(v.display_default([])).toBe("[]");
  expect(v.display_default(["x", "y"])).toBe('["x", "y"]');
  const s = FromDefault_slice_for_HashSet(FromDefault_str_for_String);
  expect(s.from_default(["x", "y", "x"])).toEqual(new Set(["x", "y"]));
  expect(s.display_default(["x"])).toBe('["x"]');
});

test("conf_enum!: NAMES, COUNT, name, from_str, FromDefault", () => {
  expect(MatchLintBehaviour.NAMES).toEqual(["AllTypes", "WellKnownTypes", "Never"]);
  expect(MatchLintBehaviour.COUNT).toBe(3);
  expect(MatchLintBehaviour.name("Never")).toBe("Never");
  expect(MatchLintBehaviour.from_str("WellKnownTypes")).toBe("WellKnownTypes");
  expect(MatchLintBehaviour.from_str("never")).toBeUndefined();
  expect(SourceItemOrderingModuleItemKind.COUNT).toBe(17);
  expect(SourceItemOrderingModuleItemKind.name("TestBinderConstraints")).toBe("test_binder_constraints");
  expect(SourceItemOrderingModuleItemKind.from_str("foreign_mod")).toBe("ForeignMod");
  expect(SourceItemOrderingModuleItemKind.from_str("ForeignMod")).toBeUndefined();
  expect(SourceItemOrderingModuleItemKind.all_variants()).toEqual(
    SourceItemOrderingModuleItemKind.NAMES.map((n) => SourceItemOrderingModuleItemKind.from_str(n)!),
  );
  expect(SourceItemOrderingTraitAssocItemKind.all_variants()).toEqual(["Const", "Fn", "Type"]);
  expect(SourceItemOrderingCategory.name("Struct")).toBe("struct");
  expect(TraitImplItemOrder.from_str("alphabetical_or_trait_item_ordering")).toBe("AlphabeticalOrTraitItemOrdering");
  expect(FromDefault_for_InherentImplLintScope.from_default("File")).toBe("File");
  expect(FromDefault_for_InherentImplLintScope.display_default("Crate")).toBe('"crate"');
});

test("types.rs defaults and Debug", () => {
  const o = FromDefault_unit_for_SourceItemOrdering.from_default(null);
  expect(debug_SourceItemOrdering(o, PLAIN)).toBe("[Enum, Impl, Module, Struct, Trait]");
  expect(o.contains("Module")).toBe(true);

  const g = FromDefault_unit_for_SourceItemOrderingModuleItemGroupings.from_default(null);
  // the default's lut and back_lut are what build_lut / build_back_lut give for its groups
  expect([...g.lut].sort()).toEqual([...SourceItemOrderingModuleItemGroupings.build_lut(g.groups)].sort());
  expect([...g.back_lut].sort()).toEqual([...SourceItemOrderingModuleItemGroupings.build_back_lut(g.groups)].sort());
  expect(g.grouping_names()).toEqual(["modules", "use", "macros", "global_asm", "UPPER_SNAKE_CASE", "PascalCase", "lower_snake_case"]);
  expect(g.grouping_name_of("TestBinderConstraints")).toBe("PascalCase");
  expect(g.module_level_order_of("Fn")).toBe(6);
  expect(g.is_grouping("use")).toBe(true);
  expect(g.is_grouping("Use")).toBe(false);
  expect(debug_SourceItemOrderingModuleItemGroupings(g, PLAIN)).toBe(
    '[("modules", [ExternCrate, Mod, ForeignMod]), ("use", [Use]), ("macros", [Macro]), ("global_asm", [GlobalAsm]), ' +
      '("UPPER_SNAKE_CASE", [Static, Const]), ("PascalCase", [TyAlias, Enum, Struct, Union, Trait, TraitAlias, Impl, ' +
      'TestBinderConstraints]), ("lower_snake_case", [Fn])]',
  );
  // the display_default text lists the same groups, by name
  expect(FromDefault_unit_for_SourceItemOrderingModuleItemGroupings.display_default(null)).toBe(
    JSON.stringify(g.groups.map(([n, items]) => [n, items.map((i) => SourceItemOrderingModuleItemKind.name(i))])).replaceAll(",", ", "),
  );

  const t = FromDefault_unit_for_SourceItemOrderingTraitAssocItemKinds.from_default(null);
  expect(debug_SourceItemOrderingTraitAssocItemKinds(t, PLAIN)).toBe("[Const, Type, Fn]");
  expect(t.index_of("Fn")).toBe(2);

  const w = FromDefault_unit_for_SourceItemOrderingWithinModuleItemGroupings.from_default(null);
  expect(w).toBe(SourceItemOrderingWithinModuleItemGroupings.None);
  expect(SourceItemOrderingWithinModuleItemGroupings.ordered_within(w, "use")).toBe(false);
  expect(SourceItemOrderingWithinModuleItemGroupings.ordered_within(SourceItemOrderingWithinModuleItemGroupings.All, "use")).toBe(true);
  const custom: SourceItemOrderingWithinModuleItemGroupings = { $: "Custom", _0: [{ node: "use", span: DUMMY_SP }] };
  expect(SourceItemOrderingWithinModuleItemGroupings.ordered_within(custom, "use")).toBe(true);
  expect(SourceItemOrderingWithinModuleItemGroupings.ordered_within(custom, "macros")).toBe(false);
  expect(debug_SourceItemOrderingWithinModuleItemGroupings(w, PRETTY)).toBe("None");

  expect(FromDefault_unit_for_TraitImplItemOrder.from_default(null)).toBe("Alphabetical");
});

test("Deserialize impls reach toml only through the vendor-toml surface, which stops", () => {
  const value: TomlValue = {
    span: () => ({ start: 0, end: 1 }),
    get_ref: () => ({ $: "Boolean", _0: true }),
    as_ref: () => ({ $: "Boolean", _0: true }),
  };
  const dcx = {} as DiagCtxt;
  for (const f of [
    () => Deserialize_for_bool.deserialize(dcx, value),
    () => Deserialize_for_u64.deserialize(dcx, value),
    () => Deserialize_for_String.deserialize(dcx, value),
    () => Deserialize_for_Vec(Deserialize_for_String).deserialize(dcx, value),
    () => Deserialize_for_SourceItemOrdering.deserialize(dcx, value),
    () => DeValue.as_table(value.get_ref()),
  ]) {
    expect(f).toThrow(Unported);
  }
});
