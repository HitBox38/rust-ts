// Unit tests for lane res-ident (compiler/rustc_resolve/src/ident.rs).
//
// A real `Resolver` is built the way resolver_new.test.ts builds it (an empty `#![no_core]` crate,
// edition 2015, `Resolver::new` exactly as `resolver_for_lowering_raw` calls it); the tests then plant
// declarations into its module graph by hand (the graph builder, build_reduced_graph.rs, is lane
// res-graph's) and drive the scope walk and the path/ident resolution entry points of ident.rs.
// Expected results follow the upstream code paths named in each test (no oracle run: the resdump
// `partial_res_map` of a real crate needs expansion, imports and late resolution, other lanes' code).
//
// PENDING: cases that reach another lane's unported stub (name -> the `unported` they reach). Each such
// case keeps its full upstream-derived expectations; until the stub is ported the test checks that it
// stops at exactly that point. Root deletes an entry once the owning lane lands and the case passes.
import { expect, test } from "bun:test";
import { join } from "node:path";
import "./lib.ts";
import { type Attribute, type Crate } from "../rustc_ast/lib.ts";
import { NodeId } from "../rustc_ast/node_id.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import * as rustc_expand_config from "../rustc_expand/config.ts";
import { pre_configure_attrs } from "../rustc_expand/config.ts";
import { DefKind, type Namespace } from "../rustc_hir/def.ts";
import { Definitions } from "../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../rustc_interface/passes.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../rustc_middle/hooks.ts";
import { clone_ExternProviders, clone_Providers } from "../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Visibility } from "../rustc_middle/ty/mod.ts";
import { query_system } from "../rustc_query_impl/lib.ts";
import { CRATE_DEF_ID, LocalDefId, ModId, StableCrateId } from "../rustc_span/def_id.ts";
import { ExpnId, LocalExpnId } from "../rustc_span/hygiene.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import type { MutRef } from "../std/mut_ref.ts";
import { panic, Unported, unported } from "../std/panic.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { UsePrelude } from "./ident.ts";
import { NameResolution } from "./imports.ts";
import { Rib, type RibKind } from "./late.ts";
import {
  BindingKey,
  CmRefCell,
  type Decl,
  ExternPreludeEntry,
  Finalize,
  IdentKey,
  Ident_key,
  type Module,
  type ModuleOrUniformRoot,
  ParentScope,
  type PathResult,
  provide,
  type Res,
  Resolver,
  type Scope,
  type ScopeSet,
  Segment,
} from "./lib.ts";
import type { MacroRulesScope } from "./macros.ts";

const HERE = import.meta.dir;
const ARGS = ["--target", "x86_64-unknown-linux-gnu", "--edition=2015", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", join(HERE, "resolve_oracle", "empty.rs")];

// ---- setup (as resolver_new.test.ts) -------------------------------------------------------------

class CaptureConfig extends Error {}

function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("no config");
  return config;
}

const NO_CSTORE = new Proxy({}, { get: () => () => unported("rustc_metadata::creader::CStore (wave 11)") }) as unknown as CrateStore;

function with_tcx<R>(f: (tcx: TyCtxt) => R): R {
  const config = config_from_args(ARGS);
  let out: R | undefined;
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const krate = parse(sess);
    const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
    const crate_name = Symbol.intern("empty");
    const stable_crate_id = StableCrateId.new(crate_name, true, [...sess.opts.cg.metadata], sess.cfg_version);
    const untracked = new Untracked(NO_CSTORE, [], Definitions.new(stable_crate_id), new Map(), undefined);
    const base = DEFAULT_QUERY_PROVIDERS();
    const queries = clone_Providers(base.queries);
    const extern = clone_ExternProviders(base.extern_queries);
    const hooks = clone_HookProviders(base.hooks);
    provide(queries);
    out = TyCtxt.create_global_ctxt(
      { value: undefined },
      sess,
      ["Executable"],
      stable_crate_id,
      untracked,
      undefined,
      DepGraph.new_disabled(),
      query_system(queries, extern, undefined, false, false),
      hooks,
      CurrentGcx.new(),
      (tcx) => {
        const r = tcx.create_crate_num(stable_crate_id);
        if (r.$ !== "Ok") return panic("create_crate_num");
        r._0.crate_name(crate_name);
        const unit = tcx.feed_unit_query();
        unit.features_query(rustc_expand_config.features(tcx.sess, pre_configured_attrs, crate_name));
        unit.crate_for_resolver(Steal.new<[Crate, Attribute[]]>([krate, pre_configured_attrs], "(rustc_ast::ast::Crate, thin_vec::ThinVec<rustc_ast::ast::Attribute>)"));
        return f(tcx);
      },
    );
  });
  return out as R;
}

