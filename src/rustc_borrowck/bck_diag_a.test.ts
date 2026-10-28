// Lane bck-diag-a (wave 25): diagnostics/conflict_errors.rs lines < 2469 (`report_use_of_moved_or_uninitialized`,
// `report_conflicting_borrow`, `report_move_out_while_borrowed`, `report_use_while_mutably_borrowed` and their helpers)
// on real built MIR and HIR.
//
// The runtime path of `mir_borrowck` stops before these fns (in type_check / other lanes' stubs), so this test drives
// them directly, as bck_lib_b.test.ts does: a no_core crate is compiled up to MIR building, `MoveData` is built for each
// body, and the fns run on a `MirBorrowckCtxt` whose other lanes' methods (`retrieve_borrow_spans`, the `cannot_*`
// builders, `describe_*`, `move_spans`, `buffer_*`, ...) are recorders on the instance. The companions of `UseSpans` /
// `BorrowExplanation` (bck-diag-d / -f, still stubs) are replaced for the duration of a case and restored after.
// `Diag`s are recording proxies. The expected values are worked out by hand from upstream.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import { type Body, BorrowKind as _BorrowKind, Local, Location, type Place, Place_from_Local } from "../rustc_middle/mir/mod.ts";
import type { BorrowKind } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import "../rustc_mir_build/lib.ts";
import { MoveData, type MoveOutIndex } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { BorrowckInferCtxt, MirBorrowckCtxt } from "./lib.gen.ts";
import type { BorrowData } from "./borrow_set.gen.ts";
import { UseSpans } from "./diagnostics/mod.ts";
import { BorrowExplanation } from "./diagnostics/explain_borrow.ts";
import type { UseSpans as UseSpansT } from "./diagnostics/mod.gen.ts";

void _BorrowKind;

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "impl Copy for usize {}",
  "impl Copy for bool {}",
  '#[lang = "legacy_receiver"] pub trait LegacyReceiver {}',
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "impl<T: ?Sized> LegacyReceiver for &mut T {}",
  '#[lang = "clone"] pub trait Clone { fn clone(&self) -> Self; }',
  "impl Clone for u8 { fn clone(&self) -> u8 { *self } }",
  '#[lang = "index"] pub trait Index<Idx: ?Sized> { type Output: ?Sized; fn index(&self, index: Idx) -> &Self::Output; }',
  '#[lang = "index_mut"] pub trait IndexMut<Idx: ?Sized>: Index<Idx> { fn index_mut(&mut self, index: Idx) -> &mut Self::Output; }',
  "impl<T, const N: usize> Index<usize> for [T; N] { type Output = T; fn index(&self, i: usize) -> &T { &self[i] } }",
  "impl<T, const N: usize> IndexMut<usize> for [T; N] { fn index_mut(&mut self, i: usize) -> &mut T { &mut self[i] } }",
  "pub struct S { pub x: u8, pub y: u8 }",
  // the only init of `x` (`x = 1`, then-block) reaches the use after the `if`
  "pub fn cond(b: bool) -> u8 { let x: u8; if b { x = 1; } x }",
  // the init returns: it does not reach the use after the `if`
  "pub fn two(b: bool) -> u8 { let x: u8; if b { x = 1; return x; } x }",
  // `_2 = move _1`
  "pub fn mv(s: S) -> S { let t = s; t }",
  // two `&mut (*_1)[_k]` borrows
  "pub fn sl(mut v: [u8; 4], i: usize, j: usize) { let a = &mut v[i]; let b = &mut v[j]; *a = *b; }",
  "pub fn sl_same(mut v: [u8; 4], i: usize) { let a = &mut v[i]; let b = &mut v[i]; *a = *b; }",
  "pub fn cl(x: u8, r: &u8) -> u8 { let a = x.clone(); let b = &x; let c = *r; a }",
].join("\n");

const WORK = join(DATA, "tmp", "bck-diag-a-test", process.env.RUST_TS_AGENT ?? "default");

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
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** Collects every HIR expression of a body. */
class AllExprs extends hir.intravisit.Visitor {
  exprs: hir.Expr[] = [];
  override visit_expr(e: hir.Expr): undefined {
    this.exprs.push(e);
    hir.intravisit.walk_expr(this, e);
    return undefined;
  }
}

