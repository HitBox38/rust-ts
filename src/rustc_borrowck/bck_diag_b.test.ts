// Lane bck-diag-b (wave 25): diagnostics/conflict_errors.rs lines >= 2469 on real built MIR / HIR.
//
// The runtime path of `mir_borrowck` stops before these fns (in type_check), so this test drives them directly, as
// bck_lib_b.test.ts does: a no_core crate is compiled up to MIR building, `MoveData` / `BorrowSet` are built for each body,
// and the fns run on a `MirBorrowckCtxt` whose other lanes' methods that they call (`describe_place`,
// `describe_any_place`, the `borrowck_errors.rs` builders, `buffer_error`, `get_name_for_ty`, ...) are replaced on the
// instance by recorders. The builders return a recording `Diag` stand-in that logs every call made on it (spans shown as
// their source snippet). The expected values are worked out by hand from upstream over the MIR / HIR of each body.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { FieldIdx } from "../rustc_abi/layout.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import * as hir from "../rustc_hir/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import "../rustc_middle/lib.ts";
import { BasicBlock, type Body, debug_Location, debug_Place, debug_PlaceRef, Local, Location, type Place, Place_from_Local, type PlaceElem, type Statement } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import "../rustc_mir_build/lib.ts";
import { MoveData } from "../rustc_mir_dataflow/move_paths/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Span as SpanC } from "../rustc_span/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import type { RegionVid } from "../rustc_type_ir/region_kind.ts";
import { Region } from "../rustc_type_ir/sty/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { Unported } from "../std/panic.ts";
import "./lib.ts";
import { BorrowSet } from "./borrow_set.ts";
import { MirBorrowckCtxt } from "./lib.gen.ts";
import {
  AnnotatedBorrowFnSignature,
  BreakFinder,
  ConditionError,
  ConditionErrorKind,
  ConditionVisitor,
  debug_AnnotatedBorrowFnSignature,
  debug_StorageDeadOrDrop,
} from "./diagnostics/conflict_errors.ts";

const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features)]",
  '#[lang = "pointee_sized"] pub trait PointeeSized {}',
  '#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}',
  '#[lang = "sized"] pub trait Sized: MetaSized {}',
  '#[lang = "copy"] pub trait Copy {}',
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  "pub struct S { pub x: u8, pub y: u8 }",
  "pub struct D { pub x: u8 }",
  '#[lang = "drop"] pub trait Drop { fn drop(&mut self); }',
  "impl Drop for D { fn drop(&mut self) {} }",
  "pub union U { pub a: u8, pub b: u8 }",
  "pub enum E { A(u8), B }",
  "pub struct W { pub u: U }",
  "pub fn moved(s: S) -> S { let t = s; let u = s; u }",
  "pub fn lp(s: S, c: bool) { loop { let t = s; if c { break; } } }",
  "pub fn ri(mut s: S, c: bool) -> S { let t = s; if c { s = S { x: 1, y: 2 }; } s }",
  "pub fn drops(s: S, d: D) -> (S, u8) { (s, d.x) }",
  "pub fn guard(s: S, c: bool) -> u8 { match s { S { x, .. } if c => x, _ => 0 } }",
  "pub fn eguard(e: E, c: bool) -> u8 { match e { E::A(x) if c => x, _ => 0 } }",
  "pub fn anon(x: &u8) -> &u8 { let y: u8 = 1; &y }",
  "pub fn named<'a>(x: &'a u8, z: &u8) -> &'a u8 { let y: u8 = 1; &y }",
  "pub fn notref(x: &u8) -> u8 { let y: u8 = 1; let r = &y; *r }",
  "pub fn un(w: W) -> u8 { unsafe { w.u.a } }",
  "pub fn twice() -> u8 { let x: u8; x = 1; x = 2; x }",
  "pub fn argre(a: u8) -> u8 { a = 1; a }",
  "pub fn initd() -> u8 { let x: u8 = 1; x = 2; x }",
  "pub fn initp(s: S) -> u8 { let S { x, .. } = s; x = 2; x }",
  "pub fn cond(c: bool) -> u8 { let x: u8; if c { x = 1; } x }",
  "pub fn cond2(c: bool) -> u8 { let x: u8; if c { x = 1; } else { } x }",
  "pub fn cond3(c: bool) -> u8 { let x: u8; if c { } else { x = 1; } x }",
  "pub fn cond4(c: bool, d: bool) -> u8 { let x: u8; match c { true => { x = 1; } false if d => { } _ => { } } x }",
  "pub fn brk(c: bool) { loop { if c { break; } continue; } }",
].join("\n");

