// In-process tests of lane res-macros' ports (macros.rs) on the real `Resolver` (built by
// macros_oracle/with_resolver.ts right after `Resolver::new`). Expected values come from the oracle:
// macros_oracle/expected.json (bun src/rustc_resolve/macros_oracle/gen.ts) and lane bm-a's
// builtins_oracle registry, or (`sub_namespace_match`) are upstream's definition written out.
// The end-to-end comparisons (the whole driver, PENDING on other lanes) are in macros_oracle.test.ts.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import type { Item } from "../rustc_ast/lib.ts";
import { register_builtin_macros } from "../rustc_builtin_macros/lib.ts";
import { MacroKinds } from "../rustc_hir/def.ts";
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { MacroKind } from "../rustc_span/hygiene.ts";
import { debug_Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { NodeId } from "../rustc_ast/node_id.ts";
import { fast_print_path, sub_namespace_match } from "./macros.ts";
import { with_resolver } from "./macros_oracle/with_resolver.ts";

const HERE = import.meta.dir;
const ORACLE = join(HERE, "macros_oracle");
const expected = JSON.parse(readFileSync(join(ORACLE, "expected.json"), "utf8")) as Record<string, { stdout: string; stderr: string; exit: number }>;

/** `== name (n)` section of a resdump output. */
function section(text: string, name: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`== ${name} (`));
  if (i < 0) throw new Error(`no section ${name}`);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l.startsWith("== ") || l === "") break;
    out.push(l);
  }
  return out;
}

test("sub_namespace_match (macros.rs:87)", () => {
  const { BANG, ATTR, DERIVE } = MacroKinds;
  const all = [undefined, BANG, ATTR, DERIVE, MacroKinds.ATTR_BANG, MacroKinds.DERIVE_BANG, MacroKinds.DERIVE_ATTR, MacroKinds.DERIVE_ATTR_BANG];
  for (const candidate of all) {
    for (const requirement of [undefined, ...(["Bang", "Attr", "Derive"] as MacroKind[])]) {
      // "No specific sub-namespace" matches anything; bang macros live apart from attributes + derives.
      const want =
        candidate === undefined || requirement === undefined
          ? true
          : requirement === "Bang"
            ? (candidate & BANG) !== 0
            : (candidate & (ATTR | DERIVE)) !== 0;
      expect({ candidate, requirement, got: sub_namespace_match(candidate, requirement) }).toEqual({ candidate, requirement, got: want });
    }
  }
});

test("fast_print_path gives the expansion descriptions of the oracle (-Zunpretty=expanded,hygiene)", () => {
  const oracle = expected["unit/paths/hygiene"]!.stdout
    .trim()
    .split("\n")
    .map((l) => /kind: Macro\(Bang, "(.*)"\)$/.exec(l)![1]!);
  const got = with_resolver(join(ORACLE, "unit", "paths.rs"), (_r, krate) =>
    krate.items.map((item: Item) => {
      if (item.kind.$ !== "MacCall") throw new Error("test: expected a macro call");
      return Symbol.as_str(fast_print_path(item.kind._0.path));
    }),
  );
  expect(got).toEqual(oracle);
});

test("register_builtin_macro: rustc_builtin_macros registers the oracle's builtins; a second registration is a bug", () => {
  const registry = readFileSync(join(HERE, "..", "rustc_builtin_macros", "builtins_oracle", "out.stdout"), "utf8");
  const oracle = section(registry.replace("== register_builtin_macros", "== register_builtin_macros (0)"), "register_builtin_macros");
  // The second registration is `dcx().bug(..)`: an ICE that unwinds out of the compiler.
  let registered: string[] | undefined;
  expect(() =>
    with_resolver(join(ORACLE, "unit", "paths.rs"), (r) => {
      register_builtin_macros(r);
      registered = [...r.builtin_macros].map(([name, kind]) => `${Symbol.as_str(name)} ${kind.$}`);
      const asm = r.builtin_macros.get(sym.asm)!;
      r.register_builtin_macro(sym.asm, asm);
    }),
  ).toThrow();
  expect(registered).toEqual(oracle);
});