/** Replaces `obj[name]` by `f` while `body` runs. */
function patched<T>(obj: object, fns: Record<string, unknown>, body: () => T): T {
  const o = obj as Record<string, unknown>;
  const saved = Object.fromEntries(Object.keys(fns).map((k) => [k, o[k]]));
  Object.assign(o, fns);
  try {
    return body();
  } finally {
    Object.assign(o, saved);
  }
}

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "bck_diag_a.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    const bodies = new Map<string, [LocalDefId, Body]>();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      bodies.set(name, [def, tcx.build_mir_inner_impl(def) as Body]);
    });
    const sm = tcx.sess.source_map();
    /** A span as its source snippet. */
    const S = (sp: Span): string => {
      const r = sm.span_to_snippet(sp);
      return r.$ === "Ok" ? `\`${r._0}\`` : "<no snippet>";
    };
    const fmt = (v: unknown): string => {
      if (typeof v === "number") return S(v as Span);
      if (typeof v === "string") return JSON.stringify(v);
      if (v === undefined) return "None";
      if (v instanceof MultiSpan) {
        return `MultiSpan([${v.primary_spans_().map(S).join(", ")}]; ${v
          .span_labels_raw()
          .map(([sp, m]) => `${S(sp)}: ${JSON.stringify(m._0)}`)
          .join("; ")})`;
      }
      if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
      if (typeof v === "object" && v !== null && "$" in v) return (v as { $: string }).$;
      return String(v);
    };
    /** A recording `Diag`: every method call is logged as `name(args)` and returns the proxy. */
    const fake_diag = (log: string[], name: string) => {
      const proxy: object = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return undefined;
            return (...args: unknown[]) => {
              if (prop === "subdiagnostic") {
                log.push(`${name}.subdiagnostic`);
              } else if (prop === "long_ty_path") {
                return { value: undefined };
              } else {
                log.push(`${name}.${String(prop)}(${args.map(fmt).join(", ")})`);
              }
              return proxy;
            };
          },
        },
      );
      return proxy as never;
    };

    /** A `MirBorrowckCtxt` over `name`'s built MIR. */
    const mk = (name: string) => {
      const [def, body] = bodies.get(name)!;
      const move_data = MoveData.gather_moves(body, tcx, () => true);
      const log: string[] = [];
      const mbcx = new MirBorrowckCtxt(
        undefined as never,
        BorrowckInferCtxt.new(tcx, def, def),
        body,
        move_data,
        undefined as never,
        false,
        new Set(),
        new Set(),
        new Set(),
        new Set<Local>(),
        new Set<Local>(),
        [],
        undefined as never,
        undefined as never,
        [],
        undefined,
        new Map(),
        1,
        undefined as never,
        [],
        undefined,
        undefined,
      );
      Object.assign(mbcx, {
        mir_def_id: () => def,
        mir_hir_id: () => tcx.local_def_id_to_hir_id(def),
      });
      return { mbcx, log, body, move_data, def };
    };
    const exprs_of = (def: LocalDefId): hir.Expr[] => {
      const v = new AllExprs();
      v.visit_body(tcx.hir_body_owned_by(def));
      return v.exprs;
    };
    const expr_by_snippet = (def: LocalDefId, snippet: string, nth = 0): hir.Expr => {
      const found = exprs_of(def).filter((e) => S(e.span) === `\`${snippet}\``);
      if (found[nth] === undefined) throw new Error(`ERROR: no expr \`${snippet}\``);
      return found[nth]!;
    };

    // is_init_reachable
    {
      const out: string[] = [];
      for (const name of ["cond", "two"]) {
        const { mbcx, move_data, body } = mk(name);
        // the uses of `x` (`_2`): `_0 = copy _2`
        const uses: Location[] = [];
        body.basic_blocks.deref().forEach((bb, b) =>
          bb.statements.forEach((st, i) => {
            if (st.kind.$ === "Assign" && st.kind._0[1].$ === "Use" && st.kind._0[1]._0.$ === "Copy" && st.kind._0[1]._0._0.local === Local.new(2)) {
              uses.push(new Location(b as never, i));
            }
          }),
        );
        for (const init of move_data.inits) {
          const p = move_data.move_paths[init.path]!.place;
          // only the inits of `b` (`_1`) and `x` (`_2`)
          if (p.local !== Local.new(1) && p.local !== Local.new(2)) continue;
          for (const u of uses) {
            const where_ = init.location.$ === "Argument" ? "arg" : init.location._0.block === u.block ? "same block" : "other block";
            out.push(`${name} init _${p.local} (${where_}) -> use: ${mbcx.is_init_reachable(init, u)}`);
          }
        }
      }
      R.set("is_init_reachable", out);
    }

    // report_conflicting_borrow (dispatch on the two borrow kinds)
    {
      const out: string[] = [];
      const shared: BorrowKind = { $: "Shared" };
      const deep: BorrowKind = { $: "Fake", _0: "Deep" };
      const shallow: BorrowKind = { $: "Fake", _0: "Shallow" };
      const mut_: BorrowKind = { $: "Mut", kind: "Default" };
      const two_phase: BorrowKind = { $: "Mut", kind: "TwoPhaseBorrow" };
      const cc: BorrowKind = { $: "Mut", kind: "ClosureCapture" };
      const case_ = (label: string, gen: BorrowKind, issued: BorrowKind, opts: { same_spans?: boolean; immutable_section?: string; union?: string } = {}) => {
        const { mbcx, log, body, def } = mk("mv");
        const issued_span = expr_by_snippet(def, "s").span;
        const new_span = opts.same_spans ? issued_span : expr_by_snippet(def, "t").span;
        const builder =
          (n: string) =>
          (...args: unknown[]) => {
            log.push(`${n}(${args.map(fmt).join(", ")})`);
            return fake_diag(log, "err");
          };
        const recorder =
          (n: string) =>
          (...args: unknown[]) => {
            log.push(`${n}(${args.filter((a) => typeof a !== "object" || a === null || "$" in (a as object)).map(fmt).join(", ")})`);
          };
        Object.assign(mbcx, {
          retrieve_borrow_spans: () => ({ $: "OtherUse", _0: issued_span }),
          borrow_spans: (_sp: Span, _l: Location) => ({ $: "OtherUse", _0: new_span }),
          describe_place_for_conflicting_borrow: () => ["`d`", "`mp`", "`mb`", opts.union ?? ""],
          explain_why_borrow_contains_point: () => BorrowExplanation.Unexplained,
          classify_immutable_section: () => opts.immutable_section,
          describe_any_place: () => "`any`",
          note_due_to_edition_2024_opaque_capture_rules: () => log.push("note_due_to_edition_2024_opaque_capture_rules"),
          cannot_reborrow_already_borrowed: builder("cannot_reborrow_already_borrowed"),
          cannot_mutably_borrow_multiply: builder("cannot_mutably_borrow_multiply"),
          cannot_uniquely_borrow_by_two_closures: builder("cannot_uniquely_borrow_by_two_closures"),
          cannot_uniquely_borrow_by_one_closure: builder("cannot_uniquely_borrow_by_one_closure"),
          cannot_reborrow_already_uniquely_borrowed: builder("cannot_reborrow_already_uniquely_borrowed"),
          cannot_mutate_in_immutable_section: builder("cannot_mutate_in_immutable_section"),
          suggest_binding_for_closure_capture_self: recorder("suggest_binding_for_closure_capture_self"),
          suggest_using_closure_argument_instead_of_capture: recorder("suggest_using_closure_argument_instead_of_capture"),
          explain_iterator_invalidation_in_for_loop_if_applicable: recorder("explain_iterator_invalidation_in_for_loop_if_applicable"),
          explain_iterator_advancement_in_for_loop_if_applicable: recorder("explain_iterator_advancement_in_for_loop_if_applicable"),
        });
        const p1: Place = Place_from_Local(Local.new(1));
        const issued_borrow = {
          kind: issued,
          borrowed_place: p1,
          assigned_place: Place_from_Local(Local.new(2)),
          reserve_location: new Location(0 as never, 0),
          activation_location: { $: "NotTwoPhase" },
          region: 0,
        } as unknown as BorrowData;
        try {
          patched(
            UseSpans,
            {
              args_or_use: (s: UseSpansT) => (s as { _0: Span })._0,
              for_coroutine: () => false,
              var_subdiag: (s: UseSpansT, _err: unknown, kind: BorrowKind | undefined, f: (k: hir.ClosureKind, sp: Span) => { $: string }) =>
                log.push(`var_subdiag(${fmt((s as { _0: Span })._0)}, ${kind?.$ ?? "None"}) -> ${f({ $: "Closure" }, (s as { _0: Span })._0).$}`),
            },
            () =>
              patched(
                BorrowExplanation,
                {
                  is_explained: () => false,
                  add_explanation_to_diagnostic: (_e: unknown, _cx: unknown, _err: unknown, desc: string, bs: Span | undefined, multi: [Span, Span] | undefined) =>
                    log.push(`add_explanation_to_diagnostic(${fmt(desc)}, ${fmt(bs)}, ${fmt(multi)})`),
                },
                () => mbcx.report_conflicting_borrow(new Location(0 as never, 1), [p1, new_span], gen, issued_borrow),
              ),
          );
          out.push(`${label}: ${log.join(" | ")}`);
          void body;
        } catch (e) {
          if (e instanceof Unported) out.push(`${label}: UNPORTED ${e.what} after ${log.join(" | ")}`);
          else out.push(`${label}: PANIC ${(e as Error).message}`);
        }
      };
      case_("shared/mut", shared, mut_);
      case_("deep/two-phase", deep, two_phase);
      case_("mut/shared", mut_, shared);
      case_("mut/mut", mut_, two_phase);
      case_("cc/cc", cc, cc);
      case_("mut/shallow section", mut_, shallow, { immutable_section: "match guard" });
      case_("mut/shallow", two_phase, shallow);
      case_("cc/shared", cc, shared);
      case_("shared/cc", shared, cc);
      case_("mut/cc", mut_, cc);
      case_("same spans + union", mut_, mut_, { same_spans: true, union: "U" });
      case_("shared/shared", shared, shared);
      R.set("report_conflicting_borrow", out);
    }

    // report_use_of_moved_or_uninitialized
    {
      const out: string[] = [];
      const go = (label: string, move_sites: { moi: MoveOutIndex; traversed_back_edge: boolean }[], reinits: number) => {
        const { mbcx, log, def, body } = mk("mv");
        const s_span = expr_by_snippet(def, "s").span;
        const t_span = expr_by_snippet(def, "t", 0).span;
        Object.assign(mbcx, {
          move_spans: (_p: unknown, l: Location) => ({ $: "OtherUse", _0: l.statement_index === 99 ? t_span : s_span }),
          borrow_spans: () => ({ $: "OtherUse", _0: t_span }),
          get_moved_indexes: () => [move_sites, Array.from({ length: reinits }, () => new Location(0 as never, 99))],
          report_use_of_uninitialized: () => {
            log.push("report_use_of_uninitialized");
            return fake_diag(log, "uninit");
          },
          buffer_error: () => log.push("buffer_error"),
          has_move_error: () => undefined,
          describe_place_with_options: () => "s",
          cannot_act_on_moved_value: (...args: unknown[]) => {
            log.push(`cannot_act_on_moved_value(${args.map(fmt).join(", ")})`);
            return fake_diag(log, "err");
          },
          add_moved_or_invoked_closure_note: () => false,
          explain_captures: () => log.push("explain_captures"),
          implements_clone: () => false,
          suggest_adding_bounds: () => log.push("suggest_adding_bounds"),
          buffer_move_error: (mois: MoveOutIndex[]) => log.push(`buffer_move_error([${mois}])`),
        });
        try {
          patched(
            UseSpans,
            {
              args_or_use: (s: UseSpansT) => (s as { _0: Span })._0,
              or_else: (s: UseSpansT) => s,
              for_closure: () => false,
              var_path_only_subdiag: () => log.push("var_path_only_subdiag"),
            },
            () => {
              const used = Place_from_Local(Local.new(1)).as_ref();
              mbcx.report_use_of_moved_or_uninitialized(new Location(0 as never, 3), "Use", [used, used, t_span], 0 as never);
              if (move_sites.length === 0) {
                log.push("-- again --");
                mbcx.report_use_of_moved_or_uninitialized(new Location(0 as never, 3), "Use", [used, used, t_span], 0 as never);
              }
            },
          );
          out.push(`${label}: ${log.join(" | ")}`);
          void body;
        } catch (e) {
          if (e instanceof Unported) out.push(`${label}: UNPORTED ${e.what} after ${log.join(" | ")}`);
          else throw e;
        }
      };
      go("uninitialized", [], 0);
      go("moved", [{ moi: 0 as MoveOutIndex, traversed_back_edge: false }], 0);
      go("moved, 1 reinit", [{ moi: 0 as MoveOutIndex, traversed_back_edge: false }], 1);
      go("moved, 5 reinits", [{ moi: 0 as MoveOutIndex, traversed_back_edge: true }], 5);
      R.set("report_use_of_moved_or_uninitialized", out);
    }

    // suggest_slice_method_if_applicable + find_expr
    {
      const out: string[] = [];
      for (const name of ["sl", "sl_same"]) {
        const { mbcx, log, body } = mk(name);
        const refs: Place[] = [];
        for (const bb of body.basic_blocks.deref()) {
          for (const st of bb.statements) {
            if (st.kind.$ === "Assign" && st.kind._0[1].$ === "Ref") refs.push(st.kind._0[1]._2);
          }
        }
        const [a, b] = [refs[0]!, refs[1]!];
        mbcx.suggest_slice_method_if_applicable(fake_diag(log, "err"), a, b, body.span, body.span);
        out.push(`${name} [${a.projection.map((e) => e.$)}] / [${b.projection.map((e) => e.$)}]: ${log.join(" | ") || "nothing"}`);
      }
      R.set("suggest_slice_method_if_applicable", out);
    }

    // clone_on_reference / in_move_closure / suggest_cloning_inner / suggest_copy_for_type_in_cloned_ref
    {
      const out: string[] = [];
      const { mbcx, log, def, body } = mk("cl");
      const x_clone = expr_by_snippet(def, "x.clone()");
      const amp_x = expr_by_snippet(def, "&x");
      const r = expr_by_snippet(def, "r");
      const u8_ty = body.local_decls[1]!.ty;
      out.push(`clone_on_reference x.clone(): ${fmt(mbcx.clone_on_reference(x_clone))}`);
      out.push(`clone_on_reference &x: ${fmt(mbcx.clone_on_reference(amp_x))}`);
      out.push(`in_move_closure &x: ${mbcx.in_move_closure(amp_x)}`);
      out.push(`suggest_cloning_inner x.clone(): ${mbcx.suggest_cloning_inner(fake_diag(log, "err"), u8_ty, x_clone)}`);
      out.push(`suggest_cloning_inner &x: ${mbcx.suggest_cloning_inner(fake_diag(log, "err"), u8_ty, amp_x)}`);
      out.push(`suggest_cloning_inner r: ${mbcx.suggest_cloning_inner(fake_diag(log, "err"), u8_ty, r)}`);
      out.push(`log: ${log.join(" | ")}`);
      const log2: string[] = [];
      // `x.clone()` on `u8` (receiver `u8`): not a `&T` receiver, nothing to report
      mbcx.suggest_copy_for_type_in_cloned_ref(fake_diag(log2, "err"), Place_from_Local(Local.new(1)));
      out.push(`suggest_copy_for_type_in_cloned_ref: ${log2.join(" | ") || "nothing"}`);
      R.set("cloning", out);
    }
  });
});

