// Unit tests of builder/matches/mod.rs:1500..3010 (lane mb-matches-b): a `Builder` made by `Builder::new` for
// `pub fn f(x: u8, y: bool) -> u8 { x }` (no_core) drives the ported fns on hand-made candidates. (End to end, match
// lowering is compared with the oracle's built MIR in builder/contract.test.ts.)
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../../scripts/lib/common.ts";
import { BindingMode, ByRef, type Crate } from "../../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../../rustc_driver_impl/lib.ts";
import "../../../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../../rustc_interface/passes.ts";
import type { Steal } from "../../../rustc_data_structures/steal.ts";
import "../../../rustc_middle/lib.ts";
import { type BasicBlock, type BindingForm, type Local, OUTERMOST_SOURCE_SCOPE, SourceInfo } from "../../../rustc_middle/mir/mod.ts";
import type { ExprId, Thir } from "../../../rustc_middle/thir.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP, ErrorGuaranteed } from "../../../rustc_span/lib.ts";
import { sym, Symbol } from "../../../rustc_span/symbol.ts";
import { Panic, Unported } from "../../../std/panic.ts";
import { TypingMode } from "../../../rustc_type_ir/infer_ctxt.ts";
import { FnSig } from "../../../rustc_type_ir/ty_kind.ts";
import "../../lib.ts";
import { Builder, type LocalsForNode } from "../mod.ts";
import { Candidate, PatternExtraData } from "./mod.ts";

const WORK = join(DATA, "tmp", "mb-matches-b", process.env.RUST_TS_AGENT ?? "default");

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

/** Runs `f` with a `Builder` for `pub fn f` (`Builder::new`, as `construct_fn` makes it). */
function with_builder(f: (tcx: TyCtxt, b: Builder) => void): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, "matches_b.rs");
  writeFileSync(
    file,
    "#![feature(no_core, lang_items)]\n#![no_core]\n#![allow(internal_features)]\n" +
      '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n' +
      "pub fn f(x: u8, y: bool) -> u8 { x }\n",
  );
  let ran = false;
  run_compiler(config_from_args(["--crate-type", "lib", "--edition", "2024", file]), (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      let fn_def: LocalDefId | undefined;
      for (const id of tcx.hir_free_items()) {
        const item = tcx.hir_item(id);
        if (item.kind.$ === "Fn" && Symbol.as_str(item.kind.ident.name) === "f") fn_def = item.owner_id.def_id;
      }
      if (fn_def === undefined) throw new Error("ERROR: no fn f");
      const r = tcx.thir_body(fn_def) as { $: "Ok"; _0: [Steal<Thir>, ExprId] } | { $: "Err"; _0: ErrorGuaranteed };
      if (r.$ !== "Ok") throw new Error("ERROR: thir_body failed");
      const [thir, expr] = r._0;
      const thir_ = thir.borrow();
      if (thir_.body_type.$ !== "Fn") throw new Error("ERROR: not a fn body");
      const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
      const fn_id = tcx.local_def_id_to_hir_id(fn_def);
      const span = tcx.hir_span_with_body(fn_id);
      const builder = Builder.new(thir_, infcx, fn_def, fn_id, span, thir_.params.length, FnSig.output(thir_.body_type._0), DUMMY_SP, undefined);
      void expr;
      f(tcx, builder);
      ran = true;
    });
  });
  expect(ran).toBe(true);
}

function leaf(has_guard = false, is_never = false): Candidate {
  return new Candidate([], [], has_guard, new PatternExtraData(DUMMY_SP, [], [], is_never), undefined, undefined, undefined, undefined);
}

test("match_candidates links fully-matched candidates in order; the select/expand helpers", () => {
  with_builder((tcx, b) => {
    const start = b.cfg.start_new_block();
    // no candidates: the start block is the otherwise block
    expect(b.match_candidates(DUMMY_SP, DUMMY_SP, start, [])).toBe(start);

    // two candidates without match pairs: each gets a pre-binding block, the first's otherwise block is the second's
    // pre-binding block (and its false-edge start), and the second's otherwise block is returned
    const n = b.cfg.basic_blocks.length;
    const c0 = leaf();
    const c1 = leaf();
    const otherwise = b.match_candidates(DUMMY_SP, DUMMY_SP, start, [c0, c1]);
    expect(c0.false_edge_start_block).toBe(start);
    expect(c0.pre_binding_block).toBe(start);
    expect(c0.otherwise_block).toBe(n as BasicBlock);
    expect(c1.false_edge_start_block).toBe(n as BasicBlock);
    expect(c1.pre_binding_block).toBe(n as BasicBlock);
    expect(c1.otherwise_block).toBe((n + 1) as BasicBlock);
    expect(otherwise).toBe((n + 1) as BasicBlock);
    // a candidate that was already matched cannot be selected again
    expect(() => b.select_matched_candidate(c0, start)).toThrow(Panic);

    // remove_never_subcandidates keeps non-never subcandidates; merge_trivial_subcandidates gives up under a guard
    const parent = leaf(true);
    parent.subcandidates = [leaf(true), leaf(true)];
    b.remove_never_subcandidates(parent);
    expect(parent.subcandidates.length).toBe(2);
    b.merge_trivial_subcandidates(parent);
    expect(parent.subcandidates.length).toBe(2);
    // without a guard, trivial subcandidates (no subcandidates, empty extra data) are merged: each pre-binding block
    // jumps to one shared pre-binding block, the parent becomes a leaf with the last subcandidate's otherwise block
    const parent2 = leaf();
    parent2.or_span = DUMMY_SP;
    const [s0, s1] = [leaf(), leaf()];
    const [p0, p1, o0, o1] = [b.cfg.start_new_block(), b.cfg.start_new_block(), b.cfg.start_new_block(), b.cfg.start_new_block()];
    [s0.pre_binding_block, s0.otherwise_block, s0.false_edge_start_block] = [p0, o0, p0];
    [s1.pre_binding_block, s1.otherwise_block] = [p1, o1];
    parent2.subcandidates = [s0, s1];
    const shared = b.cfg.basic_blocks.length as BasicBlock;
    b.merge_trivial_subcandidates(parent2);
    expect(parent2.subcandidates.length).toBe(0);
    expect(parent2.or_span).toBeUndefined();
    expect(parent2.pre_binding_block).toBe(shared);
    expect(parent2.otherwise_block).toBe(o1);
    expect(parent2.false_edge_start_block).toBe(p0);
    for (const p of [p0, p1]) {
      const t = b.cfg.basic_blocks[p]!.terminator!.kind;
      expect(t.$ === "Goto" && t.target).toBe(shared);
    }
    // a candidate built by hand without `or_span` is not an or-pattern candidate: `or_span.take().unwrap()` panics
    const parent3 = leaf();
    parent3.subcandidates = [leaf()];
    expect(() => b.merge_trivial_subcandidates(parent3)).toThrow("called `Option::unwrap()` on a `None` value");
    // nothing left to test after the or-pattern
    b.test_remaining_match_pairs_after_or(DUMMY_SP, DUMMY_SP, leaf());
    void tcx;
  });
});