const WORK = join(DATA, "tmp", "bck-diag-b-test", process.env.RUST_TS_AGENT ?? "default");

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

const L = (l: Location) => debug_Location(l, PLAIN);
const P = (p: Place) => debug_Place(p, PLAIN);

/** Runs `f`; a stop in another lane's unported fn is recorded in `log` as `UNPORTED <path>`. */
function run(log: string[], f: () => void): void {
  try {
    f();
  } catch (e) {
    if (!(e instanceof Unported)) throw e;
    log.push(`UNPORTED ${e.what}`);
  }
}

/** Replaces the region of every `Rvalue::Ref` by `'?N` (N counting from 0 in block / statement order), what
 * `replace_regions_in_mir` gives the borrows `BorrowSet::build` collects (as bck_core.test.ts / bck_lib_b.test.ts). */
function renumber_borrow_regions(tcx: TyCtxt, body: Body): void {
  let n = 0;
  for (const bb of body.basic_blocks.deref()) {
    for (const stmt of bb.statements) {
      if (stmt.kind.$ === "Assign" && stmt.kind._0[1].$ === "Ref") {
        stmt.kind._0[1]._0 = Region.new_var(tcx, n++ as RegionVid);
      }
    }
  }
}

const R = new Map<string, unknown>();

mkdirSync(WORK, { recursive: true });
const FILE = join(WORK, "bck_diag_b.rs");
writeFileSync(FILE, SRC);
run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", FILE]), (compiler) => {
  const krate: Crate = parse(compiler.sess);
  create_and_enter_global_ctxt(compiler, krate, (tcx: TyCtxt) => {
    void tcx.resolver_for_lowering();
    const sm = tcx.sess.source_map();
    const snip = (sp: Span): string => {
      const r = sm.span_to_snippet(sp);
      return r.$ === "Ok" ? `«${r._0.toString()}»` : "«?»";
    };
    const fmt = (a: unknown): string =>
      typeof a === "number" ? snip(a as Span) : Array.isArray(a) ? `[${a.map(fmt).join(", ")}]` : typeof a === "string" ? JSON.stringify(a) : String(a);
    /** A `Diag` stand-in logging every method call made on it (each returns the stand-in, as the builders do). */
    const diag = (log: string[], what: string): Diag => {
      log.push(what);
      const d: Diag = new Proxy({} as Diag, {
        get(_t, name) {
          return (...args: unknown[]) => {
            log.push(`  .${String(name)}(${args.map(fmt).join(", ")})`);
            return d;
          };
        },
      });
      return d;
    };

    const bodies = new Map<string, Body>();
    const defs = new Map<string, LocalDefId>();
    tcx.par_hir_body_owners((def) => {
      const name = tcx.def_path_str(LocalDefId.to_def_id(def));
      const body = tcx.build_mir_inner_impl(def) as Body;
      renumber_borrow_regions(tcx, body);
      bodies.set(name, body);
      defs.set(name, def);
    });

    /** A `MirBorrowckCtxt` over `name`'s built MIR whose calls into other lanes are recorded in `log`. */
    const mk = (name: string) => {
      const body = bodies.get(name)!;
      const move_data = MoveData.gather_moves(body, tcx, () => true);
      const borrow_set = BorrowSet.build(tcx, body, true, move_data);
      const log: string[] = [];
      const mbcx = new MirBorrowckCtxt(
        undefined as never,
        { tcx } as never,
        body,
        move_data,
        undefined as never,
        false,
        new Set(),
        new Set(),
        new Set(),
        new Set(),
        new Set<Local>(),
        [],
        undefined as never,
        borrow_set,
        [],
        undefined,
        new Map(),
        1,
        undefined as never,
        [],
        undefined,
        undefined,
      );
      const def = defs.get(name)!;
      Object.assign(mbcx, {
        mir_def_id: () => def,
        mir_hir_id: () => tcx.local_def_id_to_hir_id(def),
        describe_any_place: (p: { local: Local; projection: readonly PlaceElem[] }) => `\`${debug_PlaceRef(p as never, PLAIN)}\``,
        describe_place: (p: { local: Local; projection: readonly PlaceElem[] }) => debug_PlaceRef(p as never, PLAIN),
        cannot_reassign_immutable: (span: Span, desc: string, is_arg: boolean) => diag(log, `cannot_reassign_immutable(${snip(span)}, ${desc}, ${is_arg})`),
        cannot_return_reference_to_local: (span: Span, return_kind: string, reference_desc: string, path_desc: string) =>
          diag(log, `cannot_return_reference_to_local(${snip(span)}, ${return_kind}, ${reference_desc}, ${path_desc})`),
        thread_local_value_does_not_live_long_enough: (span: Span) => diag(log, `thread_local_value_does_not_live_long_enough(${snip(span)})`),
        buffer_error: () => log.push("buffer_error"),
        get_name_for_ty: (ty: never, counter: number) => `name(${display_Ty(ty)}, ${counter})`,
        get_region_name_for_ty: (ty: never, counter: number) => `region(${display_Ty(ty)}, ${counter})`,
      });
      return { mbcx, log, body, move_data, borrow_set };
    };
    /** The location of the first statement of `body` matching `f`. */
    const find_loc = (body: Body, f: (s: Statement) => boolean): Location => {
      const bbs = body.basic_blocks.deref();
      for (let bb = 0; bb < bbs.length; bb++) {
        const stmts = bbs[bb]!.statements;
        for (let i = 0; i < stmts.length; i++) if (f(stmts[i]!)) return new Location(BasicBlock.new(bb), i);
      }
      throw new Error("ERROR: no such statement");
    };
    /** `_N = move _local` */
    const is_move_of = (local: number) => (s: Statement) => {
      if (s.kind.$ !== "Assign" || s.kind._0[1].$ !== "Use") return false;
      const op = s.kind._0[1]._0;
      return op.$ === "Move" && op._0.local === local && op._0.projection.length === 0;
    };

    // get_moved_indexes
    {
      const out: string[] = [];
      const gm = (name: string, nth_move: number) => {
        const { mbcx, body, move_data } = mk(name);
        let n = 0;
        const at = find_loc(body, (s) => is_move_of(1)(s) && n++ === nth_move);
        const mpi = move_data.rev_lookup.find_local(Local.new(1))!;
        const [result, reinits] = mbcx.get_moved_indexes(at, mpi);
        out.push(
          `${name} @${L(at)}: [${result.map((m) => `${L(move_data.move_outs[m.moi]!.source)} back_edge=${m.traversed_back_edge}`).join(", ")}] reinits=[${reinits.map(L).join(", ")}]`,
        );
      };
      gm("moved", 1);
      gm("lp", 0);
      gm("ri", 1);
      R.set("get_moved_indexes", out);
    }

    // classify_drop_access_kind
    {
      const out: string[] = [];
      const { mbcx, body } = mk("drops");
      const u8_ty = body.local_decls[0]!.ty;
      const place = (local: number, elems: PlaceElem[]) => Place_from_Local(Local.new(local)).project_deeper(elems, tcx);
      const field = (i: number): PlaceElem => ({ $: "Field", _0: FieldIdx.from_u32(i), _1: u8_ty });
      for (const p of [place(1, []), place(1, [field(0)]), place(2, []), place(2, [field(0)])]) {
        out.push(`${P(p)}: ${debug_StorageDeadOrDrop(mbcx.classify_drop_access_kind(p.as_ref()), PLAIN)}`);
      }
      R.set("classify_drop_access_kind", out);
    }

    // classify_immutable_section
    {
      const out: string[] = [];
      for (const name of ["guard", "eguard", "moved"]) {
        const { mbcx, borrow_set } = mk(name);
        for (const b of borrow_set.iter()) {
          out.push(`${name} ${P(b.borrowed_place)} -> ${P(b.assigned_place)} ${b.kind.$}: ${mbcx.classify_immutable_section(b.assigned_place) ?? "None"}`);
        }
        out.push(`${name} _1: ${mbcx.classify_immutable_section(Place_from_Local(Local.new(1))) ?? "None"}`);
      }
      R.set("classify_immutable_section", out);
    }

    // annotate_argument_and_return_for_borrow + AnnotatedBorrowFnSignature::emit
    {
      const out: string[] = [];
      for (const name of ["anon", "named", "notref"]) {
        const { mbcx, borrow_set, log } = mk(name);
        for (const b of borrow_set.iter()) {
          const a = mbcx.annotate_argument_and_return_for_borrow(b);
          out.push(`${name} ${P(b.borrowed_place)}: ${a === undefined ? "None" : debug_AnnotatedBorrowFnSignature(a, PLAIN).replace(/Span\([^)]*\)|\S+\.rs:\d+:\d+: \d+:\d+ \(#\d+\)/g, "<span>").replace(/DefId\([^)]*\)/g, "DefId(..)")}`);
          if (a !== undefined) {
            const d = diag(log, "emit");
            out.push(`  -> ${AnnotatedBorrowFnSignature.emit(a, mbcx, d)}`);
            out.push(...log.splice(0));
          }
        }
      }
      R.set("annotate", out);
    }

    // describe_place_for_conflicting_borrow
    {
      const out: string[] = [];
      const { mbcx, body } = mk("un");
      const bb0 = body.basic_blocks.deref()[0]!;
      let union_place: Place | undefined;
      for (const s of bb0.statements) {
        if (s.kind.$ === "Assign" && s.kind._0[1].$ === "Use" && s.kind._0[1]._0.$ === "Copy") union_place = s.kind._0[1]._0._0;
      }
      if (union_place === undefined) throw new Error("ERROR: no union read in `un`");
      const last = union_place.projection[union_place.projection.length - 1]!;
      if (last.$ !== "Field") throw new Error("ERROR: no union field");
      const base = Place_from_Local(union_place.local).project_deeper(union_place.projection.slice(0, -1), tcx);
      const other = base.project_deeper([{ $: "Field", _0: FieldIdx.from_u32(1), _1: last._1 }], tcx);
      out.push(`${P(union_place)} vs ${P(other)}: ${JSON.stringify(mbcx.describe_place_for_conflicting_borrow(union_place, other))}`);
      out.push(`${P(union_place)} vs itself: ${JSON.stringify(mbcx.describe_place_for_conflicting_borrow(union_place, union_place))}`);
      out.push(`${P(base)} vs ${P(other)}: ${JSON.stringify(mbcx.describe_place_for_conflicting_borrow(base, other))}`);
      R.set("describe_place_for_conflicting_borrow", out);
    }

    // report_illegal_reassignment
    {
      const out: string[] = [];
      const ra = (name: string, local: number) => {
        const { mbcx, body, log } = mk(name);
        const assigns: Location[] = [];
        const bbs = body.basic_blocks.deref();
        for (let bb = 0; bb < bbs.length; bb++) {
          bbs[bb]!.statements.forEach((s, i) => {
            if (s.kind.$ === "Assign" && s.kind._0[0].local === local && s.kind._0[0].projection.length === 0) assigns.push(new Location(BasicBlock.new(bb), i));
          });
        }
        const first = assigns[0]!;
        const last = assigns[assigns.length - 1]!;
        const p = Place_from_Local(Local.new(local));
        run(log, () => mbcx.report_illegal_reassignment([p, body.source_info(last).span], body.source_info(first).span, p));
        out.push(`${name}:`, ...log);
      };
      ra("twice", 1);
      ra("argre", 1);
      ra("initd", 1);
      ra("initp", 2);
      R.set("report_illegal_reassignment", out);
    }

    // try_report_cannot_return_reference_to_local / report_thread_local_value_does_not_live_long_enough
    {
      const out: string[] = [];
      const { mbcx, body, borrow_set, log } = mk("anon");
      const b = [...borrow_set.iter()][0]!;
      const span = body.source_info(b.reserve_location).span;
      const r1 = mbcx.try_report_cannot_return_reference_to_local(b, span, span, { $: "Boring" }, undefined);
      out.push(`Boring: ${r1.$}`);
      const r2 = mbcx.try_report_cannot_return_reference_to_local(b, span, span, { $: "Return", _0: { $: "Normal" } } as never, undefined);
      out.push(`Return, no desc: ${r2.$}`, ...log.splice(0));
      const r3 = mbcx.try_report_cannot_return_reference_to_local(b, span, span, { $: "Yield" }, "y");
      out.push(`Yield, desc: ${r3.$}`, ...log.splice(0));
      mbcx.report_thread_local_value_does_not_live_long_enough(body.span, span);
      out.push("thread local:", ...log.splice(0));
      mbcx.report_thread_local_value_does_not_live_long_enough(SpanC.shrink_to_hi(body.span), span);
      out.push("thread local, empty drop span:", ...log.splice(0));
      R.set("try_report", out);
    }

    // ConditionVisitor / ReferencedStatementsVisitor / BreakFinder / ConditionError
    {
      const out: string[] = [];
      class AssignSpans extends hir.intravisit.Visitor {
        spans: Span[] = [];
        override visit_expr(ex: hir.Expr): undefined {
          if (ex.kind.$ === "Assign") this.spans.push(ex.span);
          hir.intravisit.walk_expr(this, ex);
          return undefined;
        }
      }
      for (const name of ["cond", "cond2", "cond3", "cond4"]) {
        const body = tcx.hir_body_owned_by(defs.get(name)!);
        const a = new AssignSpans();
        a.visit_expr(body.value);
        const v = new ConditionVisitor(tcx, a.spans, "`x`", []);
        v.visit_expr(body.value);
        out.push(`${name}: ${v.errors.length}`);
        for (const e of v.errors) out.push(`  ${snip(e.span)} ${e.kind} ${ConditionErrorKind.describes_condition_value(e.kind)} ${JSON.stringify(e.label)}`);
      }
      const bf = new BreakFinder([], []);
      bf.visit_expr(tcx.hir_body_owned_by(defs.get("brk")!).value);
      out.push(`brk: breaks [${bf.found_breaks.map(([, s]) => snip(s)).join(", ")}] continues [${bf.found_continues.map(([, s]) => snip(s)).join(", ")}]`);
      const ce = ConditionError.new(bodies.get("brk")!.span, "Other", "l");
      out.push(`ConditionError::new: ${ce.kind} ${JSON.stringify(ce.label)} ${ce.span === bodies.get("brk")!.span}`);
      R.set("condition", out);
    }
  });
});

