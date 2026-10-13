// Tests for compiler/rustc_resolve/src/late/diagnostics.rs, lines 1-2266 (lane res-late-diag-a).
//
// 1. End-to-end oracle cases (diagnostics_oracle/<case>.rs, `#![no_core]` crates with the
//    resdump-nocore arguments and `--edition=2021`): "cannot find X in this scope" (E0412/E0425,
//    E0433) with typo suggestions, similarly named items and "consider importing" (cannot_find);
//    unresolved `Self`/`self` (E0411/E0424), `this`, `True`, `printf`, fields and methods of `Self`
//    (self_kw); pattern `let`, `@` in slice patterns, `self` arguments (helpers).
//    Fixtures: <case>.resdump.stderr (tools/probes/resdump, run from the repo root so the paths in the
//    output are repo-relative) and exit_codes.json, made by
//    `REGEN=1 bun test src/rustc_resolve/late/diagnostics.test.ts`; with the probe and the pinned
//    toolchain present they are re-checked on every run. The subject is src/rust_ts/resdump.ts.
//    PENDING: none (the resdump dump runs through since lane resdump-dump).
// 2. In-process checks on a real `Resolver` (built as resolver_new.test.ts's `with_tcx`) and a
//    hand-made `LateResolutionVisitor`:
//    - rendered: a diagnostic assembled the way `smart_resolve_report_errors` does it, emitted through
//      `AnnotateSnippetEmitter`, must equal the oracle's block byte for byte;
//    - structural: expectations follow the upstream code cited per case;
//    - PENDING: cases that reach another lane's `unported(..)` assert that exact text and keep their
//      full expectations (delete the entry when that lane lands).
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import "../lib.ts";
import { ast, type Attribute, type Crate, type Expr, type Item, type Pat } from "../../rustc_ast/lib.ts";
import { Untracked } from "../../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../../rustc_crate_store/cstore.ts";
import { Steal } from "../../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { type Diag, E0425 } from "../../rustc_errors/lib.ts";
import * as rustc_expand_config from "../../rustc_expand/config.ts";
import { pre_configure_attrs } from "../../rustc_expand/config.ts";
import { PerNS } from "../../rustc_hir/def.ts";
import { Definitions } from "../../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../../rustc_interface/passes.ts";
import { DepGraph } from "../../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../../rustc_middle/hooks.ts";
import { clone_ExternProviders, clone_Providers } from "../../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt } from "../../rustc_middle/ty/context.ts";
import { query_system } from "../../rustc_query_impl/lib.ts";
import { DefId, StableCrateId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { Ident, kw, Symbol } from "../../rustc_span/symbol.ts";
import { PIN } from "../../../scripts/lib/common.ts";
import { panic, Unported, unported } from "../../std/panic.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import type { ImportSuggestion } from "../diagnostics/impls.ts";
import { LateResolutionVisitor, Resolver } from "../decls.ts";
import { type DiagMetadata, PathSource, type Rib } from "../late.ts";
import { provide, ParentScope, type Res, Segment } from "../lib.ts";
import {
  AssocSuggestion,
  import_candidate_to_enum_paths,
  is_self_type,
  is_self_value,
  path_to_string_without_assoc_item_bindings,
  TypoCandidate,
} from "./diagnostics.ts";

const HERE = import.meta.dir;
const ROOT = join(HERE, "..", "..", "..");
const DIR = join(HERE, "diagnostics_oracle");
/** The repo-relative path the oracle fixtures print. */
const rel_fixture_path = (c: string): string => `src/rustc_resolve/late/diagnostics_oracle/${c}.rs`;
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";

// ---- 1. end-to-end oracle cases ---------------------------------------------------------------

const CASES = ["cannot_find", "self_kw", "helpers"] as const;
type Case = (typeof CASES)[number];

/** Cases whose subject run stops at unported code: the exact `unported` it stops at today. */
const PENDING: Partial<Record<Case, string>> = {};

const nocore_args = (sysroot: string, file: string): string[] => [
  "--target",
  "x86_64-unknown-linux-gnu",
  "--sysroot",
  sysroot,
  "--edition=2021",
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
  file,
];
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

interface Run {
  exit: number;
  stdout: string;
  stderr: string;
}
function run(cmd: string[]): Run {
  const r = Bun.spawnSync(cmd, { cwd: ROOT, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function oracle_tools(): { sysroot: string; probe: string } | undefined {
  const data = process.env.RUST_TS_DATA;
  const probe = data === undefined ? undefined : join(data, "target", "probes", "release", "resdump");
  if (probe === undefined || !existsSync(probe) || !rustc_at_pin()) return undefined;
  const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return { sysroot: oracleSysroot(), probe };
}

const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");
const exit_codes = (): Record<string, number> => JSON.parse(fixture("exit_codes.json"));

if (REGEN) {
  const tools = oracle_tools();
  if (tools === undefined) throw new Error("ERROR: REGEN needs the resdump probe and the pinned toolchain");
  const codes: Record<string, number> = {};
  for (const c of CASES) {
    const r = run([tools.probe, ...nocore_args(tools.sysroot, rel_fixture_path(c))]);
    writeFileSync(join(DIR, `${c}.resdump.stderr`), r.stderr);
    codes[c] = r.exit;
  }
  writeFileSync(join(DIR, "exit_codes.json"), JSON.stringify(codes, null, 2) + "\n");
}

test("diagnostics_oracle fixtures are the current oracle output", () => {
  const tools = oracle_tools();
  if (tools === undefined) {
    if (REQUIRE) throw new Error("ERROR: resdump probe or pinned toolchain missing (bun scripts/probes.ts build resdump)");
    return;
  }
  const codes = exit_codes();
  for (const c of CASES) {
    const r = run([tools.probe, ...nocore_args(tools.sysroot, rel_fixture_path(c))]);
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: codes[c]!, stderr: fixture(`${c}.resdump.stderr`) });
  }
}, 120_000);

test("the fixtures exercise what they are named for", () => {
  // Guards against a fixture silently losing its point when it is regenerated.
  const cf = fixture("cannot_find.resdump.stderr");
  expect(cf).toContain("error[E0425]: cannot find type `Widgt` in this scope");
  expect(cf).toContain("help: a struct with a similar name exists");
  expect(cf).toContain("help: consider importing this function");
  expect(cf).toContain("error[E0425]: cannot find value `Sqare` in module `shapes::deep`");
  expect(cf).toContain("error[E0433]: cannot find module or crate `shapez` in this scope");
  const sk = fixture("self_kw.resdump.stderr");
  expect(sk).toContain("error[E0411]: cannot find type `Self` in this scope");
  expect(sk).toContain("error[E0424]: cannot find value `self` in this scope");
  expect(sk).toContain("help: you might have meant to use `self` here instead");
  expect(sk).toContain("help: you might have meant to use the available field");
  expect(sk).toContain("help: you may want to use a bool value instead");
  expect(sk).toContain("help: you may have meant to use the `print` macro");
  const h = fixture("helpers.resdump.stderr");
  expect(h).toContain("help: you might have meant to use pattern matching");
  expect(h).toContain("use the at operator");
  expect(h).toContain("help: try calling `m` as a method");
});

for (const c of CASES) {
  test(`diagnostics_oracle/${c}.rs: resolver diagnostics match the oracle${PENDING[c] ? " (PENDING)" : ""}`, () => {
    const { oracleSysroot } = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    let sysroot: string;
    try {
      sysroot = oracleSysroot();
    } catch (e) {
      if (REQUIRE) throw e;
      return;
    }
    const r = run(["bun", join(ROOT, "src/rust_ts/resdump.ts"), ...nocore_args(sysroot, rel_fixture_path(c))]);
    const pending = PENDING[c];
    if (pending !== undefined) {
      // Still stops at exactly this unported code (exit 70); once it does not, take it off PENDING.
      const last = r.stderr.trimEnd().split("\n").at(-1);
      expect({ c, exit: r.exit, last }).toEqual({ c, exit: 70, last: `rust-ts: unported: ${pending}` });
      return;
    }
    expect({ c, exit: r.exit, stderr: r.stderr }).toEqual({ c, exit: exit_codes()[c]!, stderr: fixture(`${c}.resdump.stderr`) });
  }, 120_000);
}

// ---- 2. in-process checks ---------------------------------------------------------------------

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

/** The source file path as the session sees it (relative to the test's cwd, like the fixtures). */
const session_path = (c: string): string => relative(process.cwd(), join(DIR, `${c}.rs`));

/** resolver_new.test.ts's `with_tcx` on `diagnostics_oracle/<c>.rs` (edition 2021), then
 * `resolver_for_lowering_raw` up to `Resolver::new` (passes.rs:791). */
function with_resolver<R>(c: string, f: (r: Resolver, krate: Crate, tcx: TyCtxt) => R): R {
  const config = config_from_args(["--target", "x86_64-unknown-linux-gnu", "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", session_path(c)]);
  let out: R | undefined;
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const krate = parse(sess);
    const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
    const crate_name = Symbol.intern(c);
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
        const r_ = tcx.create_crate_num(stable_crate_id);
        if (r_.$ !== "Ok") return panic("create_crate_num");
        r_._0.crate_name(crate_name);
        const unit = tcx.feed_unit_query();
        unit.features_query(rustc_expand_config.features(tcx.sess, pre_configured_attrs, crate_name));
        unit.crate_for_resolver(Steal.new<[Crate, Attribute[]]>([krate, pre_configured_attrs], "(rustc_ast::ast::Crate, thin_vec::ThinVec<rustc_ast::ast::Attribute>)"));
        const arenas = Resolver.arenas();
        void tcx.registered_attr_tools(null);
        void tcx.registered_lint_tools(null);
        const [k, attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
        const r = Resolver.new(tcx, attrs, k.spans.inner_span, k.spans.inject_use_span, arenas);
        return f(r, k, tcx);
      },
    );
  });
  return out as R;
}

