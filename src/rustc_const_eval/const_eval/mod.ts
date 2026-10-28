// Not in interpret to make sure we do not use private implementation details
// Port of compiler/rustc_const_eval/src/const_eval/mod.rs (lane interp-contract, plan-m4 wave 23b): the query providers'
// entry points `try_destructure_mir_constant_for_user_output` and `tag_for_variant_provider` are ported; the modules'
// fns are declared (`// stub:`) for their fill lanes (docs/handoff/interp-contract.md).
import { FieldIdx, type VariantIdx } from "../../rustc_abi/lib.ts";
import { debug_InterpErrorKind, InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { unwrap_result } from "../../std/result.ts";
import { type ConstValue, type DestructuredConstant, debug_ConstValue } from "../../rustc_middle/mir/mod.ts";
import type { ScalarInt } from "../../rustc_middle/ty/consts/int.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { type PseudoCanonicalInput, type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, unwrap } from "../../std/panic.ts";
import type { OpTy } from "../interpret/operand.gen.ts";
import { InterpCx } from "../interpret/eval_context.ts";
import { DummyMachine } from "./dummy_machine.ts";
import { mk_eval_cx_for_const_val, op_to_const } from "./eval_queries.ts";

// mod dummy_machine;
// mod dyn_trait;
// mod error;
// mod eval_queries;
// mod fn_queries;
// mod machine;
// mod type_info;
// mod valtrees;

// pub use self::dummy_machine::*;
export * from "./dummy_machine.ts";
// pub use self::error::*;
export * from "./error.ts";
// pub use self::eval_queries::*;
export * from "./eval_queries.ts";
// pub use self::fn_queries::*;
export * from "./fn_queries.ts";
// pub use self::machine::*;
export * from "./machine.ts";
// pub(crate) use self::valtrees::{eval_to_valtree, valtree_to_const_value};
export { eval_to_valtree, valtree_to_const_value } from "./valtrees.ts";
// `mod dyn_trait;`, `mod type_info;` (its `mod adt;`): `impl InterpCx<CompileTimeMachine>` extension modules.
import "./dyn_trait.ts";
import "./type_info.ts";
import "./type_info/adt.ts";
import { u64_to_number } from "../../rust_ts/u64.ts";

// We forbid type-level constants that contain more than `VALTREE_MAX_NODES` nodes.
export const VALTREE_MAX_NODES = 100000;

// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/mod.rs:32 try_destructure_mir_constant_for_user_output
export function try_destructure_mir_constant_for_user_output(tcx: TyCtxt, val: ConstValue, ty: Ty): DestructuredConstant | undefined {
  const typing_env = TypingEnv.fully_monomorphized();
  // FIXME: use a proper span here?
  const r = mk_eval_cx_for_const_val(tcx.at(DUMMY_SP), typing_env, val, ty);
  if (r === undefined) return undefined;
  const [ecx, op] = r;

  // We go to `usize` as we cannot allocate anything bigger anyway.
  let field_count: number;
  let variant: VariantIdx | undefined;
  let down: OpTy;
  const kind = ty.kind();
  switch (kind.$) {
    case "Array": {
      const len = kind._1.try_to_target_usize(tcx);
      if (len === undefined) return undefined;
      [field_count, variant, down] = [u64_to_number(len, "try_destructure_mir_constant_for_user_output"), undefined, op];
      break;
    }
    case "Adt": {
      const def = kind._0;
      if (def.variants().length === 0) {
        return undefined;
      }
      const variant_ = InterpResult.discard_err(ecx.read_discriminant(op));
      if (variant_ === undefined) return undefined;
      const down_ = InterpResult.discard_err(ecx.project_downcast(op, variant_));
      if (down_ === undefined) return undefined;
      [field_count, variant, down] = [unwrap(def.variants()[variant_]).fields.length, variant_, down_];
      break;
    }
    case "Tuple":
      [field_count, variant, down] = [kind._0.length, undefined, op];
      break;
    default:
      return bug(`cannot destructure mir constant ${debug_ConstValue(val, PLAIN)}`);
  }

  // `.map(..).collect::<Option<Vec<_>>>()?`
  const fields_iter: [ConstValue, Ty][] = [];
  for (let i = 0; i < field_count; i++) {
    const field_op = InterpResult.discard_err(ecx.project_field(down, FieldIdx.from_usize(i)));
    if (field_op === undefined) return undefined;
    const val_ = op_to_const(ecx, field_op, /* for diagnostics */ true);
    fields_iter.push([val_, field_op.layout.ty]);
  }
  const fields = /* tcx.arena.alloc_from_iter( */ fields_iter /* ) */;

  return { variant, fields };
}

/// Computes the tag (if any) for a given type and variant.
// #[instrument(skip(tcx), level = "debug")]
// rustc: compiler/rustc_const_eval/src/const_eval/mod.rs:70 tag_for_variant_provider
export function tag_for_variant_provider(tcx: TyCtxt, key: PseudoCanonicalInput<[Ty, VariantIdx]>): ScalarInt | undefined {
  const [ty, variant_index] = key.value;
  assert(ty.is_enum(), "assertion failed: ty.is_enum()");

  const ecx = InterpCx.new(tcx, DUMMY_SP, key.typing_env, new DummyMachine());

  const layout = unwrap_result(ecx.layout_of(ty), debug_InterpErrorKind);
  const r = InterpResult.unwrap(ecx.tag_for_variant(layout, variant_index));
  return r === undefined ? undefined : r[0];
}
