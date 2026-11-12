// Mock backend for mir/analyze.test.ts (lane ssa-mir-core; test helper, not a port). See driver.ts's header.
import { CodegenFnAttrFlags } from "../../../rustc_middle/middle/codegen_fn_attrs.ts";
import { type BasicBlock, type Body, type PlaceRef as mir_PlaceRef } from "../../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import type { Ty } from "../../../rustc_middle/ty/decls.ts";
import { Instance } from "../../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../../rustc_middle/ty/layout.ts";
import { RawList } from "../../../rustc_middle/ty/list.ts";
import { TypingEnv } from "../../../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../../../rustc_middle/ty/structural_impls.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import type { Span } from "../../../rustc_span/lib.ts";
import { Symbol, sym } from "../../../rustc_span/symbol.ts";
import type { Target } from "../../../rustc_target/spec/mod.ts";
import { panic } from "../../../std/panic.ts";
import { wants_wasm_eh } from "../../base.ts";
import { Local } from "../../../rustc_middle/mir/mod.ts";
import { codegen_mir, type FunctionCx, xlane } from "../mod.ts";
import * as analyze from "../analyze.ts";
import { PlaceRef, PlaceValue } from "../place.ts";
import { OperandValue, OperandRef } from "../operand.ts";

export interface MockResult {
  kind: "FN";
  name: string;
  locals: string[];
  non_ssa: number[];
  cleanup_kinds: string[] | undefined;
  calls: string[];
  names: string[];
  succs: number[][];
}

type Any = any; // PORT: test mock; the backend value types are opaque strings.

class MockCx {
  readonly typing_env: TypingEnv = TypingEnv.fully_monomorphized();
  constructor(
    readonly tcx: TyCtxt,
    readonly calls: string[],
  ) {}
  tcx_(): TyCtxt {
    return this.tcx;
  }
  typing_env_(): TypingEnv {
    return this.typing_env;
  }
  data_layout(): Any {
    return this.tcx.data_layout();
  }
  layout_of(ty: Ty): TyAndLayout {
    const r = this.tcx.layout_of(this.typing_env.as_query_input(ty));
    if (r.$ === "Err") panic("mock layout_of: layout error");
    return r._0;
  }
  spanned_layout_of(ty: Ty, _span: Span): TyAndLayout {
    return this.layout_of(ty);
  }
  fn_abi_of_instance(instance: Instance, extra: Any): Any {
    const r = this.tcx.fn_abi_of_instance(this.typing_env.as_query_input([instance, extra]));
    if (r.$ === "Err") panic("mock fn_abi_of_instance: error");
    return r._0;
  }
  type_needs_drop(ty: Ty): boolean {
    return ty.needs_drop(this.tcx, this.typing_env);
  }
  intrinsic_call_expects_place_always(name: Symbol): boolean {
    return name === sym.black_box;
  }
  get_fn(instance: Instance): string {
    return `fn:${Symbol.as_str(this.tcx.item_name(Instance.def_id(instance)))}`;
  }
  eh_personality(): string {
    return "personality";
  }
}

class MockBx extends MockCx {
  constructor(
    tcx: TyCtxt,
    calls: string[],
    readonly llbb_: string,
  ) {
    super(tcx, calls);
  }
  llbb(): string {
    return this.llbb_;
  }
  get_param(i: number): string {
    this.calls.push(`get_param ${i}`);
    return `param${i}`;
  }
  set_personality_fn(f: string): void {
    this.calls.push(`set_personality_fn ${f}`);
  }
  store_fn_arg(_arg: Any, idx: { value: number }, _dst: Any): void {
    this.calls.push(`store_fn_arg ${idx.value}`);
    idx.value += 1;
  }
}

/** The `#[no_mangle]` fns without generics of the local crate, in `mir_keys` order. */
function no_mangle_fns(tcx: TyCtxt): [string, Instance][] {
  const out: [string, Instance][] = [];
  for (const def_id of tcx.mir_keys(null)) {
    const did = LocalDefId.to_def_id(def_id);
    const kind = tcx.def_kind(did);
    if (kind.$ !== "Fn") continue;
    if (tcx.generics_of(did).count() !== 0) continue;
    if (!CodegenFnAttrFlags.contains(tcx.codegen_fn_attrs(did).flags, CodegenFnAttrFlags.NO_MANGLE)) continue;
    out.push([Symbol.as_str(tcx.item_name(did)), Instance.mono(tcx, did)]);
  }
  return out;
}