test("get_moved_indexes: the moves reaching the error, back edges, reachable reinits", () => {
  expect(R.get("get_moved_indexes")).toEqual([
    "moved @bb0[4]: [bb0[1] back_edge=false] reinits=[]",
    "lp @bb2[1]: [bb2[1] back_edge=true] reinits=[]",
    "ri @bb4[2]: [bb0[1] back_edge=false] reinits=[bb1[2]]",
  ]);
});

test("classify_drop_access_kind: the outermost ADT with a destructor", () => {
  expect(R.get("classify_drop_access_kind")).toEqual([
    "_1: LocalStorageDead",
    "(_1.0: (S, u8)): LocalStorageDead",
    "_2: LocalStorageDead",
    "(_2.0: (S, u8)): Destructor(D)",
  ]);
});

test("classify_immutable_section: the FakeRead cause of a fake borrow", () => {
  expect(R.get("classify_immutable_section")).toEqual([
    "guard (_1.0: u8) -> _4 Shared: None",
    "guard _1: None",
    "eguard ((_1 as A).0: u8) -> _6 Shared: None",
    "eguard _1 -> _3 Fake: match guard",
    "eguard _1: None",
    "moved _1: None",
  ]);
});

test("annotate_argument_and_return_for_borrow / annotate_fn_sig / AnnotatedBorrowFnSignature::emit", () => {
  expect(R.get("annotate")).toEqual([
    "anon _2: AnonymousFunction { argument_ty: &'^0.Named(DefId(..)) u8, argument_span: <span>, return_ty: &'^0.Named(DefId(..)) u8, return_span: <span> }",
    "  -> region(&u8, 0)",
    "emit",
    "  .span_label(«&u8», \"has type `name(&u8, 0)`\")",
    "  .span_label(«&u8», \"also has type `name(&u8, 0)`\")",
    "  .note(\"argument and return type have the same lifetime due to lifetime elision rules\")",
    "  .note(\"to learn more, visit <https://doc.rust-lang.org/book/ch10-03-lifetime-syntax.html#lifetime-elision>\")",
    "named _3: NamedFunction { arguments: [(&'^0.Named(DefId(..)) u8, <span>)], return_ty: &'^0.Named(DefId(..)) u8, return_span: <span> }",
    "  -> region(&'a u8, 0)",
    "emit",
    "  .span_label(«'a», \"has lifetime `region(&'a u8, 0)`\")",
    "  .span_label(«'a», \"also has lifetime `region(&'a u8, 0)`\")",
    "  .help(\"use data from the highlighted arguments which match the `region(&'a u8, 0)` lifetime of the return type\")",
    "notref _2: None",
  ]);
});