/** `resolver_for_lowering_raw` up to `Resolver::new` (passes.rs:791), then `f`. */
function with_resolver<R>(f: (r: Resolver, tcx: TyCtxt) => R): R {
  return with_tcx((tcx) => {
    const arenas = Resolver.arenas();
    void tcx.registered_attr_tools(null);
    void tcx.registered_lint_tools(null);
    const [krate, pre_configured_attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
    const r = Resolver.new(tcx, pre_configured_attrs, krate.spans.inner_span, krate.spans.inject_use_span, arenas);
    return f(r, tcx);
  });
}

// ---- helpers ---------------------------------------------------------------------------------------

const PENDING: Record<string, string> = {
  // A finalized path ends in `lint_if_path_starts_with_module` (diagnostics/impls.rs).
  "resolve_path [crate] with finalize records the crate root res": "rustc_resolve::diagnostics::impls::Resolver::lint_if_path_starts_with_module",
};

function case_(name: string, f: () => void): void {
  test(name, () => {
    const pending = PENDING[name];
    if (pending !== undefined) {
      let err: unknown;
      try {
        f();
      } catch (e) {
        err = e;
      }
      expect<unknown>(err).toBeInstanceOf(Unported);
      expect<unknown>((err as Unported).what).toBe(pending);
      return;
    }
    f();
  });
}

const ident = (s: string): Ident => Ident.new(Symbol.intern(s), DUMMY_SP);
const kwi = (name: Symbol): Ident => Ident.new(name, DUMMY_SP);
const root_scope = (r: Resolver): ParentScope => ParentScope.module(r.graph_root, r.arenas);
const crate_def_id = () => LocalDefId.to_def_id(CRATE_DEF_ID);

function def_decl(r: Resolver, kind: DefKind, expansion: LocalExpnId = LocalExpnId.ROOT): Decl {
  return r.arenas.new_pub_def_decl({ $: "Def", _0: kind, _1: crate_def_id() }, DUMMY_SP, expansion);
}

function attr_decl(r: Resolver, res: Res): Decl {
  return r.arenas.new_pub_def_decl(res, DUMMY_SP, LocalExpnId.ROOT);
}

/** Plants a `NameResolution` for `name` in `ns` of the local `module` (what build_reduced_graph's `define_local` does). */
function plant(r: Resolver, module: Module, name: Ident, ns: Namespace, non_glob: Decl | undefined, glob?: Decl): void {
  r.resolutions(module).set(BindingKey.new(IdentKey.new(name), ns), CmRefCell.new(new NameResolution(new Set(), non_glob, glob, name.span)));
}

/** The scopes `visit_scopes` visits, as `Scope` tags (module scopes tagged with which module). */
function visited(r: Resolver, scope_set: ScopeSet, parent_scope: ParentScope, names: Map<Module, string>, stop_at?: string): [string[], string | undefined] {
  const seen: string[] = [];
  const brk = r.visit_scopes<string>(scope_set, parent_scope, IdentKey.new(ident("x")).ctxt, DUMMY_SP, undefined, (_this, scope) => {
    const tag = scope.$ === "ModuleNonGlobs" || scope.$ === "ModuleGlobs" ? `${scope.$}(${names.get(scope._0) ?? "?"})` : scope.$;
    seen.push(tag);
    return tag === stop_at ? { $: "Break", _0: tag } : { $: "Continue", _0: null };
  });
  return [seen, brk];
}

function scope_result(r: Resolver, name: Ident, ns: Namespace, scope: Scope, scope_set: ScopeSet, finalize?: Finalize, parent_scope?: ParentScope) {
  return r.resolve_ident_in_scope(IdentKey.new(name), name.span, ns, scope, "Yes", scope_set, parent_scope ?? root_scope(r), finalize, undefined, undefined);
}

const finalize = (): Finalize => Finalize.new(NodeId.from_u32(7), DUMMY_SP);
const failed = (p: PathResult) => {
  if (p.$ !== "Failed") throw new Error(`expected Failed, got ${p.$}`);
  return p;
};

// ---- impl From<UsePrelude> for bool ----------------------------------------------------------------

test("UsePrelude -> bool", () => {
  expect<unknown>(UsePrelude.bool_from("Yes")).toBe(true);
  expect<unknown>(UsePrelude.bool_from("No")).toBe(false);
});

// ---- visit_scopes: the scope order of each ScopeSet --------------------------------------------------

test("visit_scopes visits the scopes of each ScopeSet in upstream order", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const names = new Map<Module, string>([[root, "root"], [r.empty_module, "empty"]]);
    const ps = root_scope(r);
    const v = (s: ScopeSet, p = ps) => visited(r, s, p, names)[0];

    expect<unknown>(v({ $: "All", _0: "TypeNS" })).toEqual([
      "ModuleNonGlobs(root)",
      "ModuleGlobs(root)",
      "ExternPreludeItems",
      "ExternPreludeFlags",
      "ToolAttributePrelude",
      "StdLibPrelude",
      "BuiltinTypes",
    ]);
    expect<unknown>(v({ $: "All", _0: "ValueNS" })).toEqual(["ModuleNonGlobs(root)", "ModuleGlobs(root)", "StdLibPrelude"]);
    expect<unknown>(v({ $: "All", _0: "MacroNS" })).toEqual([
      "DeriveHelpers",
      "DeriveHelpersCompat",
      "MacroRules",
      "ModuleNonGlobs(root)",
      "ModuleGlobs(root)",
      "MacroUsePrelude",
      "StdLibPrelude",
      "BuiltinAttrs",
    ]);
    // Derive helpers of the same container are not in scope for derives.
    expect<unknown>(v({ $: "Macro", _0: "Derive" })[0]).toBe("DeriveHelpersCompat");
    expect<unknown>(v({ $: "Macro", _0: "Bang" })[0]).toBe("DeriveHelpers");
    expect<unknown>(v({ $: "Module", _0: "TypeNS", _1: root })).toEqual(["ModuleNonGlobs(root)", "ModuleGlobs(root)"]);
    expect<unknown>(v({ $: "Module", _0: "MacroNS", _1: root })).toEqual(["ModuleNonGlobs(root)", "ModuleGlobs(root)"]);
    expect<unknown>(v({ $: "ModuleAndExternPrelude", _0: "TypeNS", _1: root })).toEqual([
      "ModuleNonGlobs(root)",
      "ModuleGlobs(root)",
      "ExternPreludeItems",
      "ExternPreludeFlags",
    ]);
    expect<unknown>(v({ $: "ModuleAndExternPrelude", _0: "ValueNS", _1: root })).toEqual(["ModuleNonGlobs(root)", "ModuleGlobs(root)"]);
    expect<unknown>(v({ $: "ExternPrelude" })).toEqual(["ExternPreludeItems", "ExternPreludeFlags"]);

    // `#[no_implicit_prelude]` (the empty module): no extern/tool/std preludes; the language prelude stays.
    const ps_empty = ParentScope.module(r.empty_module, r.arenas);
    expect<unknown>(v({ $: "All", _0: "TypeNS" }, ps_empty)).toEqual(["ModuleNonGlobs(empty)", "ModuleGlobs(empty)", "BuiltinTypes"]);
    expect<unknown>(v({ $: "All", _0: "ValueNS" }, ps_empty)).toEqual(["ModuleNonGlobs(empty)", "ModuleGlobs(empty)"]);
    // `macro_use` prelude stays visible to 2015-edition idents; the std prelude is always visited in MacroNS.
    expect<unknown>(v({ $: "All", _0: "MacroNS" }, ps_empty)).toEqual([
      "DeriveHelpers",
      "DeriveHelpersCompat",
      "MacroRules",
      "ModuleNonGlobs(empty)",
      "ModuleGlobs(empty)",
      "MacroUsePrelude",
      "StdLibPrelude",
      "BuiltinAttrs",
    ]);
    // ExternPrelude / ModuleAndExternPrelude visit the extern prelude even without the implicit prelude.
    expect<unknown>(v({ $: "ExternPrelude" }, ps_empty)).toEqual(["ExternPreludeItems", "ExternPreludeFlags"]);
  });
});