test("is_init_reachable", () => {
  expect(R.get("is_init_reachable")).toEqual([
    // args are reachable by definition
    "cond init _1 (arg) -> use: true",
    // `x = 1` (then block) reaches the use after the `if` without dominating it (CFG walk)
    "cond init _2 (other block) -> use: true",
    "two init _1 (arg) -> use: true",
    "two init _1 (arg) -> use: true",
    // `x = 1; return x`: same block (dominates) / cannot reach the use after the `if`
    "two init _2 (same block) -> use: true",
    "two init _2 (other block) -> use: false",
  ]);
});

test("report_conflicting_borrow dispatches on (gen, issued) in upstream arm order", () => {
  const t = "`t`";
  const s = "`s`";
  const tail = (first: string, multi = `[${s}, ${t}]`) =>
    `note_due_to_edition_2024_opaque_capture_rules | var_subdiag(${s}, ` +
    `X) -> FirstBorrowUsePlaceClosure | var_subdiag(${t}, Y) -> SecondBorrowUsePlaceClosure | add_explanation_to_diagnostic(${JSON.stringify(first)}, None, ${multi})`;
  const out = R.get("report_conflicting_borrow") as string[];
  const exp = (label: string, head: string, first: string, issued: string, gen: string) =>
    `${label}: ${head}${head === "" ? "" : " | "}${tail(first).replace("X)", `${issued})`).replace("Y)", `${gen})`)}`;
  expect(out).toEqual([
    exp(
      "shared/mut",
      `cannot_reborrow_already_borrowed(${t}, "\`d\`", "\`mp\`", "immutable", ${s}, "it", "mutable", "\`mb\`", None)`,
      "mutable ",
      "Mut",
      "Shared",
    ),
    exp(
      "deep/two-phase",
      `cannot_reborrow_already_borrowed(${t}, "\`d\`", "\`mp\`", "immutable", ${s}, "it", "mutable", "\`mb\`", None)`,
      "mutable ",
      "Mut",
      "Fake",
    ),
    exp(
      "mut/shared",
      `cannot_reborrow_already_borrowed(${t}, "\`d\`", "\`mp\`", "mutable", ${s}, "it", "immutable", "\`mb\`", None) | suggest_binding_for_closure_capture_self(OtherUse) | suggest_using_closure_argument_instead_of_capture(OtherUse) | explain_iterator_invalidation_in_for_loop_if_applicable(OtherUse, Shared, ${t})`,
      "immutable ",
      "Shared",
      "Mut",
    ),
    exp(
      "mut/mut",
      `cannot_mutably_borrow_multiply(${t}, "\`d\`", "\`mp\`", ${s}, "\`mb\`", None) | explain_iterator_invalidation_in_for_loop_if_applicable(OtherUse, Mut, ${t}) | suggest_using_closure_argument_instead_of_capture(OtherUse) | explain_iterator_advancement_in_for_loop_if_applicable(${t}, OtherUse)`,
      "first ",
      "Mut",
      "Mut",
    ),
    exp("cc/cc", `cannot_uniquely_borrow_by_two_closures(${t}, "\`d\`", ${s}, None)`, "first ", "Mut", "Mut"),
    // `classify_immutable_section` is `Some`: returns right after the closure-capture subdiagnostic
    `mut/shallow section: cannot_mutate_in_immutable_section(${t}, ${s}, "\`d\`", "match guard", "mutably borrow") | var_subdiag(${t}, Mut) -> BorrowUsePlaceClosure`,
    exp(
      "mut/shallow",
      `cannot_reborrow_already_borrowed(${t}, "\`d\`", "\`mp\`", "mutable", ${s}, "it", "immutable", "\`mb\`", None)`,
      "immutable ",
      "Fake",
      "Mut",
    ),
    exp("cc/shared", `cannot_uniquely_borrow_by_one_closure(${t}, "closure", "\`d\`", "", ${s}, "it", "", None)`, "first ", "Shared", "Mut"),
    exp("shared/cc", `cannot_reborrow_already_uniquely_borrowed(${t}, "closure", "\`d\`", "", "immutable", ${s}, "", None, "")`, "first ", "Mut", "Shared"),
    exp("mut/cc", `cannot_reborrow_already_uniquely_borrowed(${t}, "closure", "\`d\`", "", "mutable", ${s}, "", None, "")`, "first ", "Mut", "Mut"),
    // equal spans: one `BorrowUsePlace*` subdiagnostic; the union note names both places
    `same spans + union: cannot_mutably_borrow_multiply(${s}, "\`d\`", "\`mp\`", ${s}, "\`mb\`", None) | explain_iterator_invalidation_in_for_loop_if_applicable(OtherUse, Mut, ${s}) | suggest_using_closure_argument_instead_of_capture(OtherUse) | explain_iterator_advancement_in_for_loop_if_applicable(${s}, OtherUse) | note_due_to_edition_2024_opaque_capture_rules | var_subdiag(${s}, Mut) -> BorrowUsePlaceClosure | err.note("\`mp\` is a field of the union \`U\`, so it overlaps the field \`mb\`") | add_explanation_to_diagnostic("first ", None, [${s}, ${s}])`,
    "shared/shared: PANIC internal error: entered unreachable code",
  ]);
});