/** `DiagMetadata::default()` (late.rs:765 `#[derive(Default)]`). */
function diag_metadata(md: Partial<DiagMetadata> = {}): DiagMetadata {
  return {
    current_trait_assoc_items: undefined,
    current_self_type: undefined,
    current_self_item: undefined,
    current_item: undefined,
    currently_processing_generic_args: false,
    current_function: undefined,
    unused_labels: new Map(),
    current_let_binding: undefined,
    current_pat: undefined,
    in_if_condition: undefined,
    in_assignment: undefined,
    is_assign_rhs: false,
    in_non_gat_assoc_type: undefined,
    in_range: undefined,
    current_trait_object: undefined,
    current_where_predicate: undefined,
    in_assoc_ty_binding: false,
    current_type_path: undefined,
    current_impl_items: undefined,
    current_impl_item: undefined,
    currently_processing_impl_trait: undefined,
    current_elision_failures: [],
    ...md,
  };
}

/** A `LateResolutionVisitor` at the crate root (late.rs:1581 `new`), with the given `diag_metadata`. */
function visitor(r: Resolver, md: Partial<DiagMetadata> = {}): LateResolutionVisitor {
  const v = LateResolutionVisitor.new(r);
  v.diag_metadata = diag_metadata(md);
  return v;
}