/** Upstream `debug_introduce_local`'s name for each local (driver.ts header). */
function local_names(mir: Body): string[] {
  const names: string[] = mir.local_decls.map((_, i) => `_${i}`);
  const seen = new Set<number>();
  for (const var_ of mir.var_debug_info) {
    if (var_.value.$ !== "Place" || var_.composite !== undefined) continue;
    const place = var_.value._0;
    if (place.projection.length !== 0 || seen.has(place.local)) continue;
    seen.add(place.local);
    const name = Symbol.as_str(var_.name);
    if (name !== "") names[place.local] = name;
  }
  return names;
}

export function run_codegen_mir_mock(tcx: TyCtxt): MockResult[] {
  const results: MockResult[] = [];
  for (const [name, instance] of no_mangle_fns(tcx)) {
    const calls: string[] = [];
    let fx_seen: FunctionCx<Any, Any, Any> | undefined;
    let n_blocks = 0;
    const Bx_ = {
      build(cx: MockCx, llbb: string): MockBx {
        calls.push(`build ${llbb}`);
        return new MockBx(cx.tcx, calls, llbb);
      },
      append_block(_cx: MockCx, llfn: string, bb_name: string): string {
        calls.push(`append_block ${llfn} ${bb_name}`);
        return `llbb${n_blocks++}:${bb_name}`;
      },
    };
    const order: BasicBlock[] = [];
    const restore = install({
      wants_new_eh_instructions: (target: Target) => wants_wasm_eh(target) || target.is_like_msvc,
      PlaceRef_new_sized: (llval: Any, layout: TyAndLayout) => {
        calls.push(`new_sized ${llval}`);
        return new PlaceRef(new PlaceValue(llval, undefined, layout.align.abi), layout);
      },
      PlaceRef_alloca_size: (_bx: Any, size: Any, layout: TyAndLayout) => {
        calls.push(`alloca_size ${size.bytes()}`);
        return new PlaceRef(new PlaceValue("alloca", undefined, layout.align.abi), layout);
      },
      PlaceRef_alloca_unsized_indirect: (_bx: Any, layout: TyAndLayout) => {
        calls.push("alloca_unsized_indirect");
        return new PlaceRef(new PlaceValue("alloca", undefined, layout.align.abi), layout);
      },
      PlaceRef_project_field: (place: Any, _bx: Any, i: number) => {
        calls.push(`project_field ${i}`);
        return place;
      },
      OperandRef_zero_sized: (layout: TyAndLayout) => new OperandRef(OperandValue.ZeroSized, layout, undefined),
      monomorphized_place_ty: (fx: FunctionCx<Any, Any, Any>, place_ref: mir_PlaceRef) => {
        // place.rs:424, upstream's body.
        const place_ty = place_ref.ty(fx.mir.local_decls, fx.cx.tcx_());
        return fx.monomorphize(place_ty.ty, fold_Ty);
      },
      fill_function_debug_context: (fx: FunctionCx<Any, Any, Any>) => {
        fx_seen = fx;
      },
      compute_per_local_var_debug_info: () => undefined,
      debug_introduce_locals: () => {},
      codegen_block: (_fx: Any, bb: BasicBlock) => {
        calls.push(`codegen_block ${bb}`);
        order.push(bb);
      },
      codegen_block_as_unreachable: (_fx: Any, bb: BasicBlock) => {
        calls.push(`codegen_block_as_unreachable ${bb}`);
      },
    });
    const prev_alloca = PlaceRef.alloca;
    (PlaceRef as Any).alloca = (_bx: Any, layout: TyAndLayout) => {
      calls.push(`alloca ${layout.size.bytes()}`);
      return new PlaceRef(new PlaceValue("alloca", undefined, layout.align.abi), layout);
    };
    let non_ssa_list: number[];
    try {
      codegen_mir(Bx_ as Any, new MockCx(tcx, calls) as Any, instance);
      non_ssa_list = [...analyze.non_ssa_locals(fx_seen!, order).iter()].map((l) => Local.as_usize(l));
    } finally {
      (PlaceRef as Any).alloca = prev_alloca;
      restore();
    }
    const fx = fx_seen!;
    results.push({
      kind: "FN",
      name,
      locals: fx.locals.values.map((v) => v.$),
      non_ssa: non_ssa_list,
      cleanup_kinds: fx.cleanup_kinds?.map((k) => (k.$ === "Internal" ? `Internal(${k.funclet})` : k.$)),
      calls,
      names: local_names(fx.mir),
      succs: fx.mir.basic_blocks.deref().map((d) => [...d.terminator_().successors()].map((b) => b as number)),
    });
  }
  return results;
}

function install(stubs: Partial<Record<keyof typeof xlane, unknown>>): () => void {
  const saved: Record<string, unknown> = {};
  const table = xlane as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(stubs)) {
    saved[k] = table[k];
    table[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) table[k] = v;
  };
}
