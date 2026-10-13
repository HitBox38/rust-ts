// Unit tests of the minimal query engine (docs/plan-m2.md D3): rustc_middle/src/query/* +
// rustc_query_impl, driven through a real `GlobalCtxt` / `TyCtxt` with test providers.
//
// The cycle test reproduces, through the real `type_of` / `check_well_formed` query declarations (their
// generated `desc` closures, the `type_of` cycle → `create_cycle_error` → `Cycle` diagnostic path, and
// the fed `def_kind` / `def_span` queries), the exact stderr of the pinned nightly rustc on
//   cycle.rs = "type A = B;\ntype B = A;\n\nfn main() {}\n"
//   rustc +nightly --edition 2021 -Zui-testing cycle.rs           (rustc 1.101.0-nightly (6f5da406b 2026-10-10))
// quoted in CYCLE_ORACLE below. The providers play the parts of rustc_hir_analysis (`check_well_formed(A)`
// asks for `type_of(A)`, whose alias body `B` asks for `type_of(B)` at the span of `B`, and so on).
// `TyCtxt::def_path_str` (ty::print, not ported yet) is stubbed with the items' names for this test only.
import { expect, test } from "bun:test";
import "../../rustc_query_impl/lib.ts";
import { provide as query_impl_provide, print_query_stack } from "../../rustc_query_impl/lib.ts";
import { Steal } from "../../rustc_data_structures/steal.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { DiagCtxt, DiagCtxtFlags_default } from "../../rustc_errors/lib.ts";
import { DefKind } from "../../rustc_hir/def.ts";
import { Definitions, PerParentDisambiguatorState } from "../../rustc_hir_id/definitions.ts";
import { Untracked } from "../../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../../rustc_crate_store/cstore.ts";
import type { Session } from "../../rustc_session/session.ts";
import { ParseSess } from "../../rustc_session/parse.ts";
import { CRATE_DEF_ID, CrateNum, DefId, DefIndex, LOCAL_CRATE, LocalDefId, StableCrateId } from "../../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { BytePos, DUMMY_SP, type FileName, Span, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { FilePathMapping, SourceMap } from "../../rustc_span/source_map.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Limit } from "../../rustc_structures/lib.ts";
import { Panic, unported } from "../../std/panic.ts";
import { Str } from "../../std/str.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { VecU8, dyn_write } from "../../vendor/anstream/stream.ts";
import { DepGraph } from "../dep_graph/graph.ts";
import { Providers_default as HookProviders_default } from "../hooks.ts";
import type { ExternProviders, Providers } from "../queries.gen.ts";
import { CurrentGcx, type Limits, TyCtxt } from "../ty/context.ts";
import { query_system } from "../../rustc_query_impl/lib.ts";
import { ExternProviders_default, Providers_default } from "./query_api.ts";
import { with_context } from "../ty/context/tls.ts";

const test_ = (name: string, f: () => void): void => {
  test(name, () => create_default_session_globals_then(f));
};

const NO_CSTORE = {
  debug: () => "CStore",
  def_key: () => unported("test cstore"),
  def_path: () => unported("test cstore"),
  def_path_hash: () => unported("test cstore"),
  crate_name: () => unported("test cstore"),
  stable_crate_id: () => unported("test cstore"),
  as_any: () => undefined,
  untracked_as_any: () => undefined,
} as unknown as CrateStore;

