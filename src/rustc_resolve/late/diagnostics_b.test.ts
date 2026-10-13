// Tests for lane res-late-diag-b: compiler/rustc_resolve/src/late/diagnostics.rs:2267..end.
//
// Oracle: diagnostics_b_oracle/expected.json, the stderr and exit code of the `resdump` probe (diagnostics up
// to and including name resolution) on each diagnostics_b_oracle/cases/<name>.rs with the nocore suites'
// arguments (diagnostics_b_oracle/gen.ts documents the command; with the probe and the pinned toolchain
// present the "fixtures" test re-runs it and requires the fixture to be current).
//
// 1. End to end: src/rust_ts/resdump.ts on every case, compared with the oracle byte for byte. PENDING
//    while the driver stops before late resolution; a pending case must still stop at exactly the listed
//    `rust-ts: unported: ..` line (exit 70), so the entry has to go once the pipeline runs through.
// 2. In process, for the cases whose diagnostic is emitted entirely by this lane's code: the real `Resolver`
//    (macros_oracle/with_resolver.ts, i.e. `Resolver::new` on the parsed crate), the session's emitter
//    redirected to a byte buffer (the human emitter as `default_emitter` configures it for these
//    arguments), and a `LateResolutionVisitor` whose lifetime ribs / `DiagMetadata` are set up the way
//    late.rs sets them up at the point where it calls into this file (cited per case). The emitted text,
//    followed by `print_error_count`, must equal the oracle's stderr. (The ribs are scaffolding: late.rs,
//    lanes res-late-a/-b, is not ported yet. NodeIds are the parser's DUMMY ids because expansion has not run;
//    no code under test reads them.)
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "../lib.ts";
import { type Crate, DUMMY_NODE_ID, type Fn, type Item, type Lifetime, type Ty } from "../../rustc_ast/lib.ts";
import { FnCtxt } from "../../rustc_ast/visit.gen.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import type { DiagCtxtHandle } from "../../rustc_errors/lib.ts";
import { PerNS } from "../../rustc_hir/def.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { FatalErrorMarker } from "../../rustc_span/fatal_error.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { KeyedMap } from "../../rust_ts/keyed.ts";
import { Unported } from "../../std/panic.ts";
import { with_resolver } from "../macros_oracle/with_resolver.ts";
import { Ident_key, ParentScope, Resolver } from "../lib.ts";
import { type DiagMetadata, LateResolutionVisitor, LifetimeRib, type LifetimeRibKind } from "../late.ts";
import { type MissingLifetime, signal_label_shadowing, signal_lifetime_shadowing } from "./diagnostics.ts";
import { case_names, CASES, ENV, type Outcome, port_args, resdump_probe, run_oracle } from "./diagnostics_b_oracle/gen.ts";

const HERE = import.meta.dir;
const REPO = join(HERE, "..", "..", "..");
const expected = JSON.parse(readFileSync(join(HERE, "diagnostics_b_oracle", "expected.json"), "utf8")) as Record<string, Outcome>;

// ---- 1. end to end ----------------------------------------------------------------------------

// Where the port stops today: the crate store (`CStore::from_tcx`, wave 11), before resolution. (Was the early
// lint store of `configure_and_expand`, lane lint-early-a.) late.rs and late/diagnostics.rs are integrated.
const CSTORE = "rustc_metadata::creader::CStore::from_tcx (wave 11)";
const PENDING: Record<string, string> = Object.fromEntries(case_names().map((name) => [name, CSTORE]));

