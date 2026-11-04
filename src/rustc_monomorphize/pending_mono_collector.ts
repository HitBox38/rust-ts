// Not an upstream mirror. PORT(contract): pending mono-collector. Stand-ins for what partitioning.rs and graph_checks
// use from the files of lane mono-collector (collector.rs) and from diagnostics.rs, with upstream's signatures. When
// that lane merges: delete this file, and point the imports of partitioning.ts and graph_checks/{mod,statics}.ts at
// ./collector.ts and ./diagnostics.ts (docs/handoff/mono-partition.md lists each item).
//
// `collector` is a mutable object only so that the oracle driver (oracle/run.ts) can stand in for the real collector
// until then; on the compiler's own path, `collect_crate_mono_items` stops at `unported`.
import { str_into_diag_arg, String_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, IntoDiagArg, type Level } from "../rustc_errors/lib.ts";
import type { MonoItem } from "../rustc_middle/mono.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { KeyedMap } from "../rust_ts/keyed.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unported } from "../std/panic.ts";

// PORT(contract): pending mono-collector. compiler/rustc_monomorphize/src/collector.rs:243
export type MonoItemCollectionStrategy = "Eager" | "Lazy";

// PORT(contract): pending mono-collector. compiler/rustc_monomorphize/src/collector.rs:259 `pub(crate) struct UsageMap`
// with `pub used_map`, `pub(crate) fn get_user_items` (:284) and `pub(crate) fn for_each_inlined_used_item` (:289).
// `used_map` is keyed by `MonoItem` by value: `new KeyedMap(key_MonoItem)` (rustc_middle/mono.ts).
export interface UsageMap {
  // Maps every mono item to the mono items used by it.
  used_map: KeyedMap<MonoItem, MonoItem[]>;
  get_user_items(item: MonoItem): readonly MonoItem[];
  /// Internally iterate over all inlined items used by `item`.
  for_each_inlined_used_item(tcx: TyCtxt, item: MonoItem, f: (item: MonoItem) => void): void;
}

// PORT(contract): pending mono-collector. compiler/rustc_monomorphize/src/collector.rs:1916 collect_crate_mono_items,
// :1961 provide.
export const collector = {
  collect_crate_mono_items(_tcx: TyCtxt, _strategy: MonoItemCollectionStrategy): [MonoItem[], UsageMap] {
    return unported("rustc_monomorphize::collector::collect_crate_mono_items (pending mono-collector)");
  },
  provide(_providers: Providers): void {},
};

// PORT(contract): pending mono-collector. diagnostics.rs is assigned to no lane; its `#[derive(Diagnostic)]` structs
// are generated (tools/codegen, set to be added by root). These three are written out by hand, in the generator's shape.

// compiler/rustc_monomorphize/src/diagnostics.rs:41 SymbolAlreadyDefined
export interface SymbolAlreadyDefined {
  span: Span | undefined;
  symbol: string;
}
export function SymbolAlreadyDefined_diagnostic(self: SymbolAlreadyDefined): Diagnostic {
  return {
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const diag = Diag.new(dcx, level, { $: "Inline", _0: "symbol `{$symbol}` is already defined" });
      diag.arg("symbol", IntoDiagArg.of(self.symbol, String_into_diag_arg));
      if (self.span !== undefined) {
        diag.span(self.span);
      }
      return diag;
    },
  };
}

// compiler/rustc_monomorphize/src/diagnostics.rs:49 CouldntDumpMonoStats
export interface CouldntDumpMonoStats {
  error: string;
}
export function CouldntDumpMonoStats_diagnostic(self: CouldntDumpMonoStats): Diagnostic {
  return {
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const diag = Diag.new(dcx, level, { $: "Inline", _0: "unexpected error occurred while dumping monomorphization stats: {$error}" });
      diag.arg("error", IntoDiagArg.of(self.error, String_into_diag_arg));
      return diag;
    },
  };
}

// compiler/rustc_monomorphize/src/diagnostics.rs:212 StaticInitializerCyclic
export interface StaticInitializerCyclic {
  span: Span;
  labels: Span[];
  head: string;
  target: string;
}
export function StaticInitializerCyclic_diagnostic(self: StaticInitializerCyclic): Diagnostic {
  return {
    into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
      const diag = Diag.new(dcx, level, { $: "Inline", _0: "static initializer forms a cycle involving `{$head}`" });
      diag.note({ $: "Inline", _0: "cyclic static initializers are not supported for target `{$target}`" });
      diag.arg("head", IntoDiagArg.of(self.head, str_into_diag_arg));
      diag.arg("target", IntoDiagArg.of(self.target, str_into_diag_arg));
      diag.span(self.span);
      for (const label of self.labels) {
        diag.span_label(label, { $: "Inline", _0: "part of this cycle" });
      }
      return diag;
    },
  };
}