/** A `GlobalCtxt` over a one-file source map, an emitter writing into `out()`, and test providers. */
function with_tcx<R>(src: string, set_providers: (p: Providers, e: ExternProviders) => void, f: (tcx: TyCtxt, sp: (needle: string, nth?: number) => Span) => R): { r: R | undefined; out: () => string; err: unknown; print_error_count: () => void } {
  const sm = SourceMap.new(FilePathMapping.empty());
  const name: FileName = { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "cycle.rs") };
  const sf = sm.new_source_file(name, Str.from(src));
  const buf = new VecU8();
  let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
  em = AnnotateSnippetEmitter.sm(em, sm);
  em = AnnotateSnippetEmitter.ui_testing(em, true);
  const psess = ParseSess.with_dcx(DiagCtxt.new(em).with_flags({ ...DiagCtxtFlags_default(), can_emit_warnings: true }), sm);
  // PORT (test): the surface of `Session` the engine reads.
  const sess = {
    dcx: () => psess.dcx(),
    verbose_internals: () => false,
    opts: { jobs: { frontend: undefined }, unstable_opts: { incremental_verify_ich: false, incremental_ignore_spans: false }, incremental: undefined, actually_rustdoc: false },
    prof: { profiler: undefined },
    psess,
    source_map: () => sm,
  } as unknown as Session;
  const sp = (needle: string, nth = 0): Span => {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`no ${needle}`);
    return Span.with_root_ctxt(BytePos(sf.start_pos + at), BytePos(sf.start_pos + at + needle.length));
  };
  const stable_crate_id = StableCrateId.new(Symbol.intern("cycle"), true, [], "1.101.0-nightly");
  const untracked = new Untracked(NO_CSTORE, [], Definitions.new(stable_crate_id), new Map(), undefined);
  const providers = Providers_default();
  const extern = ExternProviders_default();
  set_providers(providers, extern);
  const hooks = HookProviders_default();
  query_impl_provide({ queries: providers, extern_queries: extern, hooks });
  hooks.save_dep_graph = () => null;
  let r: R | undefined;
  let err: unknown;
  try {
    r = TyCtxt.create_global_ctxt(
      { value: undefined },
      sess,
      ["Executable"],
      stable_crate_id,
      untracked,
      undefined,
      DepGraph.new_disabled(),
      query_system(providers, extern, undefined, false, false),
      hooks,
      CurrentGcx.new(),
      (tcx) => f(tcx, sp),
    );
  } catch (e) {
    err = e;
  }
  return { r, out: () => new TextDecoder().decode(buf.bytes()), err, print_error_count: () => psess.dcx().print_error_count() };
}

const LIMITS: Limits = { recursion_limit: new Limit(128), move_size_limit: new Limit(0), type_length_limit: new Limit(1048576), pattern_complexity_limit: new Limit(0) };

test_("memoization: a provider runs once per key; DefId keys accept LocalDefId (IntoQueryKey)", () => {
  let limits_calls = 0;
  const kinds: string[] = [];
  const { r, err } = with_tcx(
    "",
    (p, e) => {
      p.limits = () => {
        limits_calls++;
        return LIMITS;
      };
      p.def_kind = (_tcx, id: LocalDefId) => {
        kinds.push(`local ${LocalDefId.index(id)}`);
        return DefKind.Mod;
      };
      e.def_kind = (_tcx, id: DefId) => {
        kinds.push(`extern ${id.krate}:${id.index}`);
        return DefKind.Struct;
      };
    },
    (tcx) => {
      const a = tcx.limits(null);
      const b = tcx.limits(null);
      const local = LocalDefId.new(3);
      const k1 = tcx.def_kind(local);
      const k2 = tcx.def_kind(LocalDefId.to_def_id(local));
      const k3 = tcx.def_kind(new DefId(DefIndex.from_u32(7), CrateNum.new(1)));
      const k4 = tcx.def_kind(new DefId(DefIndex.from_u32(7), CrateNum.new(1)));
      return { same: a === b, kinds: [k1.$, k2.$, k3.$, k4.$], recursion: tcx.recursion_limit()._0 };
    },
  );
  expect(err).toBeUndefined();
  expect(limits_calls).toBe(1);
  expect(r!.same).toBe(true);
  expect(r!.kinds).toEqual(["Mod", "Mod", "Struct", "Struct"]);
  expect(kinds).toEqual(["local 3", "extern 1:7"]);
  expect(r!.recursion).toBe(128);
});

test_("ensure_ok runs the provider once; ensure_done and later calls hit the cache", () => {
  let calls = 0;
  const { err } = with_tcx(
    "",
    (p) => {
      p.early_lint_checks = () => {
        calls++;
        return null;
      };
    },
    (tcx) => {
      tcx.ensure_ok().early_lint_checks(null);
      tcx.ensure_ok().early_lint_checks(null);
      tcx.ensure_done().early_lint_checks(null);
      expect(tcx.early_lint_checks(null)).toBeNull();
    },
  );
  expect(err).toBeUndefined();
  expect(calls).toBe(1);
});

test_("a query without a provider is upstream's `default_query` ICE", () => {
  const { err } = with_tcx("", () => {}, (tcx) => tcx.def_kind(LocalDefId.new(1)));
  expect(err).toBeInstanceOf(Panic);
  expect((err as Panic).message).toBe(
    // `{:?}` of the key through `DEF_ID_DEBUG`'s default (rustc_interface's callbacks are not installed here)
    "`tcx.def_kind(DefId { krate: crate0, index: DefIndex(1) })` is not supported for this key;\n" +
      "hint: Queries can be either made to the local crate, or the external crate. This error means you tried to use it for one that's not supported.\n" +
      "If that's not the case, def_kind was likely never assigned to a provider function.\n",
  );
});