test("report_use_of_moved_or_uninitialized", () => {
  const s = "`s`";
  const t = "`t`";
  const moved_tail = (extra: string, label_loop = true) =>
    `${extra}err.span_note(MultiSpan([\`pub struct S\`]; \`pub struct S\`: "consider implementing \`Clone\` for this type"; ${s}: "you could clone this value"), "if \`S\` implemented \`Clone\`, you could clone the value") | explain_captures | var_path_only_subdiag${label_loop ? ` | err.span_label(${s}, "value used here after move")` : ""} | suggest_adding_bounds | err.subdiagnostic | buffer_move_error([0])`;
  expect(R.get("report_use_of_moved_or_uninitialized")).toEqual([
    // the second report on the same root local is suppressed
    "uninitialized: report_use_of_uninitialized | buffer_error | -- again --",
    // `s` moved by `let t = s`: `S` has no `#[rustc_on_move]`; `suggest_ref_or_clone` -> `suggest_hoisting_call_outside_loop`
    // (no loop: true) -> `suggest_cloning`: `S: Clone` fails only on the local `S` itself (the `ObligationCtxt` branch)
    `moved: cannot_act_on_moved_value(${s}, "use", "", "s", None) | ${moved_tail("")}`,
    `moved, 1 reinit: cannot_act_on_moved_value(${s}, "use", "", "s", None) | err.span_label(${t}, "this reinitialization might get skipped") | ${moved_tail("")}`,
    `moved, 5 reinits: cannot_act_on_moved_value(${s}, "use", "", "s", None) | err.span_note(MultiSpan([${t}, ${t}, ${t}]; ), "these 3 reinitializations and 2 others might get skipped") | ${moved_tail("")}`,
  ]);
});

test("suggest_slice_method_if_applicable", () => {
  expect(R.get("suggest_slice_method_if_applicable")).toEqual([
    'sl [Index] / [Index]: err.help("use `.split_at_mut(position)` to obtain two mutable non-overlapping sub-slices")',
    // the same index expression twice: no help
    "sl_same [Index] / [Index]: nothing",
  ]);
});

test("clone suggestions on HIR", () => {
  expect(R.get("cloning")).toEqual([
    // `x.clone()` with `x: u8`: receiver and result are both `u8`; the span is the `MethodCall`'s (segment + args)
    "clone_on_reference x.clone(): `clone()`",
    "clone_on_reference &x: None",
    "in_move_closure &x: false",
    "suggest_cloning_inner x.clone(): false",
    "suggest_cloning_inner &x: true",
    "suggest_cloning_inner r: true",
    'log: err.multipart_suggestion("consider cloning the value if the performance cost is acceptable", [[\`&\`, ""], [\`\`, ".clone()"]], "MachineApplicable") | err.multipart_suggestion("consider cloning the value if the performance cost is acceptable", [[\`\`, ".clone()"]], "MachineApplicable")',
    "suggest_copy_for_type_in_cloned_ref: nothing",
  ]);
});