test("visit_scopes walks out of a block to its parent module (hygienic_lexical_parent)", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const block = r.new_local_module(root, { $: "Block" }, ExpnId.root(), DUMMY_SP, false);
    const names = new Map<Module, string>([[root, "root"], [block, "block"]]);
    const ps = ParentScope.module(block, r.arenas);
    expect<unknown>(visited(r, { $: "All", _0: "ValueNS" }, ps, names)[0]).toEqual([
      "ModuleNonGlobs(block)",
      "ModuleGlobs(block)",
      "ModuleNonGlobs(root)",
      "ModuleGlobs(root)",
      "StdLibPrelude",
    ]);
    expect<unknown>(r.hygienic_lexical_parent(block, { value: IdentKey.new(ident("x")).ctxt }, undefined)).toEqual([root, undefined]);
    expect<unknown>(r.hygienic_lexical_parent(root, { value: IdentKey.new(ident("x")).ctxt }, undefined)).toBeUndefined();
  });
});

test("visit_scopes stops at the first Break and returns its value", () => {
  with_resolver((r) => {
    const names = new Map<Module, string>([[r.graph_root, "root"]]);
    const [seen, brk] = visited(r, { $: "All", _0: "TypeNS" }, root_scope(r), names, "ExternPreludeFlags");
    expect<unknown>(seen).toEqual(["ModuleNonGlobs(root)", "ModuleGlobs(root)", "ExternPreludeItems", "ExternPreludeFlags"]);
    expect<unknown>(brk).toBe("ExternPreludeFlags");
  });
});

test("visit_scopes walks macro_rules scopes, compressing expanded invocations", () => {
  with_resolver((r) => {
    const names = new Map<Module, string>([[r.graph_root, "root"]]);
    const box = (s: MacroRulesScope): MutRef<MacroRulesScope> => r.arenas.alloc_macro_rules_scope(s);

    // `Invocation(e1)` whose expansion produced `Empty`: compressed in place to `Empty`.
    const e1 = LocalExpnId.fresh_empty();
    r.output_macro_rules_scopes.set(e1, box({ $: "Empty" }));
    const ps1 = root_scope(r);
    ps1.macro_rules = box({ $: "Invocation", _0: e1 });
    const [s1] = visited(r, { $: "All", _0: "MacroNS" }, ps1, names);
    expect<unknown>(s1.slice(0, 4)).toEqual(["DeriveHelpers", "DeriveHelpersCompat", "MacroRules", "ModuleNonGlobs(root)"]);
    expect<unknown>(ps1.macro_rules.value).toEqual({ $: "Empty" });

    // `Def(m)` -> its parent `Invocation(e2)` (not expanded yet: kept) -> the invocation's parent scope.
    const e2 = LocalExpnId.fresh_empty();
    const inv_parent = root_scope(r);
    r.invocation_parent_scopes.set(e2, inv_parent);
    const m = ident("m");
    const ps2 = root_scope(r);
    ps2.macro_rules = box({
      $: "Def",
      _0: { decl: def_decl(r, { $: "Macro", _0: 1 as never }), parent_macro_rules_scope: box({ $: "Invocation", _0: e2 }), ident: IdentKey.new(m), orig_ident_span: DUMMY_SP },
    });
    const [s2] = visited(r, { $: "All", _0: "MacroNS" }, ps2, names);
    expect<unknown>(s2.slice(0, 6)).toEqual(["DeriveHelpers", "DeriveHelpersCompat", "MacroRules", "MacroRules", "MacroRules", "ModuleNonGlobs(root)"]);
    const def = ps2.macro_rules.value;
    expect<unknown>(def.$ === "Def" && def._0.parent_macro_rules_scope.value.$).toBe("Invocation");
  });
});

// ---- resolve_ident_in_scope: one scope at a time ------------------------------------------------------

test("resolve_ident_in_scope: module non-glob scope", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const foo = ident("foo");
    const d = def_decl(r, DefKind.Struct);
    plant(r, root, foo, "TypeNS", d);
    const all_t: ScopeSet = { $: "All", _0: "TypeNS" };
    const non_globs: Scope = { $: "ModuleNonGlobs", _0: root, _1: undefined };

    // Items are not shadowable: found and accessible -> `Ok`.
    expect<unknown>(scope_result(r, foo, "TypeNS", non_globs, all_t)).toEqual({ $: "Ok", _0: d });
    // Nothing in this namespace and no unexpanded macros: a determinate miss, continue outwards.
    expect<unknown>(scope_result(r, foo, "ValueNS", non_globs, { $: "All", _0: "ValueNS" })).toEqual({ $: "Err", _0: { $: "Continue", _0: "Determined" } });
    // An unexpanded macro could still define the name.
    root.unexpanded_invocations.value.add(LocalExpnId.fresh_empty());
    expect<unknown>(scope_result(r, ident("bar"), "TypeNS", non_globs, all_t)).toEqual({ $: "Err", _0: { $: "Continue", _0: "Undetermined" } });
  });
});

test("resolve_ident_in_scope: finalize goes through finalize_module_binding (non-globs and globs)", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const foo = ident("foo");
    const d = def_decl(r, DefKind.Struct);
    const g = def_decl(r, DefKind.Enum);
    plant(r, root, foo, "TypeNS", d, g);
    const mod_t: ScopeSet = { $: "Module", _0: "TypeNS", _1: root };
    expect<unknown>(scope_result(r, foo, "TypeNS", { $: "ModuleNonGlobs", _0: root, _1: undefined }, mod_t, finalize())).toEqual({ $: "Ok", _0: d });
    expect<unknown>(scope_result(r, foo, "TypeNS", { $: "ModuleGlobs", _0: root, _1: undefined }, mod_t, finalize())).toEqual({ $: "Ok", _0: g });
    expect<unknown>(scope_result(r, ident("nope"), "TypeNS", { $: "ModuleGlobs", _0: root, _1: undefined }, mod_t, finalize())).toEqual({
      $: "Err",
      _0: { $: "Continue", _0: "Determined" },
    });
    expect<unknown>(r.privacy_errors.length).toBe(0);
  });
});