test("record_macro_rule_usage + check_unused_macros: the oracle's UNUSED_MACROS / UNUSED_MACRO_RULES lints", () => {
  // macro_rules_basic.rs, with the state `define_macro` (build_reduced_graph.rs, lane res-graph) and macro
  // resolution leave: every `macro_rules` in `unused_macros` + all its rules in `unused_macro_rules`, then
  // the used macros (`m`, `outer`) removed and the used rules recorded (`m!()` rule 0, `m!(2)` rule 2,
  // `outer!(inner)` rule 0).
  const oracle = section(expected["macro_rules_basic/resdump"]!.stdout, "lint_buffer").map((l) => l.replace(/^NodeId\(\d+\) /, ""));
  const got = with_resolver(join(ORACLE, "cases", "macro_rules_basic.rs"), (r, krate) => {
    const ids = new Map<string, [NodeId, LocalDefId]>();
    let n = 0;
    for (const item of krate.items) {
      if (item.kind.$ !== "MacroDef") continue;
      const ident = item.kind._0;
      n += 1;
      const node_id = NodeId.from_u32(100 + n);
      const def_id = LocalDefId.of((1000 + n) as Parameters<typeof LocalDefId.of>[0]);
      const ext = r.compile_macro(item.kind._1, ident, [], item.span, node_id, r.tcx_.sess.edition());
      if (ext.kind.$ !== "MacroRules") throw new Error("test: expected a macro_rules expander");
      r.local_macro_map.set(def_id, ext);
      r.unused_macros.set(def_id, [node_id, ident]);
      r.unused_macro_rules.set(node_id, [def_id, DenseBitSet.new_filled(ext.kind._0.nrules())]);
      ids.set(ident.as_str(), [node_id, def_id]);
    }
    expect([...ids.keys()]).toEqual(["m", "unused", "outer"]);
    for (const used of ["m", "outer"]) r.unused_macros.delete(ids.get(used)![1]);
    r.record_macro_rule_usage(ids.get("m")![0], 0);
    r.record_macro_rule_usage(ids.get("m")![0], 2);
    r.record_macro_rule_usage(ids.get("outer")![0], 0);
    r.record_macro_rule_usage(NodeId.from_u32(999), 0); // not a macro: ignored
    r.check_unused_macros();
    const lines: string[] = [];
    for (const [, lints] of r.lint_buffer_.map) {
      for (const lint of lints) {
        // The probe runs in cases/ (relative file names); this test passes the absolute path.
        const spans = (lint.span?.primary_spans_() ?? []).map((s) => debug_Span(s, PLAIN).replace(join(ORACLE, "cases") + "/", ""));
        lines.push(`${lint.lint_id.lint.name} [${spans.join(", ")}]`);
      }
    }
    return lines;
  });
  expect(got).toEqual(oracle);
});

test("ResolverExpand bookkeeping (derive markers, derive resolutions, proc macros, impl Trait names, glob delegations)", () => {
  with_resolver(join(ORACLE, "unit", "paths.rs"), (r) => {
    const e1 = 1 as Parameters<typeof r.has_derive_copy>[0];
    expect(r.has_derive_copy(e1)).toBe(false);
    r.containers_deriving_copy.add(e1);
    r.containers_deriving_ord.add(e1);
    expect([r.has_derive_copy(e1), r.has_derive_ord(e1)]).toEqual([true, true]);

    expect(r.take_derive_resolutions(e1)).toBeUndefined();
    r.derive_data.set(e1, { resolutions: [], helper_attrs: [], has_derive_copy: false, has_derive_ord: false });
    expect(r.take_derive_resolutions(e1)).toEqual([]);
    expect(r.derive_data.size).toBe(0);

    r.insert_impl_trait_name(NodeId.from_u32(7), sym.Copy);
    expect(r.impl_trait_names.get(NodeId.from_u32(7))).toBe(sym.Copy);
    r.register_glob_delegation(e1);
    expect(r.glob_delegation_invoc_ids.has(e1)).toBe(true);
    expect(r.registered_attr_tools()).toBe(r.registered_attr_tools_);
    expect(r.registered_lint_tools()).toBe(r.registered_lint_tools_);
    // `MacroKind` sub-namespaces of the dummy extensions (`dummy_ext`, lib.rs:2028).
    expect(MacroKinds.contains(r.dummy_ext("Bang").macro_kinds(), MacroKinds.BANG)).toBe(true);
    expect(MacroKind.descr_expected("Attr")).toBe("attribute");
  });
});