const CASE_PENDING: Record<string, string> = {};

function case_(name: string, f: () => void): void {
  test(name + (CASE_PENDING[name] ? " (PENDING)" : ""), () => {
    const pending = CASE_PENDING[name];
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

// ---- AST helpers ----

function item(krate: Crate, name: string): Item {
  for (const i of krate.items) {
    const ident = ast.ItemKind.ident(i.kind);
    if (ident !== undefined && ident.as_str() === name) return i;
  }
  return panic(`no item ${name}`);
}
function impl_item(krate: Crate): Item {
  const i = krate.items.find((i) => i.kind.$ === "Impl");
  return i ?? panic("no impl");
}
function fn_of(i: Item): ast.Fn {
  if (i.kind.$ !== "Fn") return panic("not a fn");
  return i.kind._0;
}
function stmts(i: Item): ast.Stmt[] {
  const body = fn_of(i).body;
  return body === undefined ? panic("no body") : body.stmts;
}
/** The expression of the `n`th statement (`expr;` or `expr`). */
function stmt_expr(i: Item, n: number): Expr {
  const s = stmts(i)[n]!;
  if (s.kind.$ === "Semi" || s.kind.$ === "Expr") return s.kind._0;
  return panic("not an expression statement");
}
/** The pattern and initializer of the `n`th statement (`let pat = init;`). */
function let_of(i: Item, n: number): [Pat, Expr | undefined] {
  const s = stmts(i)[n]!;
  if (s.kind.$ !== "Let") return panic("not a let");
  const local = s.kind._0;
  return [local.pat, local.kind.$ === "Init" ? local.kind._0 : undefined];
}
function snippet(tcx: TyCtxt, sp: Span): string {
  const r = tcx.sess.source_map().span_to_snippet(sp);
  return r.$ === "Ok" ? r._0.toString() : panic("no snippet");
}
const seg = (s: string | Symbol, span: Span = DUMMY_SP): Segment => new Segment(Ident.new(typeof s === "string" ? Symbol.intern(s) : s, span), undefined, false, false, DUMMY_SP);
const def_id = (index: number): DefId => new DefId(0 as never, index as never);
const def_res = (kind: string, index = 1): Res => ({ $: "Def", _0: { $: kind } as never, _1: def_id(index) });

/** Renders `err` as the oracle's human emitter does (no color), then cancels it. */
function render(tcx: TyCtxt, err: Diag, c: string): string {
  const buf = new VecU8();
  let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
  em = AnnotateSnippetEmitter.sm(em, tcx.sess.source_map());
  em.emit_diagnostic(err.deref());
  err.cancel();
  return new TextDecoder().decode(buf.bytes()).replaceAll(session_path(c), rel_fixture_path(c)).trimEnd();
}
/** The oracle's diagnostic of `c` whose first line starts with `head`. */
function oracle_block(c: string, head: string): string {
  const blocks = fixture(`${c}.resdump.stderr`).split(/\n\n(?=error|warning)/);
  const b = blocks.find((b) => b.startsWith(head));
  return b === undefined ? panic(`no oracle block ${head}`) : b.trimEnd();
}

// ---- free fns and companions ----

case_("is_self_type / is_self_value (late/diagnostics.rs:75, 79)", () => {
  with_resolver("units", () => {
    expect(is_self_type([seg(kw.SelfUpper)], "TypeNS")).toBe(true);
    expect(is_self_type([seg(kw.SelfUpper)], "ValueNS")).toBe(false);
    expect(is_self_type([seg(kw.SelfLower)], "TypeNS")).toBe(false);
    expect(is_self_type([seg(kw.SelfUpper), seg("x")], "TypeNS")).toBe(false);
    expect(is_self_value([seg(kw.SelfLower)], "ValueNS")).toBe(true);
    expect(is_self_value([seg(kw.SelfLower)], "TypeNS")).toBe(false);
    expect(is_self_value([seg(kw.SelfUpper)], "ValueNS")).toBe(false);
    expect(is_self_value([], "ValueNS")).toBe(false);
  });
});

case_("path_to_string_without_assoc_item_bindings (late/diagnostics.rs:83)", () => {
  with_resolver("units", (_r, krate) => {
    const generics = fn_of(item(krate, "bounds")).generics;
    const trait_paths = generics.params.map((p) => {
      const b = p.bounds[0]!;
      return b.$ === "Trait" ? b._0.trait_ref.path : panic("not a trait bound");
    });
    // `Tr<u8, Item = u8>` keeps the type arg; `Tr<Item = u8>` loses its now-empty args; `::Tr<u8>`
    // keeps the global prefix.
    expect(trait_paths.map((p) => path_to_string_without_assoc_item_bindings(p))).toEqual(["Tr<u8>", "Tr", "::Tr<u8>"]);
    // The input path is untouched (upstream works on a clone).
    const first = trait_paths[0]!.segments[0]!.args;
    expect(first?.$ === "AngleBracketed" ? first._0.args.length : -1).toBe(2);
  });
});

case_("import_candidate_to_enum_paths (late/diagnostics.rs:101)", () => {
  with_resolver("units", () => {
    const path = new ast.Path(DUMMY_SP, ["a", "E", "V"].map((s) => ast.PathSegment.from_ident(Ident.with_dummy_span(Symbol.intern(s)))));
    const sugg: ImportSuggestion = { did: undefined, descr: "variant", path, accessible: true, doc_visible: true, via_import: false, note: undefined, is_stable: true };
    expect(import_candidate_to_enum_paths(sugg)).toEqual(["a::E::V", "a::E"]);
    expect(path.segments.length).toBe(3);
  });
});

case_("AssocSuggestion::action / TypoCandidate::to_opt_suggestion (late/diagnostics.rs:58, 179)", () => {
  expect(
    [
      AssocSuggestion.Field,
      { $: "MethodWithSelf", called: true } as const,
      { $: "MethodWithSelf", called: false } as const,
      { $: "AssocFn", called: true } as const,
      { $: "AssocFn", called: false } as const,
      AssocSuggestion.AssocConst,
      AssocSuggestion.AssocType,
    ].map((a) => AssocSuggestion.action(a)),
  ).toEqual([
    "use the available field",
    "call the method with the fully-qualified path",
    "refer to the method with the fully-qualified path",
    "call the associated function",
    "refer to the associated function",
    "use the associated `const`",
    "use the associated type",
  ]);
  const typo = { candidate: 0 } as never;
  expect(TypoCandidate.to_opt_suggestion({ $: "Typo", _0: typo })).toBe(typo);
  expect(TypoCandidate.to_opt_suggestion({ $: "Shadowed", _0: { $: "Err" }, _1: undefined })).toBeUndefined();
  expect(TypoCandidate.to_opt_suggestion(TypoCandidate.None)).toBeUndefined();
});

// ---- LateResolutionVisitor helpers ----

case_("could_be_expr (late/diagnostics.rs:596)", () => {
  with_resolver("units", (r, krate) => {
    const v = visitor(r);
    const fptr = item(krate, "fptr");
    const call = stmt_expr(fptr, 0); // `a()`
    const path = stmt_expr(fptr, 1); // `b`
    // A fn is an expression only when the snippet ends with `)`.
    expect(v.could_be_expr(def_res("Fn"), call.span)).toBe(true);
    expect(v.could_be_expr(def_res("Fn"), path.span)).toBe(false);
    expect(v.could_be_expr({ $: "Def", _0: { $: "Ctor", _0: "Struct", _1: "Fn" }, _1: def_id(1) }, path.span)).toBe(true);
    for (const k of ["AssocFn", "Const", "AssocConst"]) expect(v.could_be_expr(def_res(k), path.span)).toBe(true);
    expect(v.could_be_expr({ $: "SelfCtor", _0: def_id(1) }, path.span)).toBe(true);
    expect(v.could_be_expr({ $: "PrimTy", _0: { $: "Bool" } }, path.span)).toBe(true);
    expect(v.could_be_expr({ $: "Local", _0: 0 as never }, path.span)).toBe(true);
    for (const k of ["Struct", "Enum", "Mod", "TyParam"]) expect(v.could_be_expr(def_res(k), path.span)).toBe(false);
    expect(v.could_be_expr({ $: "Err" }, path.span)).toBe(false);
  });
});

case_("call_has_self_arg (late/diagnostics.rs:2157)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const v = visitor(r);
    const calls = item(krate, "calls");
    const got = [0, 1, 2, 3, 4].map((n) => {
      const res = v.call_has_self_arg({ $: "Expr", _0: stmt_expr(calls, n) });
      return res === undefined ? undefined : [snippet(tcx, res[0]), res[1] === undefined ? undefined : snippet(tcx, res[1])];
    });
    expect(got).toEqual([
      ["f(&self, 1, 2)", "1, 2"], // the tail args after `self`
      ["f(&&self)", undefined], // `&` is peeled any number of times
      ["f(self)", undefined],
      undefined, // `self` must be the first argument
      undefined, // no arguments
    ]);
    // Not a call / no parent expression.
    expect(v.call_has_self_arg({ $: "Expr", _0: undefined })).toBeUndefined();
    expect(v.call_has_self_arg(PathSource.Type)).toBeUndefined();
  });
});