test("resolve_ident_in_scope: a found name in a derive-fallback module buffers PROC_MACRO_DERIVE_RESOLUTION_FALLBACK", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const foo = ident("foo");
    const d = def_decl(r, DefKind.Struct);
    plant(r, root, foo, "TypeNS", d);
    const lint_id = NodeId.from_u32(42);
    const before = r.lint_buffer_.map.size;
    expect<unknown>(scope_result(r, foo, "TypeNS", { $: "ModuleNonGlobs", _0: root, _1: lint_id }, { $: "All", _0: "TypeNS" })).toEqual({ $: "Ok", _0: d });
    expect<unknown>(r.lint_buffer_.map.size).toBe(before + 1);
    expect<unknown>(r.lint_buffer_.map.get(lint_id)?.length).toBe(1);
  });
});

test("resolve_ident_in_scope: language, tool, macro_use, extern and std preludes", () => {
  with_resolver((r) => {
    const all = (ns: Namespace): ScopeSet => ({ $: "All", _0: ns });
    const det = { $: "Err", _0: { $: "Continue", _0: "Determined" } };

    const u8 = scope_result(r, kwi(sym.u8), "TypeNS", { $: "BuiltinTypes" }, all("TypeNS"));
    expect<unknown>(u8).toEqual({ $: "Ok", _0: r.builtin_type_decls.get(sym.u8) });
    // `f16` without the feature is an error only when finalizing.
    expect<unknown>(scope_result(r, kwi(sym.f16), "TypeNS", { $: "BuiltinTypes" }, all("TypeNS"))).toEqual({ $: "Ok", _0: r.builtin_type_decls.get(sym.f16) });
    expect<unknown>(scope_result(r, ident("foo"), "TypeNS", { $: "BuiltinTypes" }, all("TypeNS"))).toEqual(det);

    const inline = scope_result(r, kwi(sym.inline), "MacroNS", { $: "BuiltinAttrs" }, all("MacroNS"));
    expect<unknown>(inline.$ === "Ok" && inline._0.res()).toEqual({ $: "NonMacroAttr", _0: { $: "Builtin", _0: sym.inline } });
    expect<unknown>(scope_result(r, ident("foo"), "MacroNS", { $: "BuiltinAttrs" }, all("MacroNS"))).toEqual(det);

    const rustfmt = scope_result(r, kwi(sym.rustfmt), "TypeNS", { $: "ToolAttributePrelude" }, all("TypeNS"));
    expect<unknown>(rustfmt.$ === "Ok" && rustfmt._0.res()).toEqual({ $: "ToolMod" });
    expect<unknown>(scope_result(r, ident("foo"), "TypeNS", { $: "ToolAttributePrelude" }, all("TypeNS"))).toEqual(det);

    expect<unknown>(scope_result(r, ident("mac"), "MacroNS", { $: "MacroUsePrelude" }, all("MacroNS"))).toEqual(det);
    const mac = def_decl(r, { $: "Macro", _0: 1 as never });
    r.macro_use_prelude.set(Symbol.intern("mac"), mac);
    expect<unknown>(scope_result(r, ident("mac"), "MacroNS", { $: "MacroUsePrelude" }, all("MacroNS"))).toEqual({ $: "Ok", _0: mac });

    // `no_core`: empty extern prelude, no std prelude.
    expect<unknown>(scope_result(r, ident("core"), "TypeNS", { $: "ExternPreludeItems" }, all("TypeNS"))).toEqual(det);
    expect<unknown>(scope_result(r, ident("core"), "TypeNS", { $: "ExternPreludeFlags" }, all("TypeNS"))).toEqual(det);
    expect<unknown>(scope_result(r, ident("Option"), "TypeNS", { $: "StdLibPrelude" }, all("TypeNS"))).toEqual(det);
  });
});

test("resolve_ident_in_scope: macro_rules and derive helper scopes", () => {
  with_resolver((r) => {
    const m = ident("m");
    const d = def_decl(r, { $: "Macro", _0: 1 as never });
    const box = (s: MacroRulesScope) => r.arenas.alloc_macro_rules_scope(s);
    const def = box({ $: "Def", _0: { decl: d, parent_macro_rules_scope: box({ $: "Empty" }), ident: IdentKey.new(m), orig_ident_span: DUMMY_SP } });
    const all_m: ScopeSet = { $: "All", _0: "MacroNS" };
    expect<unknown>(scope_result(r, m, "MacroNS", { $: "MacroRules", _0: def }, all_m)).toEqual({ $: "Ok", _0: d });
    expect<unknown>(scope_result(r, ident("n"), "MacroNS", { $: "MacroRules", _0: def }, all_m)).toEqual({ $: "Err", _0: { $: "Continue", _0: "Determined" } });
    expect<unknown>(scope_result(r, m, "MacroNS", { $: "MacroRules", _0: box({ $: "Invocation", _0: LocalExpnId.fresh_empty() }) }, all_m)).toEqual({
      $: "Err",
      _0: { $: "Continue", _0: "Undetermined" },
    });
    expect<unknown>(scope_result(r, m, "MacroNS", { $: "MacroRules", _0: box({ $: "Empty" }) }, all_m)).toEqual({ $: "Err", _0: { $: "Continue", _0: "Determined" } });

    // Derive helpers: the last helper with the name wins (`rfind`).
    const h = ident("helper");
    const h1 = attr_decl(r, { $: "NonMacroAttr", _0: { $: "DeriveHelper" } });
    const h2 = attr_decl(r, { $: "NonMacroAttr", _0: { $: "DeriveHelper" } });
    r.helper_attrs.set(LocalExpnId.ROOT, [
      [IdentKey.new(h), DUMMY_SP, h1],
      [IdentKey.new(ident("other")), DUMMY_SP, def_decl(r, DefKind.Struct)],
      [IdentKey.new(h), DUMMY_SP, h2],
    ]);
    expect<unknown>(scope_result(r, h, "MacroNS", { $: "DeriveHelpers", _0: LocalExpnId.ROOT }, all_m)).toEqual({ $: "Ok", _0: h2 });
    expect<unknown>(scope_result(r, ident("nope"), "MacroNS", { $: "DeriveHelpers", _0: LocalExpnId.ROOT }, all_m)).toEqual({
      $: "Err",
      _0: { $: "Continue", _0: "Determined" },
    });
    // No derives in the parent scope.
    expect<unknown>(scope_result(r, h, "MacroNS", { $: "DeriveHelpersCompat" }, all_m)).toEqual({ $: "Err", _0: { $: "Continue", _0: "Determined" } });
  });
});

