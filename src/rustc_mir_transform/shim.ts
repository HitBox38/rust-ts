// Stub module (lane mt-shim): compiler/rustc_mir_transform/src/shim.rs is not ported yet.
// Lane mt-skeleton declared only what lib.rs / pass_manager.rs reference (docs/handoff/mt-skeleton.md, "Module
// layout"); the porting lane replaces this file with the whole port, keeping these names and shapes. Every stub stops
// as UNPORTED with its upstream path.
// merge-w22b ported `build_adt_ctor` with its helpers `local_decls_for_sig` / `new_body` ahead of the lane
// (`mir_for_ctfe` of every constructor reaches it; the mirdump suites print it).
import { panic, unported } from "../std/panic.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import {
  BasicBlockData,
  Body,
  Local,
  LocalDecl,
  type MirSource,
  MirSource as MirSourceC,
  Place,
  Place_from_Local,
  SourceInfo,
  SourceScopeData,
  Statement,
  Terminator,
} from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { FIRST_VARIANT } from "../rustc_abi/layout.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { type FnSig, FnSig as FnSigC, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../std/fmt.ts";
import { run_passes_no_validate } from "./pass_manager.ts";

// stub: compiler/rustc_mir_transform/src/shim.rs:28 provide (lane mt-shim)
// Not ported yet: sets nothing, so `mir_shims` keep rustc_interface's default `unported("<query> provider (not
// ported)")` providers (passes.ts `install_unported_providers`).
export function provide(_providers: Providers["queries"]): void {}

// rustc: compiler/rustc_mir_transform/src/shim.rs:245 local_decls_for_sig
function local_decls_for_sig(sig: FnSig, span: Span): LocalDecl[] {
  return [LocalDecl.new(FnSigC.output(sig), span), ...FnSigC.inputs(sig).map((ity) => LocalDecl.new(ity, span).immutable())];
}

// stub: compiler/rustc_mir_transform/src/shim.rs:258 build_drop_shim (lane mt-shim)
export function build_drop_shim(_tcx: TyCtxt, _def_id: DefId, _ty: Ty | undefined, _typing_env: TypingEnv): Body {
  return unported("rustc_mir_transform::shim::build_drop_shim");
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:367 new_body
function new_body(source: MirSource, basic_blocks: BasicBlockData[], local_decls: LocalDecl[], arg_count: number, span: Span): Body {
  const body = Body.new(
    source,
    basic_blocks,
    [new SourceScopeData(span, undefined, undefined, undefined, { $: "Clear" })],
    local_decls,
    [],
    arg_count,
    [],
    span,
    undefined,
    // FIXME(compiler-errors): is this correct?
    undefined,
  );
  // Shims do not directly mention any consts.
  body.set_required_consts([]);
  return body;
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:994 build_adt_ctor
export function build_adt_ctor(tcx: TyCtxt, ctor_id: DefId): Body {
  // debug_assert!(tcx.is_constructor(ctor_id));

  const typing_env = TypingEnv.post_analysis(tcx, ctor_id);

  // Normalize the sig.
  // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts (`EarlyBinder<Binder<FnSig>>`).
  const sig_ = Binder.no_bound_vars(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(ctor_id) as EarlyBinder<Binder<FnSig>>)),
    fold_FnSig,
  );
  if (sig_ === undefined) panic("LBR in ADT constructor signature");
  const sig = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(sig_), fold_FnSig);

  const output_kind = FnSigC.output(sig).kind();
  if (output_kind.$ !== "Adt") {
    return bug(`unexpected type for ADT ctor ${debug_Ty(FnSigC.output(sig), PLAIN)}`);
  }
  const adt_def = output_kind._0;
  const args = output_kind._1;

  // debug!("build_ctor: ctor_id={:?} sig={:?}", ctor_id, sig);

  const span = tcx.def_span(ctor_id);

  const local_decls = local_decls_for_sig(sig, span);

  const source_info = SourceInfo.outermost(span);

  const variant_index = adt_def.is_enum() ? adt_def.variant_index_with_ctor_id(ctor_id) : FIRST_VARIANT;

  // Generate the following MIR:
  //
  // (return as Variant).field0 = arg0;
  // (return as Variant).field1 = arg1;
  //
  // return;
  // debug!("build_ctor: variant_index={:?}", variant_index);

  const variant = adt_def.variant(variant_index);
  const statement = Statement.new(source_info, {
    $: "Assign",
    _0: [
      Place.return_place(),
      {
        $: "Aggregate",
        _0: { $: "Adt", _0: adt_def.did(), _1: variant_index, _2: args, _3: undefined, _4: undefined },
        _1: variant.fields.map((_f, idx) => ({ $: "Move" as const, _0: Place_from_Local(Local.arg(idx)) })),
      },
    ],
  });

  const start_block = BasicBlockData.new_stmts([statement], new Terminator(source_info, { $: "Return" }), false);

  const source = MirSourceC.item(ctor_id);
  const body = new_body(source, [start_block], local_decls, FnSigC.inputs(sig).length, span);
  // A constructor doesn't mention any other items (and we don't run the usual optimization passes
  // so this would otherwise not get filled).
  body.set_mentioned_items([]);

  // We don't pass any passes here, we just force a phase change to `Optimized`.
  // Otherwise this bit of MIR will trigger assertions trying to detect MIR with an invalid phase.
  run_passes_no_validate(tcx, body, [], { $: "Runtime", _0: "Optimized" });

  return body;
}