case_("followed_by_brace (late/diagnostics.rs:2191)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const v = visitor(r);
    const lits = item(krate, "lits");
    const [, init] = let_of(lits, 0); // `S { 0: { 1 } }`
    if (init === undefined || init.kind.$ !== "Struct") return panic("not a struct expr");
    const [followed, closing] = v.followed_by_brace(init.kind._0.path.span);
    // The matching `}` accounts for the nested block.
    expect([followed, closing === undefined ? undefined : snippet(tcx, closing)]).toEqual([true, "S { 0: { 1 } }"]);
    const [, sum] = let_of(lits, 1); // `v + 1`
    if (sum === undefined || sum.kind.$ !== "Binary") return panic("not a binary expr");
    expect(v.followed_by_brace(sum.kind._1.span)).toEqual([false, undefined]);
  });
});

case_("update_err_for_private_tuple_struct_fields, tuple struct pattern (late/diagnostics.rs:2223)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const v = visitor(r);
    const lits = item(krate, "lits");
    const sp1 = stmt_expr(item(krate, "fptr"), 0).span;
    const err = tcx.dcx().struct_span_err(sp1, "base");
    const spans = v.update_err_for_private_tuple_struct_fields(err, { $: "TupleStruct", _0: sp1, _1: [sp1, lits.span] }, def_id(1));
    expect(spans).toEqual([sp1, lits.span]);
    expect(err.deref().messages[0]![0]).toEqual({ $: "Str", _0: "cannot match against a tuple struct which contains private fields" });
    // Other sources leave the error alone.
    expect(v.update_err_for_private_tuple_struct_fields(err, PathSource.Pat, def_id(1))).toBeUndefined();
    err.cancel();
  });
});