test("describe_place_for_conflicting_borrow: union fields", () => {
  expect(R.get("describe_place_for_conflicting_borrow")).toEqual([
    "((_1.0: U).0: u8) vs ((_1.0: U).1: u8): [\"`(_1.0: U)`\",\"`((_1.0: U).0: u8)`\",\"`((_1.0: U).1: u8)`\",\"U\"]",
    "((_1.0: U).0: u8) vs itself: [\"`((_1.0: U).0: u8)`\",\"\",\"\",\"\"]",
    "(_1.0: U) vs ((_1.0: U).1: u8): [\"`(_1.0: U)`\",\"\",\"\",\"\"]",
  ]);
});

test("report_illegal_reassignment", () => {
  expect(R.get("report_illegal_reassignment")).toEqual([
    "twice:",
    "cannot_reassign_immutable(«x = 2», `_1`, false)",
    "  .span_label(«x = 1», \"first assignment to `_1`\")",
    "  .span_suggestion_verbose(«», \"consider making this binding mutable\", \"mut \", \"MachineApplicable\")",
    "  .span_label(«x = 2», \"cannot assign twice to immutable variable\")",
    "buffer_error",
    "argre:",
    "cannot_reassign_immutable(«a = 1», `_1`, true)",
    "  .span_suggestion_verbose(«», \"consider making this binding mutable\", \"mut \", \"MachineApplicable\")",
    "  .span_label(«a = 1», \"cannot assign to immutable argument\")",
    "buffer_error",
    "initd:",
    "cannot_reassign_immutable(«x = 2», `_1`, false)",
    "  .span_label(«x», \"first assignment to `_1`\")",
    "  .span_suggestion_verbose(«», \"consider making this binding mutable\", \"mut \", \"MachineApplicable\")",
    "  .span_label(«x = 2», \"cannot assign twice to immutable variable\")",
    "buffer_error",
    "initp:",
    "cannot_reassign_immutable(«x = 2», `_2`, false)",
    "  .span_label(«x», \"first assignment to `_2`\")",
    "  .span_suggestion_verbose(«», \"consider making this binding mutable\", \"mut \", \"MachineApplicable\")",
    "  .span_suggestion_verbose(«», \"to modify the original value, take a borrow instead\", \"ref mut \", \"MaybeIncorrect\")",
    "  .span_label(«x = 2», \"cannot assign twice to immutable variable\")",
    "buffer_error",
  ]);
});