// ---- resolve_ident_in_scope_set / resolve_ident_in_module -------------------------------------------

case_("resolve_ident_in_scope_set All(TypeNS) finds a planted item", () => {
  with_resolver((r) => {
    const foo = ident("foo");
    const d = def_decl(r, DefKind.Struct);
    plant(r, r.graph_root, foo, "TypeNS", d);
    expect<unknown>(r.resolve_ident_in_scope_set(foo, { $: "All", _0: "TypeNS" }, root_scope(r), undefined, undefined, undefined)).toEqual({ $: "Ok", _0: d });
  });
});

case_("resolve_ident_in_scope_set All(TypeNS) falls through to the builtin `u8`", () => {
  with_resolver((r) => {
    expect<unknown>(r.resolve_ident_in_scope_set(kwi(sym.u8), { $: "All", _0: "TypeNS" }, root_scope(r), undefined, undefined, undefined)).toEqual({
      $: "Ok",
      _0: r.builtin_type_decls.get(sym.u8),
    });
  });
});

case_("ModuleGlobs without finalize", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const foo = ident("foo");
    const g = def_decl(r, DefKind.Enum);
    plant(r, root, foo, "TypeNS", undefined, g);
    // A determined glob declaration with no single imports that could shadow it.
    expect<unknown>(scope_result(r, foo, "TypeNS", { $: "ModuleGlobs", _0: root, _1: undefined }, { $: "Module", _0: "TypeNS", _1: root })).toEqual({ $: "Ok", _0: g });
  });
});

test("resolve_ident_in_scope_set: path segment keywords are a determinate error", () => {
  with_resolver((r) => {
    for (const k of [kw.SelfLower, kw.Super, kw.Crate, kw.PathRoot, kw.DollarCrate, kw.SelfUpper]) {
      expect<unknown>(r.resolve_ident_in_scope_set(kwi(k), { $: "All", _0: "TypeNS" }, root_scope(r), undefined, undefined, undefined)).toEqual({
        $: "Err",
        _0: "Determined",
      });
    }
  });
});

test("resolve_ident_in_module: self, crate, path root, open modules and the extern prelude", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const ps = root_scope(r);
    const go = (m: ModuleOrUniformRoot, id: Ident, ns: Namespace) => r.resolve_ident_in_module(m, id, ns, ps, undefined, undefined, undefined);
    const det = { $: "Err", _0: "Determined" };

    expect<unknown>(go({ $: "Module", _0: root }, kwi(kw.SelfLower), "TypeNS")).toEqual({ $: "Ok", _0: root.self_decl });
    // `self` in another namespace is looked up as a name and is a keyword: determinate error.
    expect<unknown>(go({ $: "Module", _0: root }, kwi(kw.SelfLower), "ValueNS")).toEqual(det);
    expect<unknown>(go({ $: "CurrentScope" }, kwi(kw.Crate), "TypeNS")).toEqual({ $: "Ok", _0: root.self_decl });
    expect<unknown>(go({ $: "CurrentScope" }, kwi(kw.DollarCrate), "TypeNS")).toEqual({ $: "Ok", _0: root.self_decl });
    // `{{root}}` with a 2015-edition span in a 2015 crate is the crate root.
    expect<unknown>(r.path_root_is_crate_root(kwi(kw.PathRoot))).toBe(true);
    expect<unknown>(r.path_root_is_crate_root(kwi(kw.Crate))).toBe(false);
    expect<unknown>(go({ $: "CurrentScope" }, kwi(kw.PathRoot), "TypeNS")).toEqual({ $: "Ok", _0: root.self_decl });

    const foo = Symbol.intern("foo");
    const self_open = go({ $: "OpenModule", _0: foo }, kwi(kw.SelfLower), "TypeNS");
    expect<unknown>(self_open.$ === "Ok" && self_open._0.res()).toEqual({ $: "OpenMod", _0: foo });
    expect<unknown>(go({ $: "OpenModule", _0: foo }, ident("bar"), "TypeNS")).toEqual(det); // no `--extern foo::bar`
    expect<unknown>(go({ $: "OpenModule", _0: foo }, ident("bar"), "ValueNS")).toEqual(det);

    expect<unknown>(go({ $: "ExternPrelude" }, ident("core"), "TypeNS")).toEqual(det); // `no_core`
    expect<unknown>(go({ $: "ExternPrelude" }, ident("core"), "ValueNS")).toEqual(det);
    expect<unknown>(r.maybe_resolve_ident_in_module({ $: "ExternPrelude" }, ident("core"), "TypeNS", ps, undefined)).toEqual(det);
  });
});

case_("resolve_ident_in_module ExternPrelude finds an extern crate item", () => {
  with_resolver((r) => {
    const d = def_decl(r, DefKind.Mod);
    r.extern_prelude.set(IdentKey.with_root_ctxt(Symbol.intern("dep")), new ExternPreludeEntry([d, DUMMY_SP, true], undefined));
    expect<unknown>(r.resolve_ident_in_module({ $: "ExternPrelude" }, ident("dep"), "TypeNS", root_scope(r), undefined, undefined, undefined)).toEqual({ $: "Ok", _0: d });
  });
});

test("resolve_super_in_module on a block module stops at the crate root", () => {
  with_resolver((r) => {
    // `module.parent` of the crate root is `None`: no `super` without walking `resolve_self`.
    expect<unknown>(r.resolve_super_in_module(kwi(kw.Super), r.graph_root, root_scope(r))).toBeUndefined();
  });
});

// ---- resolve_path ---------------------------------------------------------------------------------------

test("resolve_path: crate root paths and empty paths", () => {
  with_resolver((r) => {
    const ps = root_scope(r);
    const seg = (i: Ident) => Segment.from_ident(i);
    expect<unknown>(r.resolve_path([seg(kwi(kw.Crate))], undefined, ps, undefined, undefined, undefined)).toEqual({ $: "Module", _0: { $: "Module", _0: r.graph_root } });
    expect<unknown>(r.resolve_path([seg(kwi(kw.PathRoot))], undefined, ps, undefined, undefined, undefined)).toEqual({ $: "Module", _0: { $: "Module", _0: r.graph_root } });
    expect<unknown>(r.maybe_resolve_path([], undefined, ps, undefined)).toEqual({ $: "Module", _0: { $: "CurrentScope" } });
    expect<unknown>(r.partial_res_map.size).toBe(0); // no finalize: nothing recorded
  });
});

