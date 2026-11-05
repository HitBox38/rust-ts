// Port of compiler/rustc_monomorphize/src/lib.rs (lane mono-collector).
//
// rustc_interface's `DEFAULT_QUERY_PROVIDERS` loads this module the first time one of these providers runs, so it is
// outside the module list of a run that reaches no codegen (rustc_interface passes.ts `rustc_monomorphize_provide`).
import * as partitioning from "./partitioning.ts";
import { debug_result, type Result, Err, Ok } from "../std/result.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import type { TyCtxtAt } from "../rustc_middle/query/calls.ts";
import type { CustomCoerceUnsized } from "../rustc_middle/ty/adjustment.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type CodegenObligationError, debug_CodegenObligationError, debug_ImplSource, type ImplSource } from "../rustc_middle/traits/mod.ts";
import { as_interner, TraitRef } from "../rustc_type_ir/predicate.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import * as collector from "./collector.ts";
import * as mono_checks from "./mono_checks/mod.ts";

// mod collector;
// mod diagnostics;      (generated: diagnostics.gen.ts, re-exported by diagnostics.ts)
// mod graph_checks;     (lane mono-partition)
// mod mono_checks;
// mod offload;          (no lane yet: collector.ts stops as UNPORTED under -Zoffload)
// mod partitioning;     (lane mono-partition)
// mod util;

// Exposed so `rustc_codegen_ssa::base::codegen_crate` can trigger the
// host-metadata manifest write.
// pub use offload::manifest::write_host_metadata_offload_manifest;   (no lane yet)

// rustc: compiler/rustc_monomorphize/src/lib.rs:27 custom_coerce_unsize_info
export function custom_coerce_unsize_info(tcx: TyCtxtAt, source_ty: Ty, target_ty: Ty): Result<CustomCoerceUnsized, ErrorGuaranteed> {
  const trait_ref = TraitRef.new(as_interner(tcx.tcx), tcx.tcx.require_lang_item("CoerceUnsized", tcx.span), [source_ty, target_ty]);

  const impl_source = tcx.codegen_select_candidate(TypingEnv.fully_monomorphized().as_query_input(trait_ref)) as Result<ImplSource<null>, CodegenObligationError>;
  if (impl_source.$ === "Ok" && impl_source._0.$ === "UserDefined") {
    const info = tcx.coerce_unsized_info(impl_source._0._0.impl_def_id);
    if (info.$ === "Err") return Err(info._0);
    const custom_kind = info._0.custom_kind;
    if (custom_kind === undefined) panic("called `Option::unwrap()` on a `None` value");
    return Ok(custom_kind);
  }
  panic(`invalid \`CoerceUnsized\` from ${display_Ty(source_ty)} to ${display_Ty(target_ty)}: impl_source: ${debug_result(impl_source, PLAIN, (v, f) => debug_ImplSource(v, f, () => "()"), debug_CodegenObligationError)}`);
}

// rustc: compiler/rustc_monomorphize/src/lib.rs:54 provide
export function provide(providers: Providers): void {
  partitioning.provide(providers);
  mono_checks.provide(providers.queries);
}
