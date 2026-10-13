// Tests for lane res-late-a: compiler/rustc_resolve/src/late.rs lines 1-2890 (the companions, the
// `impl Visitor for LateResolutionVisitor`, and the inherent impl up to `future_proof_import`).
//
// 1. End-to-end oracle cases (late_a_oracle/<case>.rs, `#![no_core]` crates with the resdump-nocore
//    arguments, edition 2021): lifetime resolution and elision, labels, generic-parameter ribs and the
//    lifetime errors of this half. Fixtures per case: <case>.resdump.stdout / .resdump.stderr (the
//    tools/probes/resdump output: partial_res_map, owners (lifetime_res / label_res / extra_lifetime_params
//    / import_res), lint_buffer, ...) and exit_codes.json; made by `REGEN=1 bun test
//    src/rustc_resolve/late_a.test.ts` (needs the probe and the pinned toolchain; with them present the
//    fixtures are re-checked on every run). The subject is src/rust_ts/resdump.ts on the same arguments.
//    PENDING: every case until the pipeline reaches late resolution (see PENDING below); a pending case
//    must still stop at unported code (exit 70), so it has to leave PENDING once it runs through.
// 2. Unit checks: the companions (pure), and the visitor methods of this half driven on a real
//    `Resolver` (built as resolver_new.test.ts / ident.test.ts build it: an empty `#![no_core]` crate,
//    `Resolver::new`). Expectations follow the upstream code cited per case; the lifetime numbering
//    mirrors what the probe prints for the same shapes (e.g. lifetimes.rs `fn elided`: anchor
//    `ElidedAnchor { start: n, end: n+1 }`, then `Fresh { param: n+1, kind: Ampersand }` for `n` and `n+1`).
//    Cases that reach another lane's stub are in UNIT_PENDING with the exact `unported` text.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import { type Attribute, type Crate, Expr, type GenericParam, GenericParam as GenericParamC, type Lifetime, Ty } from "../rustc_ast/lib.ts";
import { NodeId } from "../rustc_ast/node_id.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import * as rustc_expand_config from "../rustc_expand/config.ts";
import { pre_configure_attrs } from "../rustc_expand/config.ts";
import { display_ErrCode } from "../rustc_errors/lib.ts";
import { DefKind, type Res as HirRes } from "../rustc_hir/def.ts";
import { Definitions } from "../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../rustc_interface/passes.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../rustc_middle/hooks.ts";
import { type LifetimeRes, PartialRes } from "../rustc_middle/middle/resolve.ts";
import { clone_ExternProviders, clone_Providers } from "../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt } from "../rustc_middle/ty/context.ts";
import { query_system } from "../rustc_query_impl/lib.ts";
import { CRATE_DEF_ID, DefId, LocalDefId, StableCrateId } from "../rustc_span/def_id.ts";
import { BytePos, DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { Ident, kw, Symbol } from "../rustc_span/symbol.ts";
import { panic, Unported, unported } from "../std/panic.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { PIN } from "../../scripts/lib/common.ts";
import {
  ConstantHasGenerics,
  ConstantItemKind,
  LateResolutionVisitor,
  LifetimeBinderKind,
  LifetimeRib,
  LifetimeRibKind,
  MaybeExported,
  PathSource,
  PatternSource,
  PatternSource_into_diag_arg,
  Rib,
  RibKind,
} from "./late.ts";
import { type Res, Resolver, Segment, provide } from "./lib.ts";

// ---- 1. end-to-end oracle cases ---------------------------------------------------------------

const HERE = import.meta.dir;
const DIR = join(HERE, "late_a_oracle");
const ROOT = join(HERE, "..", "..");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";

const CASES = ["lifetimes", "labels", "generics"] as const;
type Case = (typeof CASES)[number];

/** Cases whose subject run stops at unported code; the reason is the first missing piece. */
const PENDING: Partial<Record<Case, string>> = {
  lifetimes:
    "driver stops before resolution (rustc_lint::late::unerased_lint_store, lane lint-early-a); then late.rs:2891.. (res-late-b: resolve_item, late_resolve_crate, ...), late/diagnostics.rs, diagnostics/impls.rs (dcx), CStore (wave 11)",
  labels: "as lifetimes",
  generics: "as lifetimes",
};

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
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
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
  const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  return { sysroot: oracleSysroot(), probe };
}

const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");
const exit_codes = (): Record<string, number> => JSON.parse(fixture("exit_codes.json"));

if (REGEN) {
  const tools = oracle_tools();
  if (tools === undefined) throw new Error("ERROR: REGEN needs the resdump probe and the pinned toolchain");
  const codes: Record<string, number> = {};
  for (const c of CASES) {
    const r = run([tools.probe, ...nocore_args(tools.sysroot, `${c}.rs`)]);
    writeFileSync(join(DIR, `${c}.resdump.stdout`), r.stdout);
    writeFileSync(join(DIR, `${c}.resdump.stderr`), r.stderr);
    codes[c] = r.exit;
  }
  writeFileSync(join(DIR, "exit_codes.json"), JSON.stringify(codes, null, 2) + "\n");
}

test("late_a_oracle fixtures are the current oracle output", () => {
  const tools = oracle_tools();
  if (tools === undefined) {
    if (REQUIRE) throw new Error("ERROR: resdump probe or pinned toolchain missing (bun scripts/probes.ts build resdump)");
    return;
  }
  const codes = exit_codes();
  for (const c of CASES) {
    const r = run([tools.probe, ...nocore_args(tools.sysroot, `${c}.rs`)]);
    expect({ c, exit: r.exit, stdout: r.stdout, stderr: r.stderr }).toEqual({
      c,
      exit: codes[c]!,
      stdout: fixture(`${c}.resdump.stdout`),
      stderr: fixture(`${c}.resdump.stderr`),
    });
  }
}, 120_000);