test_("feed: create_def / create_crate_num / feed_unit_query fill the caches without providers", () => {
  const { r, err } = with_tcx(
    "type A = B;\n",
    () => {},
    (tcx, sp) => {
      const root = tcx.create_local_crate_def_id(sp("type A = B;"));
      root.def_kind(DefKind.Mod);
      const crate = tcx.create_crate_num(tcx.stable_crate_id(LOCAL_CRATE));
      if (crate.$ !== "Ok") throw new Error("create_crate_num");
      crate._0.crate_name(Symbol.intern("cycle"));
      const again = tcx.create_crate_num(tcx.stable_crate_id(LOCAL_CRATE));
      const feed = tcx.at(sp("A")).create_def(CRATE_DEF_ID, Symbol.intern("A"), DefKind.TyAlias, undefined, PerParentDisambiguatorState.new(CRATE_DEF_ID));
      const krate = { id: 0, attrs: [], items: [], spans: { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP }, is_placeholder: false };
      const steal = Steal.new([krate, []], "(rustc_ast::Crate, rustc_ast::AttrVec)");
      tcx.feed_unit_query().crate_for_resolver(steal as never);
      // feeding a `no_hash` query twice is upstream's `bug!`
      let refeed: unknown;
      try {
        tcx.feed_unit_query().crate_for_resolver(steal as never);
      } catch (e) {
        refeed = e;
      }
      return {
        crate: crate._0.key(),
        again: again.$ === "Err" ? again._0 : undefined,
        def_id: LocalDefId.index(feed.def_id()),
        kind: tcx.def_kind(feed.def_id()).$,
        span_is_a: tcx.def_span(feed.def_id()) === sp("A"),
        name: Symbol.as_str(tcx.crate_name(LOCAL_CRATE)),
        item_name: Symbol.as_str(tcx.item_name(feed.def_id())),
        parent: LocalDefId.index(tcx.local_parent(feed.def_id())),
        parent_mod: tcx.parent_module_from_def_id(feed.def_id()),
        stolen: (tcx.crate_for_resolver(null) as unknown) === steal,
        refeed,
      };
    },
  );
  expect(err).toBeUndefined();
  expect(r!.crate).toBe(LOCAL_CRATE);
  expect(r!.again).toBe(LOCAL_CRATE);
  expect(r!.def_id).toBe(1);
  expect(r!.kind).toBe("TyAlias");
  expect(r!.span_is_a).toBe(true);
  expect(r!.name).toBe("cycle");
  expect(r!.item_name).toBe("A");
  expect(r!.parent).toBe(0);
  expect(r!.parent_mod as number).toBe(0);
  expect(r!.stolen).toBe(true);
  expect(r!.refeed).toBeInstanceOf(Panic);
  expect((r!.refeed as Panic).message).toStartWith("Trying to feed an already recorded value for query crate_for_resolver key=():\nold value: ");
});

test_("feed: re-feeding a hashed query compares stable hashes (equal: no-op; different: delayed bug, old value kept)", () => {
  const { r, err } = with_tcx(
    "struct S;\n",
    () => {},
    (tcx, sp) => {
      const root = tcx.create_local_crate_def_id(sp("struct S;"));
      root.def_kind(DefKind.Mod);
      const feed = tcx.at(sp("S")).create_def(CRATE_DEF_ID, Symbol.intern("S"), DefKind.Struct, undefined, PerParentDisambiguatorState.new(CRATE_DEF_ID));
      const root_mod = CrateNum.as_mod_id(LOCAL_CRATE);
      // build_reduced_graph feeds a struct's visibility twice with the same value
      feed.visibility({ $: "Restricted", _0: root_mod });
      feed.visibility({ $: "Restricted", _0: root_mod });
      const same = tcx.dcx().has_errors_or_delayed_bugs();
      // a different value (different stable hash) delays a bug and keeps the old value
      feed.visibility({ $: "Public" });
      const different = tcx.dcx().has_errors_or_delayed_bugs();
      return { same, different, kept: tcx.visibility(feed.def_id()).$, errors: tcx.dcx().has_errors() };
    },
  );
  expect(err).toBeUndefined();
  expect(r!.same).toBeUndefined();
  expect(r!.different).toBeDefined();
  expect(r!.kept).toBe("Restricted");
  expect(r!.errors).toBeUndefined();
});

test_("Steal: borrow, steal once, then reads panic with upstream's messages", () => {
  const s = Steal.new([1, 2, 3], "alloc::vec::Vec<u32>");
  expect(s.borrow()).toEqual([1, 2, 3]);
  expect(s.is_stolen()).toBe(false);
  expect(s.steal()).toEqual([1, 2, 3]);
  expect(s.is_stolen()).toBe(true);
  expect(() => s.borrow()).toThrow("attempted to read from stolen value: alloc::vec::Vec<u32>");
  expect(() => s.steal()).toThrow("attempt to steal from stolen value");
});