test("resolve_path: path segment keywords in the wrong position", () => {
  with_resolver((r) => {
    const ps = root_scope(r);
    const seg = (i: Ident) => Segment.from_ident(i);
    const path = (...k: Ident[]) => k.map(seg);
    const fin = (p: Segment[]) => failed(r.resolve_path(p, undefined, ps, finalize(), undefined, undefined));

    const a = fin(path(kwi(kw.Crate), kwi(kw.Crate)));
    expect<unknown>([a.message, a.label, a.is_error_from_last_segment, a.segment.name]).toEqual([
      "`crate` in paths can only be used in start position",
      "can only be used in path start position",
      false,
      kw.Crate,
    ]);
    expect<unknown>(a.module).toEqual({ $: "Module", _0: r.graph_root });

    const b = fin(path(kwi(kw.PathRoot), kwi(kw.PathRoot)));
    expect<unknown>([b.message, b.label]).toEqual(["global paths cannot start with the crate root", "cannot start with this"]);

    const c = fin(path(kwi(kw.PathRoot), kwi(kw.Super)));
    expect<unknown>([c.message, c.label]).toEqual(["global paths cannot start with `super`", "cannot start with this"]);

    const d = fin(path(kwi(kw.Crate), kwi(kw.SelfLower), ident("x")));
    expect<unknown>([d.message, d.label]).toEqual([
      "`self` in paths can only be used in start position or last position",
      "can only be used in path start position or last position",
    ]);

    const e = fin(path(kwi(kw.Crate), kwi(kw.Super)));
    expect<unknown>([e.message, e.label]).toEqual(["`super` in paths can only be used in start position", "can only be used in path start position"]);

    // Without finalize the message is the generic placeholder (`PathResult::failed`).
    const f = failed(r.resolve_path(path(kwi(kw.Crate), kwi(kw.Crate)), undefined, ps, undefined, undefined, undefined));
    expect<unknown>([f.message, f.label]).toEqual(["cannot find `crate` in this scope", ""]);

    // A trailing `self` is allowed, then looked up in the macro namespace (a keyword: not found);
    // the crate root is a normal module, so this is a failure of the last segment.
    const g = failed(r.resolve_path(path(kwi(kw.PathRoot), kwi(kw.SelfLower)), "MacroNS", ps, undefined, undefined, undefined));
    expect<unknown>([g.message, g.is_error_from_last_segment]).toEqual(["cannot find `self` in this scope", true]);
  });
});

case_("resolve_path [crate] with finalize records the crate root res", () => {
  with_resolver((r) => {
    const s = Segment.from_ident(kwi(kw.Crate));
    s.id = NodeId.from_u32(5);
    expect<unknown>(r.resolve_path([s], undefined, root_scope(r), finalize(), undefined, undefined)).toEqual({ $: "Module", _0: { $: "Module", _0: r.graph_root } });
    const pr = r.partial_res_map.get(NodeId.from_u32(5));
    expect<unknown>(pr?.base_res()).toEqual({ $: "Def", _0: DefKind.Mod, _1: crate_def_id() });
  });
});

case_("resolve_path crate::m::mac through a child module", () => {
  with_resolver((r) => {
    // `mod m { macro mac }` planted by hand: the module (as `build_reduced_graph` creates it) and its names.
    const feed = r.create_def(CRATE_DEF_ID, NodeId.from_u32(11), Symbol.intern("m"), DefKind.Mod, ExpnId.root(), DUMMY_SP, false);
    r.feed_visibility(feed, { $: "Public" });
    const m_def_id = LocalDefId.to_def_id(feed.def_id());
    const m = r.new_local_module(r.graph_root, { $: "Def", _0: DefKind.Mod, _1: m_def_id, _2: NodeId.from_u32(11), _3: Symbol.intern("m") }, ExpnId.root(), DUMMY_SP, false);
    plant(r, r.graph_root, ident("m"), "TypeNS", r.arenas.new_pub_def_decl({ $: "Def", _0: DefKind.Mod, _1: m_def_id }, DUMMY_SP, LocalExpnId.ROOT));
    const mac_res: Res = { $: "Def", _0: { $: "Macro", _0: 1 as never }, _1: crate_def_id() };
    plant(r, m, ident("mac"), "MacroNS", r.arenas.new_pub_def_decl(mac_res, DUMMY_SP, LocalExpnId.ROOT));
    const path = [Segment.from_ident(kwi(kw.Crate)), Segment.from_ident(ident("m")), Segment.from_ident(ident("mac"))];

    const got = r.resolve_path(path, "MacroNS", root_scope(r), undefined, undefined, undefined);
    expect<unknown>(got.$).toBe("NonModule");
    if (got.$ === "NonModule") {
      expect<unknown>(got._0.base_res()).toEqual(mac_res);
      expect<unknown>(got._0.unresolved_segments()).toBe(0);
    }
    // As a module path (imports: `opt_ns = None`) the last segment is looked up in the type namespace.
    const as_mod = r.resolve_path(path.slice(0, 2), undefined, root_scope(r), undefined, undefined, undefined);
    expect<unknown>(as_mod).toEqual({ $: "Module", _0: { $: "Module", _0: m } });
    // A missing segment after a module, in a fully expanded module: a determinate failure of the last segment.
    const miss = failed(r.resolve_path([path[0]!, path[1]!, Segment.from_ident(ident("nope"))], "MacroNS", root_scope(r), undefined, undefined, undefined));
    expect<unknown>([miss.message, miss.is_error_from_last_segment, miss.module]).toEqual(["cannot find `nope` in this scope", true, { $: "Module", _0: m }]);
  });
});

case_("resolve_path [self] at the crate root", () => {
  with_resolver((r) => {
    expect<unknown>(r.resolve_path([Segment.from_ident(kwi(kw.SelfLower))], undefined, root_scope(r), undefined, undefined, undefined)).toEqual({
      $: "Module",
      _0: { $: "Module", _0: r.graph_root },
    });
  });
});