for (const name of case_names()) {
  test(`end to end: ${name}`, () => {
    const want = expected[name];
    if (want === undefined) throw new Error(`ERROR: no oracle outcome for ${name}; run bun src/rustc_resolve/late/diagnostics_b_oracle/gen.ts`);
    const p = Bun.spawnSync([process.execPath, join(REPO, "src/rust_ts/resdump.ts"), ...port_args(name)], { cwd: CASES, env: { ...process.env, ...ENV } });
    const got: Outcome = { stderr: p.stderr.toString(), exit: p.exitCode ?? -1 };
    const pending = PENDING[name];
    if (pending !== undefined) {
      expect({ exit: got.exit, unported: got.stderr.split("\n").filter((l) => l.startsWith("rust-ts: ")) }).toEqual({
        exit: 70,
        unported: [`rust-ts: unported: ${pending}`],
      });
      return;
    }
    expect(got).toEqual(want);
  }, 120_000);
}

test("the fixtures are the current oracle output", () => {
  const req = process.env.RUST_TS_REQUIRE_PROBES === "1";
  if (process.env.RUST_TS_DATA === undefined || !existsSync(resdump_probe())) {
    if (req) throw new Error(`ERROR: resdump probe missing; bun scripts/probes.ts build resdump`);
    return;
  }
  for (const name of case_names()) expect({ name, ...run_oracle(name) }).toEqual({ name, ...expected[name]! });
}, 120_000);

// ---- 2. in process ----------------------------------------------------------------------------

