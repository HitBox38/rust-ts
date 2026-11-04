// Port of compiler/rustc_monomorphize/src/lib.rs (lane mono-collector).
//
// Nothing outside this crate calls `provide` yet (M7 groundwork, plan-m6 section 5): rustc_interface's
// `DEFAULT_QUERY_PROVIDERS` does not list it, so every path the protected suites run keeps today's UNPORTED stops. The
// oracle test driver collector_oracle/run.ts installs it through `override_queries`.
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
  // PORT(contract): pending mono-partition. Upstream calls `partitioning::provide(providers)` here, and that fn ends with
  // `collector::provide(providers)` (partitioning.rs:1395). At the merge this line becomes `partitioning.provide(providers)`.
  collector.provide(providers);
  mono_checks.provide(providers.queries);
}