test("the late_a fixtures exercise what they are named for", () => {
  // Guards against a fixture silently losing its point when it is regenerated.
  const lt = fixture("lifetimes.resdump.stdout");
  expect(lt).toContain("Fresh { param: NodeId(173), kind: Ampersand }");
  expect(lt).toContain("kind: Underscore");
  expect(lt).toContain("kind: Brackets");
  expect(lt).toContain("lifetime_res NodeId(47) Static");
  expect(lt).toContain("ELIDED_LIFETIMES_IN_PATHS");
  expect(lt).toContain("lifetime_elision_allowed=true");
  expect(fixture("labels.resdump.stdout")).toContain("label_res");
  expect(fixture("labels.resdump.stderr")).toContain("error[E0767]: use of unreachable label `'a`");
  expect(fixture("labels.resdump.stderr")).toContain("error[E0426]: use of undeclared label `'nope`");
  const g = fixture("generics.resdump.stderr");
  expect(g).toContain("error[E0128]");
  expect(g).toContain("error[E0735]");
  expect(g).toContain("error[E0637]: `'_` cannot be used here");
  expect(g).toContain("error[E0261]: use of undeclared lifetime name `'b`");
  expect(g).toContain("error[E0106]: missing lifetime specifier");
});

for (const c of CASES) {
  test(`late_a_oracle/${c}.rs: resdump matches the oracle${PENDING[c] ? " (PENDING)" : ""}`, () => {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    let sysroot: string;
    try {
      sysroot = oracleSysroot();
    } catch (e) {
      if (REQUIRE) throw e;
      return;
    }
    const r = run(["bun", join(ROOT, "src/rust_ts/resdump.ts"), ...nocore_args(sysroot, `${c}.rs`)]);
    if (PENDING[c] !== undefined) {
      // Still stops at unported code (UNPORTED, exit 70); once it does not, take it off PENDING.
      expect({ c, exit: r.exit }).toEqual({ c, exit: 70 });
      return;
    }
    expect({ c, exit: r.exit, stdout: r.stdout, stderr: r.stderr }).toEqual({
      c,
      exit: exit_codes()[c]!,
      stdout: fixture(`${c}.resdump.stdout`),
      stderr: fixture(`${c}.resdump.stderr`),
    });
  }, 120_000);
}

// ---- 2. unit checks: the companions -----------------------------------------------------------------

const did = (index: number): DefId => new DefId(index as never, 0 as never);
const def = (kind: DefKind, index = 1): Res => ({ $: "Def", _0: kind, _1: did(index) });
const nid = (n: number): NodeId => NodeId.from_u32(n);

test("PatternSource::descr / into_diag_arg, ConstantItemKind::as_str, LifetimeBinderKind::descr (late.rs:90, 101, 185, 410)", () => {
  expect([PatternSource.descr("Match"), PatternSource.descr("Let"), PatternSource.descr("For"), PatternSource.descr("FnParam")]).toEqual([
    "match binding",
    "let binding",
    "for binding",
    "function parameter",
  ]);
  expect(PatternSource_into_diag_arg("FnParam", { value: undefined })).toEqual({ $: "Str", _0: "function parameter" });
  expect([ConstantItemKind.as_str("Const"), ConstantItemKind.as_str("Static")]).toEqual(["const", "static"]);
  const kinds = ["FnPtrType", "PolyTrait", "WhereBound", "Item", "ConstItem", "Function", "Closure", "ImplBlock", "ImplAssocType"] as const;
  expect(kinds.map((k) => LifetimeBinderKind.descr(k))).toEqual(["type", "bound", "bound", "item", "item", "function", "closure", "impl block", "associated type"]);
});

test("ConstantHasGenerics::force_yes_if, LifetimeRibKind::elided (late.rs:152, 388)", () => {
  const no: ConstantHasGenerics = { $: "No", _0: "NonTrivialConstArg" };
  expect(ConstantHasGenerics.force_yes_if(no, true)).toBe(ConstantHasGenerics.Yes);
  expect(ConstantHasGenerics.force_yes_if(no, false)).toBe(no);
  expect(LifetimeRibKind.elided({ $: "Infer" })).toEqual({ $: "Elided", res: { $: "Infer" }, error_in_path: false });
});

test("RibKind::contains_params / is_label_barrier (late.rs:262, 279)", () => {
  const all: RibKind[] = [
    RibKind.Normal,
    { $: "Block", _0: undefined },
    RibKind.AssocItem,
    RibKind.FnOrCoroutine,
    { $: "Item", _0: { $: "No" }, _1: DefKind.Fn },
    { $: "ConstantItem", _0: ConstantHasGenerics.Yes, _1: undefined, _2: "No" },
    { $: "MacroDefinition", _0: did(3) },
    { $: "ForwardGenericParamBan", _0: "Default" },
    RibKind.ConstParamTy,
    RibKind.InlineAsmSym,
  ];
  expect(all.map((k) => `${k.$}:${RibKind.contains_params(k)}`)).toEqual([
    "Normal:false",
    "Block:false",
    "AssocItem:true",
    "FnOrCoroutine:false",
    "Item:true",
    "ConstantItem:false",
    "MacroDefinition:false",
    "ForwardGenericParamBan:true",
    "ConstParamTy:true",
    "InlineAsmSym:false",
  ]);
  expect(RibKind.is_label_barrier(RibKind.Normal)).toBe(false);
  expect(RibKind.is_label_barrier({ $: "MacroDefinition", _0: did(3) })).toBe(false);
  expect(RibKind.is_label_barrier(RibKind.FnOrCoroutine)).toBe(true);
  expect(RibKind.is_label_barrier(all[5]!)).toBe(true);
  // `kind => bug!("unexpected rib kind: {kind:?}")`
  expect(() => RibKind.is_label_barrier(RibKind.AssocItem)).toThrow("unexpected rib kind: AssocItem");
});