// `rustc +nightly --edition 2021 -Zui-testing cycle.rs` (stderr, exit 1)
const CYCLE_SRC = "type A = B;\ntype B = A;\n\nfn main() {}\n";
const CYCLE_ORACLE =
  "error[E0391]: cycle detected when expanding type alias `A`\n" +
  "  --> cycle.rs:1:10\n" +
  "   |\n" +
  "LL | type A = B;\n" +
  "   |          ^\n" +
  "   |\n" +
  "note: ...which requires expanding type alias `B`...\n" +
  "  --> cycle.rs:2:10\n" +
  "   |\n" +
  "LL | type B = A;\n" +
  "   |          ^\n" +
  "   = note: ...which again requires expanding type alias `A`, completing the cycle\n" +
  "   = note: type aliases cannot be recursive\n" +
  "   = help: consider using a struct, enum, or union instead to break the cycle\n" +
  "   = help: see <https://doc.rust-lang.org/reference/types.html#recursive-types> for more information\n" +
  "note: cycle used when checking that `A` is well-formed\n" +
  "  --> cycle.rs:1:1\n" +
  "   |\n" +
  "LL | type A = B;\n" +
  "   | ^^^^^^\n" +
  "   = note: for more information, see <https://rustc-dev-guide.rust-lang.org/overview.html#queries> and <https://rustc-dev-guide.rust-lang.org/query.html>\n" +
  "\n" +
  "error: aborting due to 1 previous error\n" +
  "\n" +
  "For more information about this error, try `rustc --explain E0391`.\n";

test_("cycle detection: `type A = B; type B = A;` gives rustc's exact E0391 report", () => {
  const names = new Map<number, string>();
  const saved = TyCtxt.prototype.def_path_str;
  // Test-only stand-in for ty::print's `def_path_str` (see the module comment).
  TyCtxt.prototype.def_path_str = function (this: TyCtxt, def_id: unknown): string {
    const id = def_id instanceof DefId ? def_id.index : (def_id as number);
    return names.get(id)!;
  };
  let type_of_calls = 0;
  let stack: string[] = [];
  try {
    const { out, err, print_error_count } = with_tcx(
      CYCLE_SRC,
      (p) => {
        p.type_of = (tcx, def_id: LocalDefId) => {
          type_of_calls++;
          // `type A = B;` lowers `B` (at the span of `B`), `type B = A;` lowers `A`.
          if (names.get(def_id) === "A") {
            const lines: string[] = [];
            print_query_stack(tcx, with_context((icx) => icx.query), 0, (l) => lines.push(l));
            stack = lines;
            return tcx.at(sp_of("B", 0)).type_of(def_of("B"));
          }
          return tcx.at(sp_of("A", 1)).type_of(def_of("A"));
        };
        p.check_well_formed = (tcx, def_id) => {
          tcx.type_of(def_id);
          return { $: "Ok", _0: null };
        };
      },
      (tcx, sp) => {
        sp_of = (n, i) => sp(n, i);
        const root = tcx.create_local_crate_def_id(sp(CYCLE_SRC));
        root.def_kind(DefKind.Mod);
        const dis = PerParentDisambiguatorState.new(CRATE_DEF_ID);
        for (const [n, item] of [["A", "type A"], ["B", "type B"]] as const) {
          const feed = tcx.at(sp(item)).create_def(CRATE_DEF_ID, Symbol.intern(n), DefKind.TyAlias, undefined, dis);
          names.set(feed.def_id(), n);
          defs.set(n, feed.def_id());
        }
        tcx.check_well_formed(def_of("A"));
      },
    );
    expect(err).toBeInstanceOf(FatalErrorMarker);
    expect(type_of_calls).toBe(2);
    // the driver prints the error count after the fatal error unwinds (rustc_driver_impl)
    print_error_count();
    expect(out()).toBe(CYCLE_ORACLE);
  } finally {
    TyCtxt.prototype.def_path_str = saved;
  }
  expect(stack).toEqual([
    "\n\nquery stack during panic:",
    "#0 [type_of] expanding type alias `A`",
    "#1 [check_well_formed] checking that `A` is well-formed",
    "end of query stack",
  ]);
});

// Lazily bound helpers of the cycle test (spans and def ids exist only inside the `GlobalCtxt`).
const defs = new Map<string, LocalDefId>();
const def_of = (n: string): LocalDefId => defs.get(n)!;
let sp_of: (n: string, i: number) => Span = () => DUMMY_SP;