case_("explain_functions_in_pattern (late/diagnostics.rs:1928)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const v = visitor(r);
    const sp = item(krate, "fptr").span;
    const ts: PathSource = { $: "TupleStruct", _0: sp, _1: [] };
    const err = tcx.dcx().struct_span_err(sp, "base");
    v.explain_functions_in_pattern(err, def_res("Struct"), ts);
    v.explain_functions_in_pattern(err, def_res("Fn"), PathSource.Pat);
    v.explain_functions_in_pattern(err, undefined, ts);
    expect([err.deref().messages.length, err.deref().children.length]).toEqual([1, 0]);
    v.explain_functions_in_pattern(err, def_res("Fn"), ts);
    expect(err.deref().messages[0]![0]).toEqual({ $: "Str", _0: "expected a pattern, found a function call" });
    expect(err.deref().children.map((c) => [c.level, c.messages[0]![0]])).toEqual([
      ["Note", { $: "Str", _0: "function calls are not allowed in patterns: <https://doc.rust-lang.org/book/ch19-00-patterns.html>" }],
    ]);
    err.cancel();
  });
});

case_("suggest_at_operator_in_slice_pat_with_range (late/diagnostics.rs:1770)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const pats = item(krate, "pats");
    const elem = (n: number, k: number): Pat => {
      const [p] = let_of(pats, n);
      return p.kind.$ === "Slice" ? p.kind._0[k]! : panic("not a slice pattern");
    };
    const got = ([[0, "rest"], [1, "tail"]] as const).map(([n, name]) => {
      const pat = elem(n, 1); // `rest..` / `..tail`
      const v = visitor(r, { current_pat: pat });
      const err = tcx.dcx().struct_span_err(pat.span, "base");
      v.suggest_at_operator_in_slice_pat_with_range(err, [seg(name)]);
      // A different name, or a path of two segments, adds nothing.
      v.suggest_at_operator_in_slice_pat_with_range(err, [seg("other")]);
      v.suggest_at_operator_in_slice_pat_with_range(err, [seg(name), seg(name)]);
      const s = err.deref().suggestions;
      const out = s.$ === "Enabled" ? s._0.map((c) => [c.msg, c.substitutions.map((sub) => sub.parts.map((p) => [snippet(tcx, p.span), p.snippet]))]) : [];
      err.cancel();
      return out;
    });
    // `rest..`: insert ` @ ` between the ident and `..`; `..tail`: replace the whole range.
    expect(got).toEqual([
      [[{ $: "Str", _0: "if you meant to collect the rest of the slice in `rest`, use the at operator" }, [[["", " @ "]]]]],
      [[{ $: "Str", _0: "if you meant to collect the rest of the slice in `tail`, use the at operator" }, [[["..tail", "tail @ .."]]]]],
    ]);
  });
});