test("bind_and_guard_matched_candidate, declare_binding, should_emit_debug_info_for_binding", () => {
  with_builder((tcx, b) => {
    // a never sub-branch: its block becomes unreachable and a fresh block is returned
    const blk = b.cfg.start_new_block();
    const otherwise = b.cfg.start_new_block();
    const never = { span: DUMMY_SP, success_block: blk, otherwise_block: otherwise, bindings: [], ascriptions: [], is_never: true };
    const fresh = b.bind_and_guard_matched_candidate(never as never, [], DUMMY_SP, undefined, "Yes");
    expect(b.cfg.basic_blocks[blk]!.terminator!.kind.$).toBe("Unreachable");
    expect(fresh).toBe((otherwise + 1) as BasicBlock);
    // no guard, no bindings: the success block is returned as is, without statements
    const blk2 = b.cfg.start_new_block();
    const plain = { ...never, success_block: blk2, is_never: false };
    expect(b.bind_and_guard_matched_candidate(plain as never, [], DUMMY_SP, undefined, "Yes")).toBe(blk2);
    expect(b.cfg.basic_blocks[blk2]!.statements.length).toBe(0);

    // declare_binding with a guard: two locals (`T` for the arm body, `&T` for the guard), two debuginfo entries
    const var_id = { _0: b.hir_id };
    const name = Symbol.intern("z");
    const locals = b.local_decls.length as Local;
    const debuginfo = b.var_debug_info.length;
    const si = new SourceInfo(DUMMY_SP, OUTERMOST_SOURCE_SCOPE);
    b.declare_binding(si, OUTERMOST_SOURCE_SCOPE, name, new BindingMode(ByRef.No, "Mut"), var_id, tcx.types.u8, undefined, { _0: true }, undefined, DUMMY_SP);
    expect(b.local_decls.length).toBe(locals + 2);
    const arm = b.local_decls[locals]!;
    const guard = b.local_decls[locals + 1]!;
    expect(arm.ty).toBe(tcx.types.u8);
    expect(arm.mutability).toBe("Mut");
    expect(arm.local_info.$ === "Set" && arm.local_info._0.$ === "User" && arm.local_info._0._0.$).toBe("Var");
    expect(arm.source_info).not.toBe(si);
    expect(guard.ty.kind().$).toBe("Ref");
    expect(guard.mutability).toBe("Not");
    expect(guard.local_info.$ === "Set" && guard.local_info._0.$ === "User" && guard.local_info._0._0).toEqual({ $: "RefForGuard", _0: locals } as BindingForm);
    expect(b.var_debug_info.length).toBe(debuginfo + 2);
    expect(b.var_debug_info[debuginfo]!.name).toBe(name);
    expect(b.var_indices.get(var_id)).toEqual({ $: "ForGuard", ref_for_guard: (locals + 1) as Local, for_arm_body: locals } as LocalsForNode);
    expect(b.var_local_id(var_id, "OutsideGuard")).toBe(locals);
    expect(b.var_local_id(var_id, "RefWithinGuard")).toBe((locals + 1) as Local);

    // `lhs` bindings only lose their debuginfo under an `AssignDesugar` let
    expect(b.should_emit_debug_info_for_binding(name, var_id)).toBe(true);
    expect(b.should_emit_debug_info_for_binding(sym.lhs, var_id)).toBe(true);

    // a pinned binding of a non-`Pin` local is a span_bug
    let bug: unknown;
    try {
      b.pin_borrowed_local(blk2, 0 as never, { $: "Ref", _0: tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: undefined as never }, si);
    } catch (e) {
      bug = e;
    }
    expect(bug).toBeInstanceOf(Error);
    expect(bug).not.toBeInstanceOf(Unported);

    // or-patterns are expanded before tests are picked (`pick_test_for_match_pair`'s `bug!`)
    expect(() => b.pick_test([{ ...leaf(), match_pairs: [{ kind: { $: "Or", or_subpats: [] }, pattern_span: DUMMY_SP }] } as never])).toThrow(
      "or-patterns should have already been handled",
    );
  });
});