case_("resolve_path [super] at the crate root fails with too many supers", () => {
  with_resolver((r) => {
    const p = failed(r.resolve_path([Segment.from_ident(kwi(kw.Super))], undefined, root_scope(r), finalize(), undefined, undefined));
    expect<unknown>([p.message, p.label]).toEqual(["too many leading `super` keywords within `crate`", "this `super` would go above the crate root"]);
  });
});

// ---- resolve_ident_in_lexical_scope / validate_res_from_ribs ----------------------------------------

function rib(kind: RibKind, bindings: [Ident, Res][] = []): Rib {
  return new Rib(new KeyedMap(Ident_key, bindings), new Map(), kind);
}

case_("resolve_ident_in_lexical_scope finds a rib binding", () => {
  with_resolver((r) => {
    const x = ident("x");
    const local: Res = { $: "Local", _0: NodeId.from_u32(3) };
    const got = r.resolve_ident_in_lexical_scope(x, "ValueNS", root_scope(r), undefined, [rib({ $: "Module", _0: r.graph_root }), rib({ $: "Normal" }, [[x, local]])], undefined, undefined);
    expect<unknown>(got).toEqual({ $: "RibDef", _0: local });
  });
});

test("validate_res_from_ribs (no finalize: no diagnostics)", () => {
  with_resolver((r) => {
    const x = ident("x");
    const local: Res = { $: "Local", _0: NodeId.from_u32(3) };
    const ty_param: Res = { $: "Def", _0: DefKind.TyParam, _1: crate_def_id() };
    const v = (res: Res, ...kinds: RibKind[]) => r.validate_res_from_ribs(0, x, res, undefined, x, kinds.map((k) => rib(k)), undefined);

    // A local seen through normal/fn ribs is fine; through an item rib it is an error only when finalizing.
    expect<unknown>(v(local, { $: "Normal" }, { $: "FnOrCoroutine" }, { $: "Normal" })).toEqual(local);
    expect<unknown>(v(local, { $: "Normal" }, { $: "Item", _0: { $: "No" } as never, _1: DefKind.Fn })).toEqual(local);
    // Constants and inline-asm `sym`s cannot use locals at all.
    expect<unknown>(v(local, { $: "Normal" }, { $: "ConstantItem", _0: { $: "Yes" } as never, _1: undefined, _2: "No" as never })).toEqual({ $: "Err" });
    expect<unknown>(v(local, { $: "Normal" }, { $: "InlineAsmSym" })).toEqual({ $: "Err" });
    expect<unknown>(v(local, { $: "Normal" }, { $: "ConstParamTy" })).toEqual({ $: "Err" });

    // Generic parameters cannot cross an item boundary.
    expect<unknown>(v(ty_param, { $: "Normal" }, { $: "AssocItem" }, { $: "FnOrCoroutine" })).toEqual(ty_param);
    expect<unknown>(v(ty_param, { $: "Normal" }, { $: "Item", _0: { $: "No" } as never, _1: DefKind.Fn })).toEqual({ $: "Err" });
    // ... nor be used in a non-trivial constant, unless it is `Self` of an impl.
    const no_generics = { $: "ConstantItem" as const, _0: { $: "No" as const, _0: "NonTrivialConstArg" as const }, _1: undefined, _2: "No" as never };
    expect<unknown>(v(ty_param, { $: "Normal" }, no_generics)).toEqual({ $: "Err" });
    const self_alias: Res = { $: "SelfTyAlias", alias_to: crate_def_id(), is_trait_impl: false };
    expect<unknown>(v(self_alias, { $: "Normal" }, no_generics)).toEqual(self_alias);
    // In the type of a const param (no `generic_const_parameter_types` / `adt_const_params`).
    expect<unknown>(v(ty_param, { $: "Normal" }, { $: "ConstParamTy" })).toEqual({ $: "Err" });

    const const_param: Res = { $: "Def", _0: DefKind.ConstParam, _1: crate_def_id() };
    expect<unknown>(v(const_param, { $: "Normal" }, { $: "Block", _0: undefined })).toEqual(const_param);
    expect<unknown>(v(const_param, { $: "Normal" }, { $: "ConstParamTy" })).toEqual({ $: "Err" });
    expect<unknown>(v(const_param, { $: "Normal" }, { $: "Item", _0: { $: "No" } as never, _1: DefKind.Fn })).toEqual({ $: "Err" });

    // Anything else passes through.
    const s: Res = { $: "Def", _0: DefKind.Struct, _1: crate_def_id() };
    expect<unknown>(v(s, { $: "Normal" }, { $: "Item", _0: { $: "No" } as never, _1: DefKind.Fn })).toEqual(s);

    // A forward-declared generic parameter (always `Res::Err`, asserted).
    const ban: RibKind = { $: "ForwardGenericParamBan", _0: "Default" as never };
    expect<unknown>(v({ $: "Err" }, ban)).toEqual({ $: "Err" });
    // (The `DefId` prints in its raw form: `def_path_debug_str` is not installed outside the driver.)
    expect<unknown>(() => v(ty_param, ban)).toThrow(/^assertion `left == right` failed\n  left: Def\(TyParam, DefId.*\)\n right: Err$/);
  });
});

// ---- ambiguity bookkeeping -------------------------------------------------------------------------------