test("PathSource::namespace / defer_to_typeck / is_call / error_code (late.rs:482, 502, 567, 694)", () => {
  const srcs: PathSource[] = [
    PathSource.Type,
    PathSource.TypeParam,
    { $: "Trait", _0: "No" },
    { $: "Expr", _0: undefined },
    PathSource.Pat,
    { $: "Struct", _0: undefined },
    { $: "TupleStruct", _0: DUMMY_SP, _1: [] },
    { $: "TraitItem", _0: "ValueNS", _1: PathSource.Type },
    PathSource.Delegation,
    PathSource.ExternItemImpl,
    { $: "PreciseCapturingArg", _0: "TypeNS" },
    PathSource.ReturnTypeNotation,
    PathSource.DefineOpaques,
    PathSource.Macro,
    PathSource.Module,
  ];
  expect(srcs.map((s) => PathSource.namespace(s))).toEqual([
    "TypeNS",
    "TypeNS",
    "TypeNS",
    "ValueNS",
    "ValueNS",
    "TypeNS",
    "ValueNS",
    "ValueNS",
    "ValueNS",
    "ValueNS",
    "TypeNS",
    "ValueNS",
    "TypeNS",
    "MacroNS",
    "TypeNS",
  ]);
  expect(srcs.map((s) => PathSource.defer_to_typeck(s))).toEqual([true, true, false, true, true, true, true, false, true, false, false, true, false, false, false]);
  const codes = (b: boolean) => srcs.map((s) => display_ErrCode(PathSource.error_code(s, b)));
  expect(codes(true)).toEqual(["E0573", "E0573", "E0404", "E0423", "E0532", "E0574", "E0532", "E0575", "E0423", "E0423", "E0799", "E0575", "E0573", "E0425", "E0577"]);
  expect(codes(false)).toEqual(["E0425", "E0425", "E0405", "E0425", "E0531", "E0422", "E0531", "E0576", "E0425", "E0425", "E0800", "E0576", "E0425", "E0425", "E0433"]);
  expect(PathSource.is_call({ $: "Expr", _0: undefined })).toBe(false);
});

test("PathSource::is_expected (late.rs:571)", () => {
  const ctor_fn: Res = def({ $: "Ctor", _0: "Struct", _1: "Fn" });
  const stat: Res = def({ $: "Static", safety: "Safe", mutability: "Not", nested: false });
  const local: Res = { $: "Local", _0: nid(5) };
  const prim: Res = { $: "PrimTy", _0: { $: "Bool" } };
  const self_alias: Res = { $: "SelfTyAlias", alias_to: did(2), is_trait_impl: false };
  const self_param: Res = { $: "SelfTyParam", trait_: did(2) };
  const cases: [PathSource, Res, boolean][] = [
    [PathSource.Type, def(DefKind.Struct), true],
    [PathSource.Type, prim, true],
    [PathSource.Type, def(DefKind.Const), false],
    [PathSource.TypeParam, def(DefKind.Const), true],
    [PathSource.DefineOpaques, self_alias, true],
    [PathSource.DefineOpaques, self_param, false],
    [{ $: "Trait", _0: "No" }, def(DefKind.TraitAlias), false],
    [{ $: "Trait", _0: "Maybe" }, def(DefKind.TraitAlias), true],
    [{ $: "Expr", _0: undefined }, ctor_fn, true],
    [{ $: "Expr", _0: undefined }, stat, true],
    [{ $: "Expr", _0: undefined }, local, true],
    [{ $: "Expr", _0: undefined }, def(DefKind.Struct), false],
    [PathSource.Pat, def(DefKind.AssocConst), true],
    [{ $: "Struct", _0: undefined }, def(DefKind.Variant), true],
    [{ $: "TraitItem", _0: "ValueNS", _1: PathSource.Type }, def(DefKind.AssocFn), true],
    [{ $: "TraitItem", _0: "TypeNS", _1: PathSource.Type }, def(DefKind.AssocFn), false],
    [{ $: "TraitItem", _0: "TypeNS", _1: PathSource.Type }, def(DefKind.AssocTy), true],
    [PathSource.ReturnTypeNotation, def(DefKind.AssocFn), true],
    [PathSource.Delegation, def(DefKind.Fn), true],
    [PathSource.ExternItemImpl, stat, true],
    [{ $: "PreciseCapturingArg", _0: "ValueNS" }, def(DefKind.ConstParam), true],
    [{ $: "PreciseCapturingArg", _0: "TypeNS" }, self_alias, true],
    [{ $: "PreciseCapturingArg", _0: "MacroNS" }, def(DefKind.TyParam), false],
    [PathSource.Macro, def({ $: "Macro", _0: 1 as never }), true],
    [PathSource.Module, def(DefKind.Mod), true],
    [PathSource.Module, def(DefKind.Enum), false],
  ];
  for (const [s, r, want] of cases) {
    expect({ s: s.$, r: r.$ === "Def" ? r._0.$ : r.$, got: PathSource.is_expected(s, r) }).toEqual({ s: s.$, r: r.$ === "Def" ? r._0.$ : r.$, got: want });
  }
});

test("PathSource::descr_expected (late.rs:522)", () => {
  expect(PathSource.descr_expected(PathSource.DefineOpaques)).toBe("type alias or associated type with opaqaue types");
  expect(PathSource.descr_expected({ $: "TupleStruct", _0: DUMMY_SP, _1: [] })).toBe("tuple struct or tuple variant");
  expect(PathSource.descr_expected({ $: "TraitItem", _0: "ValueNS", _1: { $: "TupleStruct", _0: DUMMY_SP, _1: [] } })).toBe("tuple struct or tuple variant");
  expect(PathSource.descr_expected({ $: "TraitItem", _0: "TypeNS", _1: { $: "TupleStruct", _0: DUMMY_SP, _1: [] } })).toBe("associated type");
  expect(PathSource.descr_expected({ $: "TraitItem", _0: "ValueNS", _1: PathSource.Type })).toBe("method or associated constant");
  expect(() => PathSource.descr_expected({ $: "TraitItem", _0: "MacroNS", _1: PathSource.Type })).toThrow("associated macro");
  expect(PathSource.descr_expected({ $: "Expr", _0: undefined })).toBe("value");
  expect(PathSource.descr_expected(PathSource.ExternItemImpl)).toBe("function or static");
  expect(PathSource.descr_expected({ $: "PreciseCapturingArg", _0: "TypeNS" })).toBe("type or const parameter");
  expect(PathSource.descr_expected(PathSource.Module)).toBe("module");
});