case_("suggest_range_struct_destructuring: `rest..` in a slice pattern", () => {
  with_resolver("units", (r, krate, tcx) => {
    const [p] = let_of(item(krate, "pats"), 0);
    const pat = p.kind.$ === "Slice" ? p.kind._0[1]! : panic("not a slice pattern");
    const start = pat.kind.$ === "Range" ? pat.kind._0 : undefined;
    if (start === undefined) return panic("not `rest..`");
    const v = visitor(r, { current_pat: pat });
    const err = tcx.dcx().struct_span_err(pat.span, "base");
    v.suggest_range_struct_destructuring(err, [seg("rest", start.span)], PathSource.Pat);
    // Upstream (helpers.resdump.stderr): `std::ops::RangeFrom { start: rest }` under `no_core`.
    const s = err.deref().suggestions;
    expect(s.$ === "Enabled" ? s._0.map((c) => c.substitutions[0]!.parts[0]!.snippet) : []).toEqual(["std::ops::RangeFrom { start: rest }"]);
    err.cancel();
  });
});

case_("suggest_changing_type_to_const_param, type param used as a value (late/diagnostics.rs:1940)", () => {
  with_resolver("units", (r, krate, tcx) => {
    const gen_item = item(krate, "gen");
    const v = visitor(r, { current_item: gen_item });
    const err = tcx.dcx().struct_span_err(gen_item.span, "base");
    // Only `PathSource::Expr(None)` with a `TyParam` res and a single segment.
    v.suggest_changing_type_to_const_param(err, def_res("TyParam"), PathSource.Pat, [seg("N")], undefined, gen_item.span);
    v.suggest_changing_type_to_const_param(err, def_res("Struct"), { $: "Expr", _0: undefined }, [seg("N")], undefined, gen_item.span);
    v.suggest_changing_type_to_const_param(err, def_res("TyParam"), { $: "Expr", _0: undefined }, [seg("M")], undefined, gen_item.span);
    const before = err.deref().suggestions;
    expect(before.$ === "Enabled" ? before._0.length : -1).toBe(0);
    v.suggest_changing_type_to_const_param(err, def_res("TyParam"), { $: "Expr", _0: undefined }, [seg("N")], undefined, gen_item.span);
    const s = err.deref().suggestions;
    // Two insertion points around the generic param `N` (`const ` before, `: /* Type */` after).
    const parts = s.$ === "Enabled" ? s._0.flatMap((c) => c.substitutions[0]!.parts.map((p) => [snippet(tcx, p.span), Span.lo(p.span) - Span.lo(gen_item.span)])) : [];
    const n_at = snippet(tcx, gen_item.span).indexOf("N>");
    expect(parts).toEqual([
      ["", n_at],
      ["", n_at + 1],
    ]);
    err.cancel();
  });
});

