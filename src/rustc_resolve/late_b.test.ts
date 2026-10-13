// Tests for the second half of compiler/rustc_resolve/src/late.rs (lane res-late-b: `resolve_item` onwards,
// `ItemInfoCollector`, `late_resolve_crate`).
//
// 1. Oracle cases (late_b_oracle/<case>.rs, `#![no_core]` crates with the `resdump-nocore` arguments,
//    graph_oracle/args.ts): patterns, labels, traits/impls/qpaths/consts, and the late-resolution errors of
//    this half. Fixtures: <case>.resdump.stdout / .resdump.stderr from tools/probes/resdump and
//    exit_codes.json, made by `REGEN=1 bun test src/rustc_resolve/late_b.test.ts` (rustc 1.101.0-nightly
//    (6f5da406b 2026-10-10)); with the probe present they are re-checked on every run.
//    a. In process: `Resolver::new`, the expansion step of `configure_and_expand` (as
//       build_reduced_graph.test.ts), then `Resolver::late_resolve_crate`; compared with the probe:
//       `partial_res_map`, each owner's `label_res` / `trait_map` / `extra_lifetime_params` lines and
//       `lint_buffer` (UNUSED_LABELS).
//    b. Through the driver (src/rust_ts/resdump.ts), stdout + stderr + exit code.
//    PENDING (the unported text it stops at is asserted; root deletes an entry once it runs): the driver runs;
//    every in-process case matches since the late.rs / late/diagnostics.rs integration (merge-late).
// 2. Unit checks of this half on a real `Resolver` (expectations follow the upstream code they cite). Test
//    stand-ins replace the few small lane res-late-a functions they need (`LateResolutionVisitor::new`,
//    `Rib::new`, `LifetimeRib::new`, `with_rib`, `with_lifetime_rib`, `LifetimeRibKind::elided`,
//    `ConstantHasGenerics::force_yes_if`, `record_lifetime_def`, `record_lifetime_err`): the upstream
//    bodies, installed only while the real function is still the stub.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import { type AssocItem, BindingMode, type Attribute, type Block, CRATE_NODE_ID, type Crate, type GenericParam, type Generics, type Item, ItemKind, Pat, type PatKind, visit } from "../rustc_ast/lib.ts";
import { debug_NodeId, type NodeId } from "../rustc_ast/node_id.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { ExtCtxt } from "../rustc_expand/base.ts";
import * as rustc_expand_config from "../rustc_expand/config.ts";
import { pre_configure_attrs } from "../rustc_expand/config.ts";
import { ExpansionConfig } from "../rustc_expand/expand.ts";
import { PerNS } from "../rustc_hir/def.ts";
import { Definitions } from "../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import * as limits from "../rustc_interface/limits.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../rustc_interface/passes.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../rustc_middle/hooks.ts";
import { debug_PartialRes, type LifetimeRes, PartialRes } from "../rustc_middle/middle/resolve.ts";
import { clone_ExternProviders, clone_Providers } from "../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt, TyCtxtFeed } from "../rustc_middle/ty/context.ts";
import type { Visibility } from "../rustc_middle/ty/mod.ts";
import { query_system } from "../rustc_query_impl/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { CRATE_DEF_ID, CrateNum, DEF_ID_DEBUG, type DefId, DefIndex, LOCAL_CRATE, LocalDefId, type ModId, ModId_eq, StableCrateId } from "../rustc_span/def_id.ts";
import { debug_Span, DUMMY_SP, ErrorGuaranteed } from "../rustc_span/lib.ts";
import { debug_Ident, Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import type { Limit } from "../rustc_structures/limit.ts";
import { debug_vec, type Fmt, PLAIN } from "../std/fmt.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { panic, Unported, unwrap } from "../std/panic.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { ARGS, probe_path } from "./graph_oracle/args.ts";
import {
  ConstantHasGenerics,
  type DiagMetadata,
  type IsRepeatExpr,
  ItemInfoCollector,
  LateResolutionVisitor,
  LifetimeRib,
  type LifetimeRibKind,
  LifetimeRibKind as LifetimeRibKindC,
  type PatternBindings,
  required_generic_args_suggestion,
  def_id_matches_path,
  Rib,
  type RibKind,
} from "./late.ts";
import { DefId_key, Finalize, Ident_key, ParentScope, provide, type Res, Resolver, Segment, with_owner } from "./lib.ts";

const DIR = join(import.meta.dir, "late_b_oracle");
const ROOT = join(import.meta.dir, "..", "..");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const REGEN = process.env.REGEN === "1";

// ---- 1. oracle cases --------------------------------------------------------------------------

const CASES = ["patterns", "labels", "traits", "errors"] as const;
type Case = (typeof CASES)[number];

/** In-process runs that stop at unported code: the text of the `Unported` they reach. */
const PENDING_IN_PROCESS: Partial<Record<Case, string>> = {
};
/** Driver runs that stop at unported code (exit 70); the reason is the first missing piece. */
const PENDING_DRIVER: Partial<Record<Case, string>> = {};

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
function probe(): string | undefined {
  let p: string;
  try {
    p = probe_path();
  } catch {
    return undefined;
  }
  return existsSync(p) ? p : undefined;
}
const fixture = (name: string): string => readFileSync(join(DIR, name), "utf8");
const exit_codes = (): Record<string, number> => JSON.parse(fixture("exit_codes.json"));

if (REGEN) {
  const p = probe();
  if (p === undefined) throw new Error("ERROR: REGEN needs the resdump probe (bun scripts/probes.ts build resdump)");
  const codes: Record<string, number> = {};
  for (const c of CASES) {
    const r = run([p, ...ARGS(true), `${c}.rs`]);
    writeFileSync(join(DIR, `${c}.resdump.stdout`), r.stdout);
    writeFileSync(join(DIR, `${c}.resdump.stderr`), r.stderr);
    codes[c] = r.exit;
  }
  writeFileSync(join(DIR, "exit_codes.json"), JSON.stringify(codes, null, 2) + "\n");
}

test("late_b_oracle fixtures are the current probe output", () => {
  const p = probe();
  if (p === undefined) {
    if (REQUIRE) throw new Error("ERROR: resdump probe missing (bun scripts/probes.ts build resdump)");
    return;
  }
  const codes = exit_codes();
  for (const c of CASES) {
    const r = run([p, ...ARGS(true), `${c}.rs`]);
    expect({ c, exit: r.exit, stdout: r.stdout, stderr: r.stderr }).toEqual({
      c,
      exit: codes[c]!,
      stdout: fixture(`${c}.resdump.stdout`),
      stderr: fixture(`${c}.resdump.stderr`),
    });
  }
}, 120_000);

test("the fixtures exercise what they are named for", () => {
  // Guards against a fixture silently losing its point when it is regenerated.
  expect(fixture("patterns.resdump.stdout")).toMatch(/PartialRes \{ base_res: Local\(NodeId\(\d+\)\)/);
  expect(fixture("patterns.resdump.stdout")).toContain("Def(Ctor(Struct, Const)");
  expect(fixture("labels.resdump.stdout")).toContain("UNUSED_LABELS");
  expect(fixture("labels.resdump.stdout")).toContain("  label_res ");
  expect(fixture("labels.resdump.stderr")).toContain("label name `'a` shadows a label name that is already in scope");
  expect(fixture("traits.resdump.stdout")).toContain("  trait_map ");
  expect(fixture("traits.resdump.stdout")).toContain("SelfTyAlias");
  for (const code of ["E0201", "E0407", "E0323", "E0325", "E0403", "E0415", "E0408", "E0416", "E0409", "E0530"]) {
    expect(fixture("errors.resdump.stderr")).toContain(`error[${code}]`);
  }
});

// -- 1a. in process ------------------------------------------------------------------------------

class CaptureConfig extends Error {}
/** The `interface::Config` rustc's driver builds from `args` (as resolver_new.test.ts). */
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

const NO_CSTORE = new Proxy({}, { get: () => () => panic("test: rustc_metadata::creader::CStore (wave 11)") }) as unknown as CrateStore;

/** As build_reduced_graph.test.ts's `with_tcx` (crate name = the file stem). */
function with_tcx<R>(file: string, f: (tcx: TyCtxt) => R): R {
  const config = config_from_args([...ARGS(false), file]);
  let out: R | undefined;
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const krate = parse(sess);
    const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
    // PORT (test): `get_crate_name` -> the file stem; `collect_crate_types` -> `bin`.
    const crate_name = Symbol.intern(file.replace(/^.*\//, "").replace(/\.rs$/, ""));
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

/** passes.rs:1523 `get_recursion_limit` (as build_reduced_graph.test.ts). */
function get_recursion_limit(krate_attrs: readonly Attribute[], sess: Session): Limit {
  const attr = AttributeParser.parse_limited_sym_should_emit(sess, krate_attrs, [sym.recursion_limit], DUMMY_SP, undefined, {
    $: "EarlyFatal",
    also_emit_lints: false,
  });
  return limits.get_recursion_limit(attr === undefined ? [] : [attr], sess);
}

/** Stand-in for rustc_middle's `query_feed` re-feed check of `visibility` (as build_reduced_graph.test.ts). */
function with_visibility_refeed<R>(f: () => R): R {
  const proto = TyCtxtFeed.prototype as unknown as Record<string, (this: TyCtxtFeed<LocalDefId>, v: Visibility<ModId>) => void>;
  const orig = proto.visibility!;
  const fed = new Map<LocalDefId, Visibility<ModId>>();
  proto.visibility = function (this: TyCtxtFeed<LocalDefId>, v: Visibility<ModId>): void {
    const key = this.key();
    const old = fed.get(key);
    if (old !== undefined) {
      const same = old.$ === v.$ && (old.$ === "Public" || ModId_eq(old._0, (v as { _0: ModId })._0));
      if (!same) panic("test stand-in: re-feeding a different visibility");
      return;
    }
    fed.set(key, v);
    orig.call(this, v);
  };
  try {
    return f();
  } finally {
    proto.visibility = orig;
  }
}

/** `{:?}` of a local `DefId` (callbacks.rs `def_id_debug` + `def_path_debug_str`), as build_reduced_graph.test.ts. */
function def_id_debug(tcx: TyCtxt): (def_id: DefId, f: Fmt) => string {
  return (def_id) => {
    if (def_id.krate !== LOCAL_CRATE) throw new Error("test helper: local DefIds only");
    const scid = tcx.stable_crate_id(LOCAL_CRATE);
    const hi16 = (StableCrateId.as_u64(scid) >> 48n).toString(16).padStart(4, "0");
    const local = unwrap(def_id.as_local());
    const path = tcx.definitions_untracked().def_path(local).to_string_no_crate_verbose();
    return `DefId(${CrateNum.as_u32(def_id.krate)}:${DefIndex.as_u32(def_id.index)} ~ ${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}[${hi16}]${path})`;
  };
}

/** `Resolver::new` and `configure_and_expand`'s expansion step on `file`; then `f(resolver, krate)`. */
function with_expanded<R>(file: string, f: (tcx: TyCtxt, resolver: Resolver, krate: Crate) => R): R {
  return with_visibility_refeed(() =>
    with_tcx(file, (tcx) => {
      const sess = tcx.sess;
      const arenas = Resolver.arenas();
      void tcx.registered_attr_tools(null);
      void tcx.registered_lint_tools(null);
      const [krate, pre_configured_attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
      const resolver = Resolver.new(tcx, pre_configured_attrs, krate.spans.inner_span, krate.spans.inject_use_span, arenas);
      const cfg = new ExpansionConfig(
        tcx.crate_name(LOCAL_CRATE),
        tcx.features(),
        get_recursion_limit(pre_configured_attrs, sess),
        sess.opts.unstable_opts.trace_macros,
        sess.is_test_crate(),
        sess.opts.unstable_opts.span_debug,
        sess.opts.unstable_opts.proc_macro_backtrace,
      );
      const ecx = ExtCtxt.new(sess, cfg, resolver, undefined);
      const expanded = ecx.monotonic_expander().expand_crate(krate);
      const old_debug = DEF_ID_DEBUG.swap(def_id_debug(tcx));
      try {
        return f(tcx, resolver, expanded);
      } finally {
        DEF_ID_DEBUG.swap(old_debug);
      }
    }),
  );
}

/** The compared sections after `late_resolve_crate`, printed like tools/probes/resdump/main.rs. */
function dump_after_late(tcx: TyCtxt, resolver: Resolver): Map<string, string[]> {
  const sec = new Map<string, string[]>();
  const did = (d: DefId): string => def_id_debug(tcx)(d, PLAIN);
  sec.set(
    "partial_res_map",
    [...resolver.partial_res_map].sort((a, b) => a[0] - b[0]).map(([id, pr]) => `${debug_NodeId(id, PLAIN)} ${debug_PartialRes(pr, PLAIN)}`),
  );
  const owner_lines: string[] = [];
  for (const [owner, o] of [...resolver.owners].sort((a, b) => a[0] - b[0])) {
    const o_ = debug_NodeId(owner, PLAIN);
    for (const [id, target] of [...o.label_res_map].sort((a, b) => a[0] - b[0])) {
      owner_lines.push(`${o_} label_res ${debug_NodeId(id, PLAIN)} ${debug_NodeId(target, PLAIN)}`);
    }
    for (const [id, cands] of [...o.trait_map].sort((a, b) => a[0] - b[0])) {
      // `TraitCandidate` is lib.ts's stand-in (hir.rs, M3): `#[derive(Debug)]` by hand.
      const c = (cands as { def_id: DefId; import_ids: readonly LocalDefId[]; lint_ambiguous: boolean }[]).map(
        (t) =>
          `TraitCandidate { def_id: ${did(t.def_id)}, import_ids: [${t.import_ids.map((i) => did(LocalDefId.to_def_id(i))).join(", ")}], lint_ambiguous: ${t.lint_ambiguous} }`,
      );
      owner_lines.push(`${o_} trait_map ${debug_NodeId(id, PLAIN)} [${c.join(", ")}]`);
    }
    for (const [id, params] of [...o.extra_lifetime_params_map].sort((a, b) => a[0] - b[0])) {
      // `MissingLifetimeKind` (hir.rs, M3) is a fieldless enum: its Debug is the variant name.
      const p = params.map(([ident, nid, kind]) => `(${debug_Ident(ident, PLAIN)}, ${debug_NodeId(nid, PLAIN)}, ${String(kind)})`);
      owner_lines.push(`${o_} extra_lifetime_params ${debug_NodeId(id, PLAIN)} [${p.join(", ")}]`);
    }
  }
  sec.set("owner_maps", owner_lines);
  const lints: string[] = [];
  for (const [id, ls] of resolver.lint_buffer_.map) {
    for (const l of ls) {
      const spans = l.span === undefined ? [] : l.span.primary_spans;
      lints.push(`${debug_NodeId(id, PLAIN)} ${l.lint_id.lint.name} ${debug_vec(spans, PLAIN, debug_Span)}`);
    }
  }
  sec.set("lint_buffer", lints);
  return sec;
}

/** The probe's sections compared by `dump_after_late`. */
function parse_probe(text: string): Map<string, string[]> {
  const sec = new Map<string, string[]>();
  let cur: string[] | undefined;
  let owner = "";
  const owner_lines: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^== (\w+)(?: \((\d+)\))?$/.exec(line);
    if (m) {
      cur = [];
      sec.set(m[1]!, cur);
      continue;
    }
    if (line === "" || cur === undefined) continue;
    cur.push(line);
    if (sec.get("owners") === cur) {
      if (!line.startsWith("  ")) owner = line.split(" ")[0]!;
      else if (/^ {2}(label_res|trait_map|extra_lifetime_params) /.test(line)) owner_lines.push(`${owner} ${line.slice(2)}`);
    }
  }
  return new Map([
    ["partial_res_map", unwrap(sec.get("partial_res_map"))],
    ["owner_maps", owner_lines],
    ["lint_buffer", unwrap(sec.get("lint_buffer"))],
  ]);
}

describe("late_resolve_crate vs the resdump probe (in process)", () => {
  for (const c of CASES) {
    test(`${c}${PENDING_IN_PROCESS[c] ? " (PENDING)" : ""}`, () => {
      const pending = PENDING_IN_PROCESS[c];
      let dumped: Map<string, string[]> | undefined;
      // As the probe runs (fixtures made with cwd = late_b_oracle and the bare file name), so spans print
      // `<case>.rs:..`. A crate with errors then ends the session with "aborting due to N previous errors"
      // (`FatalErrorMarker`) after the dump, as the probe's run does (its exit code is in exit_codes.json).
      const go = (): Map<string, string[]> => {
        const cwd = process.cwd();
        process.chdir(DIR);
        try {
          return with_expanded(`${c}.rs`, (tcx, resolver, krate) => {
            resolver.late_resolve_crate(krate);
            dumped = dump_after_late(tcx, resolver);
            return dumped;
          });
        } catch (e) {
          if (e instanceof FatalErrorMarker && dumped !== undefined && exit_codes()[c] !== 0) return dumped;
          throw e;
        } finally {
          process.chdir(cwd);
        }
      };
      if (pending !== undefined) {
        let err: unknown;
        try {
          go();
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(Unported);
        expect((err as Unported).what).toBe(pending);
        return;
      }
      const got = go();
      for (const [section, lines] of parse_probe(fixture(`${c}.resdump.stdout`))) {
        expect({ section, lines: got.get(section) }).toEqual({ section, lines });
      }
    }, 60_000);
  }
});

// -- 1b. through the driver ----------------------------------------------------------------------

describe("resdump subject vs the probe (driver)", () => {
  for (const c of CASES) {
    test(`${c}${PENDING_DRIVER[c] ? " (PENDING)" : ""}`, () => {
      let args: string[];
      try {
        args = [...ARGS(true), `${c}.rs`];
      } catch (e) {
        if (REQUIRE) throw e;
        return;
      }
      const r = run(["bun", join(ROOT, "src/rust_ts/resdump.ts"), ...args]);
      if (PENDING_DRIVER[c] !== undefined) {
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
});

// ---- 2. unit checks -------------------------------------------------------------------------------

// The stand-ins for lane res-late-a's small functions (the upstream bodies, cited), installed only while
// the real function is still the stub.
type Target = Record<string, unknown>;
const STAND_INS: [Target, string, unknown][] = [
  [
    LateResolutionVisitor as unknown as Target,
    "new",
    // late.rs:1581 `LateResolutionVisitor::new`
    function (resolver: Resolver): LateResolutionVisitor {
      const graph_root = resolver.graph_root;
      const parent_scope = ParentScope.module(graph_root, resolver.arenas);
      const start_rib_kind: RibKind = { $: "Module", _0: graph_root };
      return new LateResolutionVisitor(
        resolver,
        parent_scope,
        new PerNS<Rib[]>([Rib.new(start_rib_kind)], [Rib.new(start_rib_kind)], [Rib.new(start_rib_kind)]),
        undefined,
        [],
        [],
        undefined,
        undefined,
        default_DiagMetadata(),
        false,
        new Map(),
        [],
        [],
      );
    },
  ],
  [
    Rib as unknown as Target,
    "new",
    // late.rs:309 `Rib::new`
    function <R>(kind: RibKind): Rib<R> {
      return new Rib<R>(new KeyedMap(Ident_key), new KeyedMap(DefId_key), kind);
    },
  ],
  [
    LifetimeRib as unknown as Target,
    "new",
    // late.rs:433 `LifetimeRib::new`
    function (kind: LifetimeRibKind): LifetimeRib {
      return new LifetimeRib(kind, new KeyedMap(Ident_key));
    },
  ],
  [
    LifetimeRibKindC as unknown as Target,
    "elided",
    // late.rs:388 `LifetimeRibKind::elided`
    function (res: LifetimeRes): LifetimeRibKind {
      return { $: "Elided", res, error_in_path: false };
    },
  ],
  [
    ConstantHasGenerics as unknown as Target,
    "force_yes_if",
    // late.rs:152 `ConstantHasGenerics::force_yes_if`
    function (self: ConstantHasGenerics, b: boolean): ConstantHasGenerics {
      return b ? ConstantHasGenerics.Yes : self;
    },
  ],
  [
    LateResolutionVisitor.prototype as unknown as Target,
    "with_rib",
    // late.rs:1682 `with_rib`
    function <T>(this: LateResolutionVisitor, ns: "TypeNS" | "ValueNS" | "MacroNS", kind: RibKind, work: (this_: LateResolutionVisitor) => T): T {
      this.ribs.index(ns).push(Rib.new(kind));
      const ret = work(this);
      this.ribs.index(ns).pop();
      return ret;
    },
  ],
  [
    LateResolutionVisitor.prototype as unknown as Target,
    "with_lifetime_rib",
    // late.rs:1821 `with_lifetime_rib`
    function <T>(this: LateResolutionVisitor, kind: LifetimeRibKind, work: (this_: LateResolutionVisitor) => T): T {
      this.lifetime_ribs.push(LifetimeRib.new(kind));
      const outer_elision_candidates = this.lifetime_elision_candidates;
      this.lifetime_elision_candidates = undefined;
      const ret = work(this);
      this.lifetime_elision_candidates = outer_elision_candidates;
      this.lifetime_ribs.pop();
      return ret;
    },
  ],
  [
    LateResolutionVisitor.prototype as unknown as Target,
    "record_lifetime_err",
    // late.rs:2486 `record_lifetime_err`
    function (this: LateResolutionVisitor, id: NodeId, guar: ErrorGuaranteed): void {
      this.record_lifetime_def(id, { $: "Error", _0: guar });
    },
  ],
  [
    LateResolutionVisitor.prototype as unknown as Target,
    "record_lifetime_def",
    // late.rs:2492 `record_lifetime_def`
    function (this: LateResolutionVisitor, id: NodeId, res: LifetimeRes): void {
      if (this.r.current_owner.lifetimes_res_map.has(id)) panic(`lifetime parameter ${debug_NodeId(id, PLAIN)} resolved multiple times`);
      this.r.current_owner.lifetimes_res_map.set(id, res);
    },
  ],
];

/** `#[derive(Default)]` of `DiagMetadata` (late.rs:766). */
function default_DiagMetadata(): DiagMetadata {
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
  };
}

/** Runs `f` with the stand-ins installed (only those whose real function is still the stub). */
function with_stand_ins<R>(f: () => R): R {
  const installed: [Target, string, unknown][] = [];
  for (const [target, name, fn] of STAND_INS) {
    const cur = target[name];
    if (typeof cur !== "function" || !cur.toString().includes("unported(")) continue;
    installed.push([target, name, cur]);
    target[name] = fn;
  }
  try {
    return f();
  } finally {
    for (const [target, name, fn] of installed) target[name] = fn;
  }
}

const UNITS = join(DIR, "units.rs");

function AssocItem_ident(i: AssocItem): string | undefined {
  const k = i.kind;
  return k.$ === "Fn" || k.$ === "Type" || k.$ === "Const" ? Symbol.as_str(k._0.ident.name) : undefined;
}

/** Runs `f` with a fresh `LateResolutionVisitor` over units.rs (expanded; current owner = the crate root). */
function with_visitor<R>(f: (v: LateResolutionVisitor, tcx: TyCtxt, krate: Crate) => R): R {
  return with_stand_ins(() =>
    with_expanded(UNITS, (tcx, resolver, krate) => with_owner(resolver, CRATE_NODE_ID, (r) => f(LateResolutionVisitor.new(r), tcx, krate))),
  );
}

function item_named(krate: Crate, name: string): Item {
  return unwrap(krate.items.find((i) => ItemKind.ident(i.kind)?.name === Symbol.intern(name)));
}

const ident = (s: string): Ident => Ident.new(Symbol.intern(s), DUMMY_SP);
let next_test_id = 1_000_000;
const fresh_id = (): NodeId => next_test_id++ as NodeId;
const mk_pat = (kind: PatKind): Pat => new Pat(fresh_id(), kind, DUMMY_SP);
const bind = (name: string): Pat => mk_pat({ $: "Ident", _0: BindingMode.NONE, _1: ident(name), _2: undefined });
const local = (id: NodeId): Res => ({ $: "Local", _0: id });

/** Runs `f` and returns the text of the `Unported` it stops at (`undefined` when it runs through). */
function stops_at(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    if (e instanceof Unported) return e.what;
    throw e;
  }
  return undefined;
}
/**
 * Runs `f` and returns how many errors it emitted (`Resolver::report_error` is ported: res-diag); stopping at
 * unported code fails the check.
 */
function reports(v: LateResolutionVisitor, f: () => unknown): number {
  const before = v.r.dcx().err_count();
  expect(stops_at(f)).toBeUndefined();
  return v.r.dcx().err_count() - before;
}

/**
 * `with_visitor` for checks that make the resolver report errors: once `f` has run, the session ends with
 * "aborting due to N previous errors" (`FatalErrorMarker`), as rustc does.
 */
function with_visitor_reporting(f: (v: LateResolutionVisitor, tcx: TyCtxt, krate: Crate) => void): void {
  let done = false;
  let thrown: unknown;
  try {
    with_visitor((v, tcx, krate) => {
      f(v, tcx, krate);
      done = true;
    });
  } catch (e) {
    thrown = e;
  }
  if (!done) throw thrown;
  expect(thrown).toBeInstanceOf(FatalErrorMarker);
}

test("required_generic_args_suggestion (late.rs:5741)", () => {
  const p = (kind: GenericParam["kind"]): GenericParam => ({ kind }) as GenericParam;
  const g = (...params: GenericParam[]): Generics => ({ params, where_clause: undefined as never, span: DUMMY_SP });
  with_visitor((_v, _tcx, krate) => {
    const ty = (item_named(krate, "L").kind as { _1: Generics })._1.params[2]!.kind;
    const ty_with_default = { $: "Type", default: {} } as unknown as GenericParam["kind"];
    expect(required_generic_args_suggestion(g())).toBeUndefined();
    expect(required_generic_args_suggestion(g(p({ $: "Lifetime" }), p(ty), p({ $: "Const", ty: undefined as never, span: DUMMY_SP, default: undefined })))).toBe("<'_, _, _>");
    expect(required_generic_args_suggestion(g(p(ty_with_default)))).toBeUndefined();
    expect(required_generic_args_suggestion(g(p(ty_with_default), p({ $: "Lifetime" })))).toBe("<'_>");
  });
});

test("ItemInfoCollector (late.rs:5729..5833) on units.rs", () => {
  with_expanded(UNITS, (_tcx, resolver, krate) => {
    // The first step of `late_resolve_crate` (late.rs:5852): the collector walks the crate under the crate
    // root's owner. (The rest of `late_resolve_crate` still stops inside an owner, in late/diagnostics.)
    with_owner(resolver, CRATE_NODE_ID, (r) => visit.walk_crate(new ItemInfoCollector(r), krate));
    const def = (name: string, items = krate.items): LocalDefId => resolver.owner_def_id(unwrap(items.find((i) => ItemKind.ident(i.kind)?.name === Symbol.intern(name))).id);
    const tr = item_named(krate, "Tr");
    const tr_items = (tr.kind as { _0: { items: AssocItem[] } })._0.items;
    const assoc = (name: string): LocalDefId => resolver.owner_def_id(unwrap(tr_items.find((i) => AssocItem_ident(i) === name)).id);
    // `visit_item`: `item_generics_num_lifetimes` for items with generics.
    expect(resolver.item_generics_num_lifetimes_.get(def("L"))).toBe(2);
    expect(resolver.item_generics_num_lifetimes_.get(def("Tr"))).toBe(0);
    expect(resolver.item_generics_num_lifetimes_.get(def("f"))).toBe(0);
    expect(resolver.item_generics_num_lifetimes_.has(def("a"))).toBe(false);
    // `collect_fn_info`: fns, foreign fns and assoc fns.
    const sig = (id: LocalDefId) => resolver.delegation_fn_sigs.get(id)?.has_self;
    expect(sig(def("f"))).toBe(false);
    expect(sig(assoc("m"))).toBe(true);
    expect(sig(assoc("n"))).toBe(false);
    const ext_mod = unwrap(krate.items.find((i) => i.kind.$ === "ForeignMod"));
    const ext = unwrap((ext_mod.kind as { _0: { items: { id: NodeId }[] } })._0.items[0]);
    expect(sig(resolver.owner_def_id(ext.id))).toBe(false);
    const mod_a = (item_named(krate, "a").kind as { _2: { $: string; _0: Item[] } })._2._0;
    expect(sig(def("b", mod_a))).toBe(false);
    // `visit_assoc_item`: `required_generic_args_suggestion` of assoc types.
    expect(resolver.item_required_generic_args_suggestions.get(assoc("A"))).toBe("<'_, _>");
    expect(resolver.item_required_generic_args_suggestions.has(assoc("B"))).toBe(false);
  });
});

test("def_id_matches_path (late.rs:5864)", () => {
  with_expanded(UNITS, (tcx, resolver, krate) => {
    const mod_a = (item_named(krate, "a").kind as { _2: { _0: Item[] } })._2._0;
    const b = LocalDefId.to_def_id(resolver.owner_def_id(unwrap(mod_a.find((i) => ItemKind.ident(i.kind)?.name === Symbol.intern("b"))).id));
    expect(def_id_matches_path(tcx, b, ["a", "b"])).toBe(true);
    expect(def_id_matches_path(tcx, b, ["b"])).toBe(true);
    expect(def_id_matches_path(tcx, b, [])).toBe(true);
    // The walk stops at the crate root (no parent): extra leading steps are not checked.
    expect(def_id_matches_path(tcx, b, ["c", "a", "b"])).toBe(true);
    expect(def_id_matches_path(tcx, b, ["x", "b"])).toBe(false);
    expect(def_id_matches_path(tcx, b, ["a", "c"])).toBe(false);
  });
});

test("fresh_binding (late.rs:4497): fresh, reused across `|`, duplicate in a product", () => {
  with_visitor_reporting((v) => {
    const x = ident("x");
    const bindings: PatternBindings = [["Product", new KeyedMap(Ident_key)]];
    const id1 = fresh_id();
    expect(v.fresh_binding(x, id1, "Let", bindings)).toEqual(local(id1));
    // In an or-pattern context the first binding is reused.
    const or_bindings: PatternBindings = [
      ["Or", new KeyedMap<Ident, Res>(Ident_key, [[x, local(id1)]])],
      ["Product", new KeyedMap(Ident_key)],
    ];
    expect(v.fresh_binding(x, fresh_id(), "Match", or_bindings)).toEqual(local(id1));
    expect(or_bindings[1]![1].get(x)).toEqual(local(id1));
    // Bound twice in a product: E0416 (or E0415 for fn params), through `Resolver::report_error`.
    expect(reports(v, () => v.fresh_binding(x, fresh_id(), "Let", bindings))).toBe(1);
    // `should_report_errs` is false after a glob error: no report, a fresh binding.
    v.r.glob_error = ErrorGuaranteed.unchecked_error_guaranteed();
    const id3 = fresh_id();
    expect(v.fresh_binding(x, id3, "FnParam", bindings)).toEqual(local(id3));
  });
});

test("compute_and_check_binding_map / compute_and_check_or_pat_binding_map (late.rs:4145, 4210)", () => {
  with_visitor_reporting((v) => {
    const plant = (p: Pat): Pat => {
      v.r.partial_res_map.set(p.id, PartialRes.new(local(p.id)));
      return p;
    };
    // `x` resolved to a local is a binding; an ident pattern resolved to something else (a unit
    // struct, a const) is not.
    const x = plant(bind("x"));
    const k = bind("K");
    v.r.partial_res_map.set(k.id, PartialRes.new({ $: "Err" }));
    const tuple = mk_pat({ $: "Tuple", _0: [x, k] });
    const r = v.compute_and_check_binding_map(tuple);
    expect(r.$).toBe("Ok");
    expect([...(r as { _0: Map<Ident, unknown> })._0.keys()].map((i) => Symbol.as_str(i.name))).toEqual(["x"]);
    // `x | x`: consistent.
    const or_ok = mk_pat({ $: "Or", _0: [plant(bind("x")), plant(bind("x"))] });
    const r2 = v.compute_and_check_binding_map(or_ok);
    expect(r2.$).toBe("Ok");
    expect((r2 as { _0: Map<Ident, unknown> })._0.size).toBe(1);
    // `x | y`: E0408 for `y` and for `x`, through `Resolver::report_error`.
    const or_missing = mk_pat({ $: "Or", _0: [plant(bind("x")), plant(bind("y"))] });
    expect(reports(v, () => v.compute_and_check_binding_map(or_missing))).toBe(2);
    // Never patterns: `!` alone and `! | !` are never patterns; `x | !` is `x`.
    expect(v.compute_and_check_binding_map(mk_pat({ $: "Never" })).$).toBe("Err");
    expect(v.compute_and_check_or_pat_binding_map([mk_pat({ $: "Never" }), mk_pat({ $: "Never" })]).$).toBe("Err");
    const r3 = v.compute_and_check_or_pat_binding_map([plant(bind("x")), mk_pat({ $: "Never" })]);
    expect(r3.$).toBe("Ok");
    // A binding inside a never pattern: E0??? `BindingInNeverPattern`, reported.
    expect(reports(v, () => v.compute_and_check_binding_map(mk_pat({ $: "Tuple", _0: [plant(bind("z")), mk_pat({ $: "Never" })] })))).toBe(1);
    // `check_consistent_bindings` only looks when there is an or- or never pattern.
    expect(stops_at(() => v.check_consistent_bindings(mk_pat({ $: "Tuple", _0: [bind("u"), bind("u")] })))).toBeUndefined();
    expect(reports(v, () => v.check_consistent_bindings(or_missing))).toBe(2);
  });
});

test("apply_pattern_bindings (late.rs:4319) and innermost_rib_bindings (late.rs:4544)", () => {
  with_visitor((v) => {
    const a = ident("a");
    const b = ident("b");
    v.ribs.index("ValueNS").push(Rib.new({ $: "Normal" }));
    const rib = v.ribs.index("ValueNS").at(-1)!;
    // Empty rib: the bindings move over.
    v.apply_pattern_bindings([["Product", new KeyedMap<Ident, Res>(Ident_key, [[a, local(1 as NodeId)]])]]);
    expect([...rib.bindings]).toEqual([[a, local(1 as NodeId)]]);
    expect(v.innermost_rib_bindings("ValueNS")).toBe(rib.bindings);
    // Non-empty rib: extended (an existing key keeps its place, takes the new value).
    v.apply_pattern_bindings([
      [
        "Product",
        new KeyedMap<Ident, Res>(Ident_key, [
          [b, local(2 as NodeId)],
          [a, local(3 as NodeId)],
        ]),
      ],
    ]);
    expect([...rib.bindings]).toEqual([
      [a, local(3 as NodeId)],
      [b, local(2 as NodeId)],
    ]);
    expect(() => v.apply_pattern_bindings([])).toThrow("tried applying nonexistent bindings from pattern");
  });
});

test("fill_delegation_inherent_fn_map (late.rs:3842)", () => {
  with_visitor((v, _tcx, krate) => {
    const self_ty = fresh_id();
    const m = ident("m");
    // Unresolved self type: nothing.
    v.fill_delegation_inherent_fn_map(self_ty, m);
    expect(v.r.delegation_inherent_fn_map.size).toBe(0);
    const l = v.r.owner_def_id(item_named(krate, "L").id);
    v.r.partial_res_map.set(self_ty, PartialRes.new({ $: "Def", _0: { $: "Struct" }, _1: LocalDefId.to_def_id(l) }));
    v.fill_delegation_inherent_fn_map(self_ty, m);
    expect(v.r.delegation_inherent_fn_map.get(l)?.get(m)).toEqual({ $: "Single", _0: v.r.current_owner.def_id });
    v.fill_delegation_inherent_fn_map(self_ty, m);
    expect(v.r.delegation_inherent_fn_map.get(l)?.get(m)).toEqual({ $: "Ambig" });
    v.fill_delegation_inherent_fn_map(self_ty, m);
    expect(v.r.delegation_inherent_fn_map.get(l)?.get(m)).toEqual({ $: "Ambig" });
  });
});

test("record_patterns_with_skipped_bindings (late.rs:4466)", () => {
  with_visitor((v, _tcx, krate) => {
    const l = LocalDefId.to_def_id(v.r.owner_def_id(item_named(krate, "L").id));
    const pat = mk_pat({ $: "Wild" });
    v.r.partial_res_map.set(pat.id, PartialRes.new({ $: "Def", _0: { $: "Struct" }, _1: l }));
    const rib = v.ribs.index("ValueNS").at(-1)!;
    v.record_patterns_with_skipped_bindings(pat, { $: "None" });
    expect(rib.patterns_with_skipped_bindings.size).toBe(0);
    v.record_patterns_with_skipped_bindings(pat, { $: "Rest", _0: DUMMY_SP });
    const guar = ErrorGuaranteed.unchecked_error_guaranteed();
    v.record_patterns_with_skipped_bindings(pat, { $: "Recovered", _0: guar });
    expect(rib.patterns_with_skipped_bindings.get(l)).toEqual([
      [DUMMY_SP, DUMMY_SP, { $: "Ok", _0: null }],
      [DUMMY_SP, undefined, { $: "Err", _0: guar }],
    ]);
  });
});

test("with_generic_param_rib (late.rs:3160)", () => {
  with_visitor_reporting((v, _tcx, krate) => {
    const l = item_named(krate, "L");
    // The generic params' `LocalDefId`s live in the struct's owner table.
    with_owner(v.r, l.id, () => check(v, l));
  });
  function check(v: LateResolutionVisitor, l: Item): void {
    const generics = (l.kind as { _1: Generics })._1;
    const [px, py, pt] = generics.params as [GenericParam, GenericParam, GenericParam];
    const ld = (p: GenericParam) => LocalDefId.to_def_id(v.r.local_def_id(p.id));
    const kind: RibKind = { $: "Item", _0: { $: "Yes", _0: generics.span }, _1: { $: "Struct" } };
    const depth = [v.ribs.index("ValueNS").length, v.ribs.index("TypeNS").length, v.lifetime_ribs.length];
    let inside = false;
    v.with_generic_param_rib(generics.params, kind, l.id, "Item", generics.span, (this_) => {
      inside = true;
      const ty_rib = this_.ribs.index("TypeNS").at(-1)!;
      expect([...ty_rib.bindings.values()]).toEqual([{ $: "Def", _0: { $: "TyParam" }, _1: ld(pt) }]);
      expect(this_.ribs.index("ValueNS").at(-1)!.bindings.size).toBe(0);
      const lt_rib = this_.lifetime_ribs.at(-1)!;
      expect(lt_rib.kind).toEqual({ $: "Generics", binder: l.id, span: generics.span, kind: "Item" });
      expect([...lt_rib.bindings.values()].map(([id]) => id)).toEqual([px.id, py.id]);
    });
    expect(inside).toBe(true);
    expect([v.ribs.index("ValueNS").length, v.ribs.index("TypeNS").length, v.lifetime_ribs.length]).toEqual(depth);
    expect(v.r.partial_res_map.get(pt.id)?.full_res()).toEqual({ $: "Def", _0: { $: "TyParam" }, _1: ld(pt) });
    expect(v.r.current_owner.lifetimes_res_map.get(px.id)).toEqual({ $: "Param", param: v.r.local_def_id(px.id), binder: l.id });
    // `RibKind::Normal` without `non_lifetime_binders`: type params are `Res::Err`.
    const t_only = [pt];
    v.r.partial_res_map.delete(pt.id);
    v.with_generic_param_rib(t_only, { $: "Normal" }, l.id, "Item", generics.span, () => {});
    expect(v.r.partial_res_map.get(pt.id)?.full_res()).toEqual({ $: "Err" });
    // Any other rib kind is a bug.
    expect(() => v.with_generic_param_rib(t_only, { $: "FnOrCoroutine" }, l.id, "Item", generics.span, () => {})).toThrow("Unexpected rib kind FnOrCoroutine");
    // A name used twice: E0403, through `Resolver::report_error`. (The same param twice has one `NodeId`, so
    // the `Res::Err` recorded for the second one then hits `record_partial_res`'s "resolved multiple times"
    // panic, as it would upstream.)
    v.r.partial_res_map.delete(pt.id);
    const before = v.r.dcx().err_count();
    expect(() => v.with_generic_param_rib([pt, pt], kind, l.id, "Item", generics.span, () => {})).toThrow("path resolved multiple times");
    expect(v.r.dcx().err_count() - before).toBe(1);
  }
});

test("with_constant_rib / resolve_anon_const_manual (late.rs:3368, 5270)", () => {
  with_visitor((v) => {
    const top = (this_: LateResolutionVisitor) => ({
      value: this_.ribs.index("ValueNS").at(-1)!.kind,
      type: this_.ribs.index("TypeNS").at(-1)!.kind,
      label: this_.label_ribs.at(-1)!.kind,
      lifetimes: this_.lifetime_ribs.map((r) => r.kind),
    });
    const seen = (kind: Parameters<LateResolutionVisitor["resolve_anon_const_manual"]>[1], trivial: boolean) => {
      let out: ReturnType<typeof top> | undefined;
      v.resolve_anon_const_manual(trivial, kind, (this_) => {
        out = top(this_);
      });
      return out!;
    };
    const non_trivial = { $: "No", _0: "NonTrivialConstArg" } as const;
    // `[x; N + 1]`: the type rib forces `Yes` (repeat-expression HACK), `usize` required.
    expect(seen({ $: "ConstArg", _0: "Yes" as IsRepeatExpr }, false)).toEqual({
      value: { $: "ConstantItem", _0: non_trivial, _1: undefined, _2: "Usize" },
      type: { $: "ConstantItem", _0: { $: "Yes" }, _1: undefined, _2: "Usize" },
      label: { $: "ConstantItem", _0: non_trivial, _1: undefined, _2: "Usize" },
      lifetimes: [{ $: "ConcreteAnonConst", _0: "NonTrivialConstArg" }, { $: "Elided", res: { $: "Infer" }, error_in_path: false }],
    });
    // A trivial const arg may use generics; no `ConcreteAnonConst` rib.
    expect(seen({ $: "ConstArg", _0: "No" as IsRepeatExpr }, true)).toEqual({
      value: { $: "ConstantItem", _0: { $: "Yes" }, _1: undefined, _2: "No" },
      type: { $: "ConstantItem", _0: { $: "Yes" }, _1: undefined, _2: "No" },
      label: { $: "ConstantItem", _0: { $: "Yes" }, _1: undefined, _2: "No" },
      lifetimes: [{ $: "Elided", res: { $: "Infer" }, error_in_path: false }],
    });
    expect(seen({ $: "EnumDiscriminant" }, true).value).toEqual({ $: "ConstantItem", _0: { $: "No", _0: "IsEnumDiscriminant" }, _1: undefined, _2: "No" });
    expect(seen({ $: "ArrayLength" }, false).type).toEqual({ $: "ConstantItem", _0: non_trivial, _1: undefined, _2: "Usize" });
    expect(seen({ $: "InlineConst" }, false).lifetimes).toEqual([{ $: "Elided", res: { $: "Infer" }, error_in_path: false }]);
    expect(v.label_ribs.length).toBe(0);
  });
});

test("resolve_block (late.rs:5209): ribs and the anonymous module", () => {
  with_visitor((v, _tcx, krate) => {
    const f = item_named(krate, "f");
    const body = unwrap((f.kind as { _0: { body: Block | undefined } })._0.body);
    const inner = (body.stmts[0]!.kind as { _0: { kind: { _0: Block } } })._0.kind._0;
    const [nv, nt] = [v.ribs.index("ValueNS").length, v.ribs.index("TypeNS").length];
    v.resolve_block(inner);
    expect([v.ribs.index("ValueNS").length, v.ribs.index("TypeNS").length]).toEqual([nv, nt]);
    expect(v.last_block_rib?.kind).toEqual({ $: "Block", _0: undefined });
    // With an anonymous module both namespaces get a block rib and the module is entered.
    const module = v.r.graph_root;
    v.r.block_map.set(inner.id, module);
    v.resolve_block(inner);
    expect(v.last_block_rib?.kind).toEqual({ $: "Block", _0: module });
    expect(v.ribs.index("TypeNS").length).toBe(nt);
  });
});

test("resolve_qpath (late.rs:5028): `<T>::B` leaves the segments to type-check", () => {
  with_visitor((v) => {
    const path = [Segment.from_ident(ident("B"))];
    const qself = { ty: undefined as never, path_span: DUMMY_SP, position: 0 };
    const r = v.resolve_qpath(qself, path, "ValueNS", Finalize.new(fresh_id(), DUMMY_SP), { $: "Expr", _0: undefined });
    expect(r.$).toBe("Ok");
    const pr = (r as { _0: PartialRes })._0;
    expect(pr.base_res()).toEqual({ $: "Def", _0: { $: "Mod" }, _1: LocalDefId.to_def_id(CRATE_DEF_ID) });
    expect(pr.unresolved_segments()).toBe(1);
  });
});

test("small helpers: should_report_errs, self type / item, self ribs, doc links off, define_opaques / eii", () => {
  with_visitor((v, _tcx, krate) => {
    expect(v.should_report_errs()).toBe(true);
    const l = item_named(krate, "L");
    const ty = { id: fresh_id() } as never;
    expect(v.with_current_self_type(ty, (this_) => this_.diag_metadata.current_self_type)).toBe(ty);
    expect(v.diag_metadata.current_self_type).toBeUndefined();
    expect(v.with_current_self_item(l, (this_) => this_.diag_metadata.current_self_item)).toBe(l.id);
    expect(v.diag_metadata.current_self_item).toBeUndefined();
    const n = v.ribs.index("ValueNS").length;
    const self_res: Res = { $: "SelfCtor", _0: LocalDefId.to_def_id(v.r.owner_def_id(l.id)) };
    v.with_self_rib_ns("ValueNS", self_res, (this_) => {
      const rib = this_.ribs.index("ValueNS").at(-1)!;
      expect(rib.kind).toEqual({ $: "Normal" });
      expect([...rib.bindings].map(([i, r]) => [Symbol.as_str(i.name), r])).toEqual([["Self", self_res]]);
    });
    expect(v.ribs.index("ValueNS").length).toBe(n);
    // rustc's default `ResolveDocLinks::ExportedMetadata` with a crate type without metadata (`bin`):
    // returns before looking at the attributes.
    expect(v.r.tcx_.sess.opts.resolve_doc_links).toBe("ExportedMetadata");
    v.resolve_doc_links(l.attrs, { $: "Ok", _0: l.id });
    expect(v.is_invalid_proc_macro_item_for_doc(LocalDefId.to_def_id(v.r.owner_def_id(l.id)))).toBe(false);
    v.resolve_define_opaques(undefined);
    v.resolve_eii(undefined);
    // A glob error silences late resolution errors.
    v.r.glob_error = ErrorGuaranteed.unchecked_error_guaranteed();
    expect(v.should_report_errs()).toBe(false);
    v.report_error(DUMMY_SP, { $: "LowercaseSelf" });
  });
});

test("lint_unused_qualifications (late.rs:5663): early outs", () => {
  with_visitor((v) => {
    const fin = Finalize.new(fresh_id(), DUMMY_SP);
    // Global paths and single segments never look anything up.
    v.lint_unused_qualifications([Segment.from_ident(Ident.new(kw.PathRoot, DUMMY_SP)), Segment.from_ident(ident("a"))], "TypeNS", fin);
    v.lint_unused_qualifications([Segment.from_ident(ident("a"))], "TypeNS", fin);
    expect(v.r.potentially_unnecessary_qualifications.length).toBe(0);
  });
});