test("Rib::new / LifetimeRib::new: bindings keyed by `Ident` value (late.rs:309, 433)", () => {
  const rib = Rib.new<Res>(RibKind.Normal);
  expect(rib.bindings).toBeInstanceOf(KeyedMap);
  expect(rib.patterns_with_skipped_bindings).toBeInstanceOf(KeyedMap);
  expect(rib.kind).toBe(RibKind.Normal);
  const lrib = LifetimeRib.new(LifetimeRibKind.Item);
  expect(lrib.bindings).toBeInstanceOf(KeyedMap);
  expect(lrib.kind).toBe(LifetimeRibKind.Item);
});

test("MaybeExported::eval without owner lookups (late.rs:737)", () => {
  const r = {} as Resolver; // not reached by these variants
  expect(MaybeExported.eval({ $: "Impl", _0: undefined }, r)).toBe(true);
  const pub = { kind: { $: "Public" }, span: DUMMY_SP, tokens: undefined } as never;
  const inh = { kind: { $: "Inherited" }, span: DUMMY_SP, tokens: undefined } as never;
  expect(MaybeExported.eval({ $: "NestedUse", _0: pub }, r)).toBe(true);
  expect(MaybeExported.eval({ $: "ImplItem", _0: { $: "Err", _0: inh } }, r)).toBe(false);
  // An extern trait: `trait_def_id.as_local()` is `None` -> `def_id.is_none_or(..)` is true.
  expect(MaybeExported.eval({ $: "ImplItem", _0: { $: "Ok", _0: new DefId(0 as never, 1 as never) } }, r)).toBe(true);
});

// ---- 2. unit checks: the visitor on a real `Resolver` ------------------------------------------------

const ARGS = (edition: string) => [
  "--target",
  "x86_64-unknown-linux-gnu",
  `--edition=${edition}`,
  "-Zcrate-attr=feature(no_core)",
  "-Zcrate-attr=no_core",
  join(HERE, "resolve_oracle", "empty.rs"),
];

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

/** As resolver_new.test.ts / ident.test.ts: `resolver_for_lowering_raw` up to `Resolver::new`, then `f`. */
function with_resolver<R>(edition: string, f: (r: Resolver, tcx: TyCtxt) => R): R {
  const config = config_from_args(ARGS(edition));
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
        const cr = tcx.create_crate_num(stable_crate_id);
        if (cr.$ !== "Ok") return panic("create_crate_num");
        cr._0.crate_name(crate_name);
        const unit = tcx.feed_unit_query();
        unit.features_query(rustc_expand_config.features(tcx.sess, pre_configured_attrs, crate_name));
        unit.crate_for_resolver(Steal.new<[Crate, Attribute[]]>([krate, pre_configured_attrs], "(rustc_ast::ast::Crate, thin_vec::ThinVec<rustc_ast::ast::Attribute>)"));
        const arenas = Resolver.arenas();
        void tcx.registered_attr_tools(null);
        void tcx.registered_lint_tools(null);
        const [k, attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
        const r = Resolver.new(tcx, attrs, k.spans.inner_span, k.spans.inject_use_span, arenas);
        return f(r, tcx);
      },
    );
  });
  return out as R;
}

/** A fresh `LateResolutionVisitor` on a fresh resolver (edition 2015 unless given). */
function with_visitor<R>(f: (v: LateResolutionVisitor, r: Resolver) => R, edition = "2015"): R {
  return with_resolver(edition, (r) => f(LateResolutionVisitor.new(r), r));
}

const UNIT_PENDING: Record<string, string> = {
  "resolve_lifetime: undeclared lifetime": "rustc_resolve::late::diagnostics::LateResolutionVisitor::emit_undeclared_lifetime_error",
  "resolve_lifetime: a const param type rib": "rustc_resolve::late::diagnostics::LateResolutionVisitor::emit_non_static_lt_in_const_param_ty_error",
  "resolve_anonymous_lifetime: an Item barrier reports a missing lifetime": "rustc_resolve::late::diagnostics::LateResolutionVisitor::report_missing_lifetime_specifiers",
  "resolve_label: an unreachable label in an outer rib": "rustc_resolve::late::diagnostics::LateResolutionVisitor::suggestion_for_label_in_rib",
  "visit_ty: a path type": "rustc_resolve::late::diagnostics::LateResolutionVisitor::smart_resolve_report_errors",
};