/** `LateResolutionVisitor::new` (late.rs:1581) as far as these tests need it: the module ribs are not used. */
function new_visitor(r: Resolver): LateResolutionVisitor {
  const diag_metadata: DiagMetadata = {
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
  return new LateResolutionVisitor(
    r,
    ParentScope.module(r.graph_root, r.arenas),
    new PerNS([], [], []),
    undefined,
    [],
    [],
    undefined,
    undefined,
    diag_metadata,
    false,
    new Map(),
    [],
    [],
  );
}

/** Whether `m` is a stub's `unported_methods` placeholder (src/rust_ts/stubs.ts). */
function is_unported_placeholder(m: (this: Resolver) => unknown): boolean {
  try {
    m.call(undefined as unknown as Resolver);
    return false;
  } catch (e) {
    return e instanceof Unported;
  }
}

function rib(kind: LifetimeRibKind): LifetimeRib {
  return new LifetimeRib(kind, new KeyedMap(Ident_key));
}

/**
 * Runs `f` on the case's crate with the session's diagnostics going to a buffer, then `print_error_count`;
 * returns the text as the oracle prints it (paths relative to the cases directory).
 */
function emitted(name: string, f: (v: LateResolutionVisitor, krate: Crate, tcx: TyCtxt) => void): string {
  let out: string | undefined;
  // `Resolver::dcx` (diagnostics/impls.rs:337, lane res-diag) is `self.tcx.dcx()`. While it is still the stub's
  // `unported` placeholder, the test installs exactly that body for the duration of the case.
  const proto = Resolver.prototype as { dcx: (this: Resolver) => DiagCtxtHandle };
  const orig_dcx = proto.dcx;
  const shim = is_unported_placeholder(orig_dcx);
  if (shim) {
    proto.dcx = function (this: Resolver): DiagCtxtHandle {
      return this.tcx_.dcx();
    };
  }
  try {
    with_resolver(join(CASES, `${name}.rs`), (r, krate, tcx) => {
      const buf = new VecU8();
      // `default_emitter` (session.rs) for `--error-format=human` without colour, `-Zui-testing` or width.
      let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
      em = AnnotateSnippetEmitter.sm(em, tcx.sess.source_map());
      tcx.sess.dcx().set_emitter(em);
      f(new_visitor(r), krate, tcx);
      tcx.sess.dcx().print_error_count();
      out = new TextDecoder().decode(buf.bytes()).replaceAll(`${CASES}/`, "");
      // `run_compiler` prints the count again in `finish_diagnostics` and then aborts on the errors.
      tcx.sess.dcx().make_silent();
    });
  } catch (e) {
    if (!(e instanceof FatalErrorMarker)) throw e;
  } finally {
    if (shim) proto.dcx = orig_dcx;
  }
  if (out === undefined) throw new Error("no output");
  return out;
}

function fn_item(item: Item): Fn {
  if (item.kind.$ !== "Fn") throw new Error("test: not a fn");
  return item.kind._0;
}

function ref_lifetime(ty: Ty): Lifetime {
  if (ty.kind.$ !== "Ref" || ty.kind._0 === undefined) throw new Error("test: not a `&'a T`");
  return ty.kind._0;
}

/** `visit_item` (late.rs:899) records the item; `visit_fn` (late.rs:1152) the function. */
function enter_fn(v: LateResolutionVisitor, item: Item, f: Fn): void {
  v.diag_metadata.current_item = item;
  v.diag_metadata.current_function = [{ $: "Fn", _0: FnCtxt.Free, _1: item.vis, _2: f }, item.span];
}

// `resolve_lifetime` (late.rs:1942) on `'a` / `'statik` in a parameter of a free fn: the ribs are `Item`
// (`visit_item`, late.rs:904), `Generics { Function }` (`resolve_item` -> `with_generic_param_rib`, late.rs:2927,
// 3173) and `AnonymousCreateParameter` (`resolve_fn_signature`, late.rs:2490).
for (const name of ["e0261", "e0261_static"]) {
  test(`emit_undeclared_lifetime_error: ${name}`, () => {
    const got = emitted(name, (v, krate) => {
      const item = krate.items[0]!;
      const f = fn_item(item);
      enter_fn(v, item, f);
      v.lifetime_ribs.push(
        rib({ $: "Item" }),
        rib({ $: "Generics", binder: item.id, span: f.generics.span, kind: "Function" }),
        rib({ $: "AnonymousCreateParameter", binder: item.id, report_in_path: false }),
      );
      v.emit_undeclared_lifetime_error(ref_lifetime(f.sig.decl.inputs[0]!.ty), undefined);
    });
    expect(got).toBe(expected[name]!.stderr);
  });
}

// The same in a method of an impl with generics: `resolve_implementation` (late.rs:3567) adds
// `Generics { ImplBlock }` and `AnonymousCreateParameter`, `resolve_impl_item` (late.rs:3727) the method's
// `Generics { Function }`; both get a suggestion, innermost first.
test("emit_undeclared_lifetime_error: e0261_impl", () => {
  const got = emitted("e0261_impl", (v, krate) => {
    const impl_item = krate.items[1]!;
    if (impl_item.kind.$ !== "Impl") throw new Error("test: not an impl");
    const impl_ = impl_item.kind._0;
    const m = impl_.items[0]!;
    if (m.kind.$ !== "Fn") throw new Error("test: not a method");
    const f = m.kind._0;
    v.diag_metadata.current_item = impl_item;
    v.diag_metadata.current_function = [{ $: "Fn", _0: { $: "Assoc", _0: { $: "Impl", of_trait: false } }, _1: m.vis, _2: f }, m.span];
    v.lifetime_ribs.push(
      rib({ $: "Item" }),
      rib({ $: "Generics", binder: impl_item.id, span: impl_.generics.span, kind: "ImplBlock" }),
      rib({ $: "AnonymousCreateParameter", binder: impl_item.id, report_in_path: true }),
      rib({ $: "Generics", binder: m.id, span: f.generics.span, kind: "Function" }),
      rib({ $: "AnonymousCreateParameter", binder: m.id, report_in_path: false }),
    );
    v.emit_undeclared_lifetime_error(ref_lifetime(f.sig.decl.inputs[1]!.ty), undefined);
  });
  expect(got).toBe(expected["e0261_impl"]!.stderr);
});

/** The `MissingLifetime` `resolve_anonymous_lifetime` (late.rs:1957) makes for an elided `&T` (`visit_ty`, late.rs:958). */
function elided_ref(tcx: TyCtxt, ty: Ty): MissingLifetime {
  return { id: DUMMY_NODE_ID, span: tcx.sess.source_map().start_point(ty.span), kind: "Ampersand", count: 1, id_for_lint: ty.id };
}

// `&u8` in a struct field: the ribs are `Item` and `Generics { Item }` (`resolve_adt`, late.rs:2829), so
// `resolve_anonymous_lifetime` reaches `Item => break` and calls `report_missing_lifetime_specifiers([&lt], None)`
// (late.rs:2109).
test("report_missing_lifetime_specifiers: e0106_struct", () => {
  const got = emitted("e0106_struct", (v, krate, tcx) => {
    const item = krate.items[0]!;
    if (item.kind.$ !== "Struct" || item.kind._2.$ !== "Struct") throw new Error("test: not a struct");
    const field = item.kind._2.fields[0]!;
    v.diag_metadata.current_item = item;
    v.lifetime_ribs.push(rib({ $: "Item" }), rib({ $: "Generics", binder: item.id, span: item.kind._1.span, kind: "Item" }));
    v.report_missing_lifetime_specifiers([elided_ref(tcx, field.ty)], undefined);
  });
  expect(got).toBe(expected["e0106_struct"]!.stderr);
});

// `-> &[u8]` with no parameters: `resolve_fn_signature` (late.rs:2510) resolves the return type under
// `ElisionFailure`, collects the failure and calls `report_missing_lifetime_specifiers(failures,
// Some(failure_info))` with `resolve_fn_params`' `Err((vec![], vec![]))` (late.rs:2533, 2671).
test("report_missing_lifetime_specifiers: e0106_ret", () => {
  const got = emitted("e0106_ret", (v, krate, tcx) => {
    const item = krate.items[0]!;
    const f = fn_item(item);
    enter_fn(v, item, f);
    v.lifetime_ribs.push(
      rib({ $: "Item" }),
      rib({ $: "Generics", binder: item.id, span: f.generics.span, kind: "Function" }),
      rib({ $: "AnonymousCreateParameter", binder: item.id, report_in_path: false }),
      rib({ $: "ElisionFailure" }),
    );
    if (f.sig.decl.output.$ !== "Ty") throw new Error("test: no return type");
    v.report_missing_lifetime_specifiers([elided_ref(tcx, f.sig.decl.output._0)], [[], []]);
  });
  expect(got).toBe(expected["e0106_ret"]!.stderr);
});

// `with_resolved_label` (late.rs:5192): the inner `'a: loop` finds the outer label in scope.
test("signal_label_shadowing: label_shadow", () => {
  const got = emitted("label_shadow", (_v, krate, tcx) => {
    const f = fn_item(krate.items[0]!);
    const outer = f.body!.stmts[0]!;
    if (outer.kind.$ !== "Expr" || outer.kind._0.kind.$ !== "Loop") throw new Error("test: no outer loop");
    const inner = outer.kind._0.kind._0.stmts[0]!;
    if (inner.kind.$ !== "Expr" || inner.kind._0.kind.$ !== "Loop") throw new Error("test: no inner loop");
    signal_label_shadowing(tcx.sess, outer.kind._0.kind._1!.ident.span, inner.kind._0.kind._1!.ident);
  });
  expect(got).toBe(expected["label_shadow"]!.stderr);
});

// `with_generic_param_rib` (late.rs:3214) for the method's `'a`, already bound by the impl's generics.
test("signal_lifetime_shadowing: e0496", () => {
  const got = emitted("e0496", (_v, krate, tcx) => {
    const impl_item = krate.items[1]!;
    if (impl_item.kind.$ !== "Impl") throw new Error("test: not an impl");
    const m = impl_item.kind._0.items[0]!;
    if (m.kind.$ !== "Fn") throw new Error("test: not a method");
    signal_lifetime_shadowing(tcx.sess, impl_item.kind._0.generics.params[0]!.ident, m.kind._0.generics.params[0]!.ident);
  });
  expect(got).toBe(expected["e0496"]!.stderr);
});