case_("suggest_pattern_match_with_let + fallback label render as the oracle's E0425 (rendered)", () => {
  with_resolver("helpers", (r, krate, tcx) => {
    // `if x = v {}` in `pattern_let`: `x` has `PathSource::Expr(Some(<the assignment>))`.
    const if_expr = stmt_expr(item(krate, "pattern_let"), 0);
    if (if_expr.kind.$ !== "If") return panic("not an if");
    const cond = if_expr.kind._0;
    if (cond.kind.$ !== "Assign") return panic("not an assignment");
    const x = cond.kind._0;
    const v = visitor(r, { in_if_condition: cond });
    // The base error as `smart_resolve_report_errors` makes it for this path (msg, E0425 from
    // `PathSource::error_code`), then the helper and the fallback label.
    const err = tcx.dcx().struct_span_err(x.span, "cannot find value `x` in this scope");
    err.code(E0425);
    expect(v.suggest_pattern_match_with_let(err, { $: "Expr", _0: cond }, x.span)).toBe(true);
    err.span_label(x.span, "not found in this scope");
    expect(render(tcx, err, "helpers")).toBe(oracle_block("helpers", "error[E0425]: cannot find value `x` in this scope"));
    // Not an expression path, or not inside an `if` condition: nothing.
    const err2 = tcx.dcx().struct_span_err(x.span, "base");
    expect(v.suggest_pattern_match_with_let(err2, PathSource.Pat, x.span)).toBe(false);
    expect(visitor(r).suggest_pattern_match_with_let(err2, { $: "Expr", _0: cond }, x.span)).toBe(false);
    err2.cancel();
  });
});