function case_(name: string, f: () => void): void {
  test(name, () => {
    const pending = UNIT_PENDING[name];
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
const lt = (id: number, name: string): Lifetime => ({ id: nid(id), ident: ident(name) });
const sp = (lo: number, hi: number): Span => Span.with_root_ctxt(BytePos(lo), BytePos(hi));
const never_ty = (id: number): Ty => new Ty(nid(id), { $: "Never" }, DUMMY_SP);
const generic_param = (id: number, name: string, kind: GenericParam["kind"]): GenericParam =>
  new GenericParamC(nid(id), ident(name), [], [], false, kind, undefined);
const res_map = (r: Resolver): Map<NodeId, LifetimeRes> => r.current_owner.lifetimes_res_map;
const param_res = (index: number, binder: number): LifetimeRes => ({ $: "Param", param: index as LocalDefId, binder: nid(binder) });

case_("LateResolutionVisitor::new / as_ref / as_mut (late.rs:1581, 883, 888)", () => {
  with_visitor((v, r) => {
    expect(v.as_ref()).toBe(r);
    expect(v.as_mut()).toBe(r);
    expect(v.parent_scope.module).toBe(r.graph_root);
    for (const ns of ["ValueNS", "TypeNS", "MacroNS"] as const) {
      const ribs = v.ribs.index(ns);
      expect(ribs.length).toBe(1);
      expect(ribs[0]!.kind).toEqual({ $: "Module", _0: r.graph_root });
      expect(ribs[0]!.bindings.size).toBe(0);
    }
    expect([v.label_ribs.length, v.lifetime_ribs.length, v.use_injections.length, v.use_items.length]).toEqual([0, 0, 0, 0]);
    expect(v.last_block_rib).toBeUndefined();
    expect(v.lifetime_elision_candidates).toBeUndefined();
    expect(v.current_trait_ref).toBeUndefined();
    expect(v.in_func_body).toBe(false);
    expect(v.diag_metadata.currently_processing_generic_args).toBe(false);
    expect(v.diag_metadata.current_elision_failures).toEqual([]);
  });
});

case_("with_rib / with_lifetime_rib push, restore and return (late.rs:1682, 1821)", () => {
  with_visitor((v) => {
    v.lifetime_elision_candidates = [];
    const outer = v.lifetime_elision_candidates;
    const got = v.with_rib("TypeNS", RibKind.AssocItem, (this_) => {
      expect(this_.ribs.index("TypeNS").at(-1)!.kind).toBe(RibKind.AssocItem);
      return this_.with_lifetime_rib(LifetimeRibKind.Item, (this_) => {
        expect(this_.lifetime_ribs.at(-1)!.kind).toBe(LifetimeRibKind.Item);
        // `self.lifetime_elision_candidates.take()`
        expect(this_.lifetime_elision_candidates).toBeUndefined();
        return 7;
      });
    });
    expect(got).toBe(7);
    expect(v.ribs.index("TypeNS").length).toBe(1);
    expect(v.lifetime_ribs.length).toBe(0);
    expect(v.lifetime_elision_candidates).toBe(outer);
  });
});

case_("resolve_lifetime: 'static is recorded as an elision candidate (late.rs:1838, 2465)", () => {
  with_visitor((v, r) => {
    v.lifetime_elision_candidates = [];
    v.resolve_lifetime(lt(40, "'static"), "Ref");
    expect(res_map(r).get(nid(40))).toEqual({ $: "Static" });
    expect(v.lifetime_elision_candidates).toEqual([[{ $: "Static" }, { $: "Ignore" }]]);
  });
});

case_("resolve_lifetime: a named lifetime and its use set (late.rs:1851-1915)", () => {
  with_visitor((v, r) => {
    const a = param_res(2, 24);
    v.with_lifetime_rib({ $: "Generics", binder: nid(24), span: DUMMY_SP, kind: "Function" }, (v) => {
      v.lifetime_ribs.at(-1)!.bindings.set(ident("'a"), [nid(25), a]);
      // First use under `AnonymousCreateParameter` with the same binder: `One`.
      v.with_lifetime_rib({ $: "AnonymousCreateParameter", binder: nid(24), report_in_path: false }, (v) => {
        v.resolve_lifetime(lt(29, "'a"), "Ref");
      });
      expect(v.lifetime_uses.get(2 as LocalDefId)).toEqual({ $: "One", use_span: DUMMY_SP, use_ctxt: "Ref" });
      // Second use: `Many`.
      v.resolve_lifetime(lt(39, "'a"), "GenericArg");
      expect(v.lifetime_uses.get(2 as LocalDefId)!.$).toBe("Many");
    });
    expect(res_map(r).get(nid(29))).toEqual(a);
    expect(res_map(r).get(nid(39))).toEqual(a);
    // A first use under an `Elided` rib with another res, or with `error_in_path`: `Many`.
    const b = param_res(3, 50);
    v.with_lifetime_rib({ $: "Generics", binder: nid(50), span: DUMMY_SP, kind: "Item" }, (v) => {
      v.lifetime_ribs.at(-1)!.bindings.set(ident("'b"), [nid(51), b]);
      v.with_lifetime_rib({ $: "Elided", res: b, error_in_path: false }, (v) => v.resolve_lifetime(lt(52, "'b"), "Ref"));
    });
    expect(v.lifetime_uses.get(3 as LocalDefId)).toEqual({ $: "One", use_span: DUMMY_SP, use_ctxt: "Ref" });
  });
});

case_("resolve_lifetime: undeclared lifetime", () => {
  with_visitor((v) => {
    v.with_lifetime_rib(LifetimeRibKind.Item, (v) => v.resolve_lifetime(lt(9, "'b"), "Ref"));
  });
});

case_("resolve_lifetime: a const param type rib", () => {
  with_visitor((v) => {
    v.with_lifetime_rib(LifetimeRibKind.ConstParamTy, (v) => v.resolve_lifetime(lt(9, "'b"), "Ref"));
  });
});

case_("resolve_elided_lifetime: anchor + fresh parameter, as the probe numbers it (late.rs:2203, 2216)", () => {
  with_visitor((v, r) => {
    const n = NodeId.as_u32(r.next_node_id_);
    v.with_lifetime_rib({ $: "AnonymousCreateParameter", binder: nid(11), report_in_path: false }, (v) => {
      v.resolve_elided_lifetime(nid(13), sp(5, 6));
    });
    // lifetimes.rs `fn elided(x: &u8)`: `ElidedAnchor { start: n, end: n+1 }`, `n` and `n+1` -> `Fresh { param: n+1, Ampersand }`.
    expect(res_map(r).get(nid(13))).toEqual({ $: "ElidedAnchor", start: nid(n), end: nid(n + 1) });
    expect(res_map(r).get(nid(n))).toEqual({ $: "Fresh", param: nid(n + 1), kind: "Ampersand" });
    expect(res_map(r).get(nid(n + 1))).toEqual({ $: "Fresh", param: nid(n + 1), kind: "Ampersand" });
    const extra = r.current_owner.extra_lifetime_params_map.get(nid(11))!;
    expect(extra.length).toBe(1);
    expect([extra[0]![0].name, extra[0]![0].span, extra[0]![1], extra[0]![2]]).toEqual([kw.UnderscoreLifetime, sp(5, 6), nid(n + 1), "Ampersand"]);
  });
});

case_("resolve_anonymous_lifetime: '_ under Elided / ElisionFailure (late.rs:2089, 2093)", () => {
  with_visitor((v, r) => {
    const a = param_res(2, 24);
    v.with_lifetime_rib(LifetimeRibKind.elided(a), (v) => v.resolve_anonymous_lifetime(lt(60, "'_"), nid(60), false));
    expect(res_map(r).get(nid(60))).toEqual(a);
    v.with_lifetime_rib(LifetimeRibKind.ElisionFailure, (v) => v.resolve_anonymous_lifetime(lt(61, "'_"), nid(61), false));
    expect(res_map(r).has(nid(61))).toBe(false);
    expect(v.diag_metadata.current_elision_failures).toEqual([
      [{ id: nid(61), span: DUMMY_SP, kind: "Underscore", count: 1, id_for_lint: nid(61) }, { $: "Left", _0: nid(61) }],
    ]);
    // `Generics` / `ConstParamTy` / `ImplTrait` are transparent.
    v.with_lifetime_rib(LifetimeRibKind.elided({ $: "Infer" }), (v) =>
      v.with_lifetime_rib(LifetimeRibKind.ImplTrait, (v) => v.resolve_anonymous_lifetime(lt(62, "'_"), nid(62), false)),
    );
    expect(res_map(r).get(nid(62))).toEqual({ $: "Infer" });
  });
});

case_("resolve_anonymous_lifetime: explicit '_ under AnonymousReportError (E0637)", () => {
  // E0637 is emitted; the compiler then aborts ("aborting due to 1 previous error") when the session ends.
  let emitted = false;
  expect(() =>
    with_visitor((v) => {
      v.with_lifetime_rib(LifetimeRibKind.AnonymousReportError, (v) => v.resolve_anonymous_lifetime(lt(63, "'_"), nid(63), false));
      emitted = v.r.dcx().has_errors() !== undefined;
    }),
  ).toThrow();
  expect(emitted).toBe(true);
});

case_("resolve_anonymous_lifetime: an Item barrier reports a missing lifetime", () => {
  with_visitor((v) => {
    v.with_lifetime_rib(LifetimeRibKind.Item, (v) => v.resolve_anonymous_lifetime(lt(64, "'_"), nid(64), false));
  });
});

case_("record_lifetime_def: a second resolution of the same id panics (late.rs:2492)", () => {
  with_visitor((v) => {
    v.record_lifetime_def(nid(70), { $: "Static" });
    expect(() => v.record_lifetime_def(nid(70), { $: "Infer" })).toThrow("lifetime parameter NodeId(70) resolved multiple times (Static before, Infer now)");
  });
});

case_("resolve_elided_lifetimes_in_path: inferred, fresh, elided and failing ribs (late.rs:2241)", () => {
  with_visitor((v, r) => {
    r.item_generics_num_lifetimes_.set(CRATE_DEF_ID, 2);
    const s = new Segment(ident("S"), nid(68), false, false, sp(10, 11));
    const res = PartialRes.new({ $: "Def", _0: DefKind.Struct, _1: LocalDefId.to_def_id(CRATE_DEF_ID) } as HirRes<NodeId>);
    // Expression position: `Infer` for every elided lifetime, no lint.
    let n = NodeId.as_u32(r.next_node_id_);
    v.resolve_elided_lifetimes_in_path(res, [s], { $: "Expr", _0: undefined }, sp(10, 11));
    expect(res_map(r).get(nid(68))).toEqual({ $: "ElidedAnchor", start: nid(n), end: nid(n + 2) });
    expect([res_map(r).get(nid(n)), res_map(r).get(nid(n + 1))]).toEqual([{ $: "Infer" }, { $: "Infer" }]);
    expect(r.lint_buffer_.map.size).toBe(0);
    res_map(r).clear();

    // Type position in a fn signature: fresh params (`Brackets`), the first record carries the candidate,
    // and ELIDED_LIFETIMES_IN_PATHS is buffered on the segment.
    n = NodeId.as_u32(r.next_node_id_);
    v.lifetime_elision_candidates = [];
    v.with_lifetime_rib({ $: "AnonymousCreateParameter", binder: nid(65), report_in_path: false }, (v) => {
      v.lifetime_elision_candidates = [];
      v.resolve_elided_lifetimes_in_path(res, [s], PathSource.Type, sp(10, 11));
      const c = v.lifetime_elision_candidates!;
      expect(c.length).toBe(2);
      expect(c[0]![1]).toEqual({ $: "Missing", _0: { id: nid(n), id_for_lint: nid(68), span: sp(10, 11), kind: "Brackets", count: 2 } });
      expect(c[1]![1]).toEqual({ $: "Ignore" });
    });
    expect(res_map(r).get(nid(n))).toEqual({ $: "Fresh", param: nid(n + 2), kind: "Brackets" });
    expect(res_map(r).get(nid(n + 1))).toEqual({ $: "Fresh", param: nid(n + 3), kind: "Brackets" });
    expect(r.current_owner.extra_lifetime_params_map.get(nid(65))!.map((x) => x[1])).toEqual([nid(n + 2), nid(n + 3)]);
    expect([...r.lint_buffer_.map.keys()]).toEqual([nid(68)]);
    res_map(r).clear();

    // With generic args: the opening bracket span, `Comma`; under `ElisionFailure` the range is deferred.
    const s2 = new Segment(ident("S"), nid(69), true, false, sp(20, 25));
    n = NodeId.as_u32(r.next_node_id_);
    v.with_lifetime_rib(LifetimeRibKind.ElisionFailure, (v) => v.resolve_elided_lifetimes_in_path(res, [s2], PathSource.Type, sp(19, 25)));
    expect(v.diag_metadata.current_elision_failures).toEqual([
      [{ id: nid(n), id_for_lint: nid(69), span: sp(20, 21), kind: "Comma", count: 2 }, { $: "Right", _0: { start: nid(n), end: nid(n + 2) } }],
    ]);
    // A segment with lifetime args, or without an id, is skipped.
    v.resolve_elided_lifetimes_in_path(res, [new Segment(ident("S"), nid(71), true, true, DUMMY_SP)], PathSource.Type, DUMMY_SP);
    v.resolve_elided_lifetimes_in_path(res, [new Segment(ident("S"), undefined, false, false, DUMMY_SP)], PathSource.Type, DUMMY_SP);
    expect(res_map(r).has(nid(71))).toBe(false);
  });
});

case_("resolve_fn_signature: no parameters, default return", () => {
  with_visitor((v) => {
    v.resolve_fn_signature(nid(80), false, [], { $: "Default", _0: DUMMY_SP }, false);
  });
});

case_("find_lifetime_for_self: `&Self`, `&'a Self`, `&u8`, `&&Self` (late.rs:2675)", () => {
  with_visitor((v, r) => {
    const self_ty = (id: number) => new Ty(nid(id), { $: "ImplicitSelf" }, DUMMY_SP);
    const fresh: LifetimeRes = { $: "Fresh", param: nid(101), kind: "Ampersand" };
    // `&self`: the elided anchor of the reference type points at the fresh lifetime.
    const ref_self = new Ty(nid(90), { $: "Ref", _0: undefined, _1: self_ty(91), _2: "Not" }, DUMMY_SP);
    res_map(r).set(nid(90), { $: "ElidedAnchor", start: nid(100), end: nid(101) });
    res_map(r).set(nid(100), fresh);
    expect(v.find_lifetime_for_self(ref_self)).toEqual({ $: "One", _0: fresh });
    // `self: &'a Self`
    const a = param_res(2, 24);
    res_map(r).set(nid(92), a);
    const ref_a_self = new Ty(nid(93), { $: "Ref", _0: lt(92, "'a"), _1: self_ty(94), _2: "Not" }, DUMMY_SP);
    expect(v.find_lifetime_for_self(ref_a_self)).toEqual({ $: "One", _0: a });
    // `&u8`: no `Self` inside -> `Empty` (the path type reads `partial_res_map`).
    const u8 = new Ty(nid(95), { $: "Path", _0: undefined, _1: { span: DUMMY_SP, segments: [], tokens: undefined } as never }, DUMMY_SP);
    r.partial_res_map.set(nid(95), PartialRes.new({ $: "PrimTy", _0: { $: "Uint", _0: "U8" } }));
    expect(v.find_lifetime_for_self(new Ty(nid(96), { $: "Ref", _0: lt(92, "'a"), _1: u8, _2: "Not" }, DUMMY_SP))).toEqual({ $: "Empty" });
    // `&'a &Self`: two references containing `Self` with distinct lifetimes -> `Many`.
    const outer = new Ty(nid(97), { $: "Ref", _0: lt(92, "'a"), _1: ref_self, _2: "Not" }, DUMMY_SP);
    expect(v.find_lifetime_for_self(outer)).toEqual({ $: "Many" });
  });
});

case_("resolve_label / is_label_valid_from_rib (late.rs:2783, 2820)", () => {
  with_visitor((v) => {
    const outer = Rib.new<NodeId>(RibKind.Normal);
    outer.bindings.set(Ident.new(Symbol.intern("'outer"), sp(1, 7)), nid(53));
    v.label_ribs.push(outer);
    // Found in the innermost rib: `Ok((id, definition_span))`.
    expect(v.resolve_label(Ident.new(Symbol.intern("'outer"), sp(30, 36)))).toEqual({ $: "Ok", _0: [nid(53), sp(1, 7)] });
    v.label_ribs.push(Rib.new<NodeId>(RibKind.FnOrCoroutine));
    expect(v.is_label_valid_from_rib(0)).toBe(false);
    expect(v.is_label_valid_from_rib(1)).toBe(true);
    // `all` stops at the first barrier; a rib kind that is neither is a bug.
    v.label_ribs.splice(1, 1, Rib.new<NodeId>(RibKind.AssocItem));
    expect(() => v.is_label_valid_from_rib(0)).toThrow("unexpected rib kind: AssocItem");
  });
});

case_("resolve_label: an unreachable label in an outer rib", () => {
  with_visitor((v) => {
    const outer = Rib.new<NodeId>(RibKind.Normal);
    outer.bindings.set(ident("'a"), nid(53));
    v.label_ribs.push(outer, Rib.new<NodeId>(RibKind.FnOrCoroutine));
    v.resolve_label(ident("'a"));
  });
});

case_("maybe_resolve_ident_in_lexical_scope finds a rib binding (late.rs:1609)", () => {
  with_visitor((v) => {
    const local: Res = { $: "Local", _0: nid(16) };
    v.with_rib("ValueNS", RibKind.Normal, (v) => {
      v.ribs.index("ValueNS").at(-1)!.bindings.set(ident("x"), local);
      expect(v.maybe_resolve_ident_in_lexical_scope(ident("x"), "ValueNS")).toEqual({ $: "RibDef", _0: local });
      expect(v.resolve_ident_in_lexical_scope(ident("x"), "ValueNS", undefined, undefined)).toEqual({ $: "RibDef", _0: local });
    });
  });
});

case_("visit_generic_params: forward-ban ribs and their order (late.rs:1694)", () => {
  with_visitor((v) => {
    // `<'l, T = !, U = !, const N: usize>` in an ADT (`add_self_upper`): while `T`'s default is visited the
    // type ban rib holds `T, U, Self` and the value ban rib `N`; after `T`, `swap_remove(T)` moves `Self` first.
    const params = [
      generic_param(1, "'l", { $: "Lifetime" }),
      generic_param(2, "T", { $: "Type", default: never_ty(10) }),
      generic_param(3, "U", { $: "Type", default: never_ty(11) }),
    ];
    const seen: string[] = [];
    const names = (m: Map<Ident, Res>) => [...m.keys()].map((k) => Symbol.as_str(k.name)).join(",");
    const orig = v.visit_ty;
    v.visit_ty = function (this: LateResolutionVisitor, ty: Ty): undefined {
      const t = this.ribs.index("TypeNS").at(-1)!;
      const val = this.ribs.index("ValueNS").at(-1)!;
      seen.push(`${NodeId.as_u32(ty.id)} ${t.kind.$}(${(t.kind as { _0: string })._0}) [${names(t.bindings)}] [${names(val.bindings)}] lt=${this.lifetime_ribs.at(-1)!.kind.$}`);
      return orig.call(this, ty);
    };
    v.visit_generic_params(params, true);
    expect(seen).toEqual(["10 ForwardGenericParamBan(Default) [T,U,Self] [] lt=AnonymousReportError", "11 ForwardGenericParamBan(Default) [Self,U] [] lt=AnonymousReportError"]);
    expect(v.ribs.index("TypeNS").length).toBe(1);
    expect(v.ribs.index("ValueNS").length).toBe(1);
    expect(v.lifetime_ribs.length).toBe(0);
  });
});

case_("visit_ty: a path type", () => {
  with_visitor((v) => {
    v.visit_ty(new Ty(nid(5), { $: "Path", _0: undefined, _1: { span: DUMMY_SP, segments: [], tokens: undefined } as never }, DUMMY_SP));
  });
});

case_("visit_ty: elided reference, ImplTrait and never (late.rs:950)", () => {
  with_visitor((v, r) => {
    const n = NodeId.as_u32(r.next_node_id_);
    v.lifetime_elision_candidates = [];
    v.with_lifetime_rib({ $: "AnonymousCreateParameter", binder: nid(11), report_in_path: false }, (v) => {
      v.lifetime_elision_candidates = [];
      v.visit_ty(new Ty(nid(13), { $: "Ref", _0: undefined, _1: never_ty(14), _2: "Not" }, sp(3, 6)));
      // The anchor's span is `source_map().start_point(ty.span)`; the fresh lifetime is a candidate.
      expect(v.lifetime_elision_candidates!.map(([res]) => res)).toEqual([{ $: "Fresh", param: nid(n + 1), kind: "Ampersand" }]);
      // `impl Trait` hides the outer candidates while it is walked and restores them.
      const before = v.lifetime_elision_candidates;
      v.visit_ty(new Ty(nid(15), { $: "ImplTrait", _0: nid(16), _1: [] }, DUMMY_SP));
      expect(v.lifetime_elision_candidates).toBe(before);
    });
    expect(res_map(r).get(nid(13))).toEqual({ $: "ElidedAnchor", start: nid(n), end: nid(n + 1) });
    expect(v.diag_metadata.current_trait_object).toBeUndefined();
    expect(v.diag_metadata.current_type_path).toBeUndefined();
  });
});

case_("visit_ty: ImplicitSelf resolves `Self` from the ribs and records it (late.rs:1001)", () => {
  with_visitor((v, r) => {
    const self_res: Res = { $: "SelfTyAlias", alias_to: LocalDefId.to_def_id(CRATE_DEF_ID), is_trait_impl: false };
    v.with_rib("TypeNS", { $: "Item", _0: { $: "No" }, _1: DefKind.Struct }, (v) => {
      v.ribs.index("TypeNS").at(-1)!.bindings.set(Ident.with_dummy_span(kw.SelfUpper), self_res);
      v.visit_ty(new Ty(nid(17), { $: "ImplicitSelf" }, DUMMY_SP));
    });
    expect(r.partial_res_map.get(nid(17))!.full_res()).toEqual(self_res);
  });
});

case_("visit_attribute does nothing; visit_anon_const is a bug; visit_ty_pat on NotNull (late.rs:895, 917, 1079)", () => {
  with_visitor((v) => {
    expect(v.visit_attribute({} as Attribute)).toBeUndefined();
    const value = new Expr(nid(3), { $: "Underscore" }, DUMMY_SP, [], undefined);
    expect(() => v.visit_anon_const({ id: nid(1), value })).toThrow("encountered anon const without a manual call to `resolve_anon_const`");
    expect(v.visit_ty_pat({ id: nid(2), kind: { $: "NotNull" }, span: DUMMY_SP, tokens: undefined } as never)).toBeUndefined();
  });
});

case_("future_proof_import: 2015 paths and keywords return early; nested trees recurse (late.rs:2848)", () => {
  with_visitor((v) => {
    const path = (names: string[]) => ({ span: DUMMY_SP, segments: names.map((n) => ({ ident: ident(n), id: nid(1), args: undefined })), tokens: undefined });
    // Edition 2015 spans: early return even with a local `x` in scope.
    v.with_rib("ValueNS", RibKind.Normal, (v) => {
      v.ribs.index("ValueNS").at(-1)!.bindings.set(ident("x"), { $: "Local", _0: nid(16) });
      v.future_proof_import({ prefix: path(["x"]), kind: { $: "Simple", _0: undefined } } as never);
      // A nested tree with an empty prefix recurses into its items.
      v.future_proof_import({
        prefix: path([]),
        kind: { $: "Nested", items: [{ inner: { prefix: path(["self", "x"]), kind: { $: "Glob", _0: DUMMY_SP } } }], span: DUMMY_SP },
      } as never);
    });
  });
});

case_("future_proof_import: edition 2018 `use x;` with a local `x`", () => {
  // `ImportsCannotReferTo` ("imports cannot refer to local variables") is emitted once; the compiler then
  // aborts ("aborting due to 1 previous error") when the session ends.
  let reported = -1;
  expect(() =>
    with_visitor((v) => {
      const path = { span: DUMMY_SP, segments: [{ ident: ident("x"), id: nid(1), args: undefined }], tokens: undefined };
      const before = v.r.dcx().err_count();
      v.with_rib("ValueNS", RibKind.Normal, (v) => {
        v.ribs.index("ValueNS").at(-1)!.bindings.set(ident("x"), { $: "Local", _0: nid(16) });
        v.future_proof_import({ prefix: path, kind: { $: "Simple", _0: undefined } } as never);
      });
      reported = v.r.dcx().err_count() - before;
    }, "2018"),
  ).toThrow();
  expect(reported).toBe(1);
});