test("maybe_push_ambiguity: kinds, the extern-flag / glob hacks, and no-ambiguity cases", () => {
  with_resolver((r) => {
    const root = r.graph_root;
    const name = IdentKey.new(ident("a"));
    const ps = root_scope(r);
    const builtin = attr_decl(r, { $: "NonMacroAttr", _0: { $: "Builtin", _0: sym.inline } });
    const s1 = def_decl(r, DefKind.Struct);
    const s2 = def_decl(r, DefKind.Struct); // same `Res` as s1
    const e = def_decl(r, DefKind.Enum);
    const all_m: ScopeSet = { $: "All", _0: "MacroNS" };
    const push = (decl: Decl, scope: Scope, inner: [Decl, Scope][], scope_set: ScopeSet = all_m, ns: Namespace = "MacroNS") =>
      r.maybe_push_ambiguity(name, DUMMY_SP, ns, scope_set, ps, decl, scope, inner, undefined);

    // Same `Res` and no import: never ambiguous.
    expect<unknown>(push(s2, { $: "StdLibPrelude" }, [[s1, { $: "ModuleNonGlobs", _0: root, _1: undefined }]])).toBe(false);
    // Different `Res` but no rule applies (both from the root expansion, not globs).
    expect<unknown>(push(e, { $: "StdLibPrelude" }, [[s1, { $: "ModuleNonGlobs", _0: root, _1: undefined }]])).toBe(false);
    expect<unknown>(r.ambiguity_errors.length).toBe(0);

    // A built-in attribute against anything else.
    expect<unknown>(push(e, { $: "BuiltinAttrs" }, [[builtin, { $: "ModuleNonGlobs", _0: root, _1: undefined }]])).toBe(true);
    // A derive helper used before it was declared.
    const compat = attr_decl(r, { $: "NonMacroAttr", _0: { $: "DeriveHelperCompat" } });
    expect<unknown>(push(e, { $: "StdLibPrelude" }, [[compat, { $: "DeriveHelpersCompat" }]])).toBe(true);
    // An innermost result from a macro expansion against an outer one.
    const expanded = def_decl(r, DefKind.Struct, LocalExpnId.fresh_empty());
    expect<unknown>(push(e, { $: "StdLibPrelude" }, [[expanded, { $: "ModuleNonGlobs", _0: root, _1: undefined }]], { $: "All", _0: "TypeNS" }, "TypeNS")).toBe(true);
    // Module-relative: an expanded non-glob against a glob of the same module (macro namespace).
    expect<unknown>(
      push(e, { $: "ModuleGlobs", _0: root, _1: undefined }, [[expanded, { $: "ModuleNonGlobs", _0: root, _1: undefined }]], { $: "Module", _0: "MacroNS", _1: root }),
    ).toBe(true);
    expect<unknown>(r.ambiguity_errors.map((a) => [a.kind, a.b1 === a.b2, a.warning, a.ambig_vis])).toEqual([
      ["BuiltinAttr", false, undefined, undefined],
      ["DeriveHelper", false, undefined, undefined],
      ["MoreExpandedVsOuter", false, undefined, undefined],
      ["GlobVsExpanded", false, undefined, undefined],
    ]);
    expect<unknown>(r.ambiguity_errors[0]!.b1).toBe(builtin);
    expect<unknown>(r.ambiguity_errors[0]!.b2).toBe(e);
    expect<unknown>(r.ambiguity_errors[0]!.scope2).toEqual({ $: "BuiltinAttrs" });
    expect<unknown>(r.ambiguity_errors[0]!.ident.name).toBe(name.name);

    // issue 145575: an extern flag "overridden" by an extern item is not reported.
    const n = r.ambiguity_errors.length;
    expect<unknown>(r.issue_145575_hack_applied).toBe(false);
    expect<unknown>(push(e, { $: "ExternPreludeFlags" }, [[builtin, { $: "ModuleNonGlobs", _0: root, _1: undefined }], [s1, { $: "ExternPreludeItems" }]])).toBe(false);
    expect<unknown>(r.issue_145575_hack_applied).toBe(true);
    // issue 149681: a glob "overridden" by a non-glob of the same module is not reported.
    r.issue_145575_hack_applied = false;
    expect<unknown>(
      push(e, { $: "ModuleGlobs", _0: root, _1: undefined }, [[builtin, { $: "MacroUsePrelude" }], [s1, { $: "ModuleNonGlobs", _0: root, _1: undefined }]]),
    ).toBe(false);
    expect<unknown>(r.issue_145575_hack_applied).toBe(true);
    expect<unknown>(r.ambiguity_errors.length).toBe(n);
  });
});

test("maybe_push_glob_vs_glob_vis_ambiguity: nothing without an import summary", () => {
  with_resolver((r) => {
    r.maybe_push_glob_vs_glob_vis_ambiguity(IdentKey.new(ident("a")), DUMMY_SP, def_decl(r, DefKind.Struct), undefined);
    expect<unknown>(r.ambiguity_errors.length).toBe(0);
  });
});

// ---- finalize_module_binding / single_import_can_define_name ---------------------------------------

test("finalize_module_binding: missing, public and private bindings", () => {
  with_resolver((r) => {
    const ps = root_scope(r);
    const k = IdentKey.new(ident("foo"));
    expect<unknown>(r.finalize_module_binding(k, DUMMY_SP, undefined, ps, finalize(), "Restricted")).toEqual({ $: "Err", _0: { $: "Continue", _0: "Determined" } });
    const d = def_decl(r, DefKind.Struct);
    expect<unknown>(r.finalize_module_binding(k, DUMMY_SP, d, ps, finalize(), "Restricted")).toEqual({ $: "Ok", _0: d });
    expect<unknown>(r.privacy_errors.length).toBe(0);

    // Private to a module `m` that is not an ancestor of the crate root.
    const m = r.create_def(CRATE_DEF_ID, NodeId.from_u32(9), Symbol.intern("m"), DefKind.Mod, ExpnId.root(), DUMMY_SP, false).def_id();
    const vis: Visibility<ModId> = { $: "Restricted", _0: ModId.new_unchecked(LocalDefId.to_def_id(m)) };
    const p = r.arenas.new_def_decl({ $: "Def", _0: DefKind.Struct, _1: crate_def_id() }, vis, DUMMY_SP, LocalExpnId.ROOT, undefined);
    // `report_private`: the error is recorded and the binding is still returned.
    expect<unknown>(r.finalize_module_binding(k, DUMMY_SP, p, ps, finalize(), "Restricted")).toEqual({ $: "Ok", _0: p });
    expect<unknown>(r.privacy_errors.length).toBe(1);
    expect<unknown>(r.privacy_errors[0]!.decl).toBe(p);
    expect<unknown>(r.privacy_errors[0]!.single_nested).toBe(false);
    // Otherwise it blocks the search.
    const quiet = finalize();
    quiet.report_private = false;
    expect<unknown>(r.finalize_module_binding(k, DUMMY_SP, p, ps, quiet, "Restricted")).toEqual({ $: "Err", _0: { $: "Break", _0: "Determined" } });
    expect<unknown>(r.privacy_errors.length).toBe(1);
  });
});

test("single_import_can_define_name: no single imports", () => {
  with_resolver((r) => {
    const res = new NameResolution(new Set(), undefined, undefined, DUMMY_SP);
    expect<unknown>(r.single_import_can_define_name(res, undefined, "TypeNS", undefined, undefined, root_scope(r))).toBe(false);
  });
});