case_("smart_resolve_report_errors: pattern `let` in an `if` (rendered)", () => {
  with_resolver("helpers", (r, krate, tcx) => {
    const pattern_let = item(krate, "pattern_let");
    const if_expr = stmt_expr(pattern_let, 0);
    if (if_expr.kind.$ !== "If" || if_expr.kind._0.kind.$ !== "Assign") return panic("not `if x = v`");
    const cond = if_expr.kind._0;
    const x = (cond.kind as { _0: Expr })._0;
    const v = visitor(r, { in_if_condition: cond, current_item: pattern_let });
    const [err, candidates] = v.smart_resolve_report_errors([seg("x", x.span)], undefined, x.span, { $: "Expr", _0: cond }, undefined, undefined);
    expect(candidates).toEqual([]);
    expect(render(tcx, err, "helpers")).toBe(oracle_block("helpers", "error[E0425]: cannot find value `x` in this scope"));
  });
});

case_("smart_resolve_report_errors: E0411 for `Self` in a free fn (rendered)", () => {
  with_resolver("self_kw", (r, krate, tcx) => {
    const free = item(krate, "free");
    const ret = fn_of(free).sig.decl.output;
    if (ret.$ !== "Ty") return panic("no return type");
    const self_ty = ret._0;
    const v = visitor(r, { current_item: free, current_function: [{ $: "Fn", _0: { $: "Free" }, _1: free.vis, _2: fn_of(free) }, free.span] });
    const [err] = v.smart_resolve_report_errors([seg(kw.SelfUpper, self_ty.span)], undefined, self_ty.span, PathSource.Type, undefined, undefined);
    expect(render(tcx, err, "self_kw")).toBe(oracle_block("self_kw", "error[E0411]: cannot find type `Self` in this scope"));
  });
});