test("try_report_cannot_return_reference_to_local / report_thread_local_value_does_not_live_long_enough", () => {
  expect(R.get("try_report")).toEqual([
    "Boring: Ok",
    "Return, no desc: Err",
    "cannot_return_reference_to_local(«&y», return, reference to, local binding)",
    "Yield, desc: Err",
    "cannot_return_reference_to_local(«&y», yield, reference to, local variable `y`)",
    "thread local:",
    "thread_local_value_does_not_live_long_enough(«&y»)",
    "  .with_span_label(«&y», \"thread-local variables cannot be borrowed beyond the end of the function\")",
    "  .with_span_label(«pub fn anon(x: &u8) -> &u8 { let y: u8 = 1; &y }», \"end of enclosing function is here\")",
    "thread local, empty drop span:",
    "thread_local_value_does_not_live_long_enough(«&y»)",
    "  .with_span_label(«&y», \"thread-local variables cannot be borrowed beyond the end of the function\")",
    "  .with_span_label(«}», \"end of enclosing function is here\")",
  ]);
});

test("ConditionVisitor / ReferencedStatementsVisitor / BreakFinder / ConditionError::new / describes_condition_value", () => {
  expect(R.get("condition")).toEqual([
    "cond: 2",
    "  «c» ConditionValue true \"if this `if` condition is `false`, `x` is not initialized\"",
    "  «» Other false \"an `else` arm might be missing here, initializing `x`\"",
    "cond2: 1",
    "  « else » ConditionValue true \"if the `if` condition is `false` and this `else` arm is executed, `x` is not initialized\"",
    "cond3: 1",
    "  «c» ConditionValue true \"if this condition is `true`, `x` is not initialized\"",
    "cond4: 2",
    "  «false if d» ConditionValue true \"if this pattern and condition are matched, `x` is not initialized\"",
    "  «_» Other false \"if this pattern is matched, `x` is not initialized\"",
    "brk: breaks [«break»] continues [«continue»]",
    "ConditionError::new: Other \"l\" true",
  ]);
});
