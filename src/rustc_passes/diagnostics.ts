// Port of compiler/rustc_passes/src/diagnostics.rs: the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_passes);
// the manual `impl Diagnostic` blocks are ported here.
import { String_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0152, IntoDiagArg, type Level } from "../rustc_errors/lib.ts";
import type { DuplicateLangItem } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// impl<'a> Diagnostic<'a> for NoMainErr
// (diagnostics.rs:328 into_diag: not ported; rustc_passes::entry is lane passes-a)

// impl Diagnostic<'_> for DuplicateLangItem
// #[track_caller]
// rustc: compiler/rustc_passes/src/diagnostics.rs:394 into_diag
export function DuplicateLangItem_into_diag(self: DuplicateLangItem, dcx: DiagCtxtHandle, level: Level): Diag {
  let msg: string;
  switch (self.duplicate) {
    case "Plain":
      msg = "found duplicate lang item `{$lang_item_name}`";
      break;
    case "Crate":
      msg = "duplicate lang item in crate `{$crate_name}`: `{$lang_item_name}`";
      break;
    case "CrateDepends":
      msg = "duplicate lang item in crate `{$crate_name}` (which `{$dependency_of}` depends on): `{$lang_item_name}`";
      break;
  }
  const diag = Diag.new(dcx, level, { $: "Inline", _0: msg });
  diag.code(E0152);
  diag.arg("lang_item_name", IntoDiagArg.of(self.lang_item_name, Symbol_into_diag_arg));
  diag.arg("crate_name", IntoDiagArg.of(self.crate_name, Symbol_into_diag_arg));
  if (self.dependency_of !== undefined) {
    diag.arg("dependency_of", IntoDiagArg.of(self.dependency_of, Symbol_into_diag_arg));
  }
  diag.arg("path", IntoDiagArg.of(self.path, String_into_diag_arg));
  if (self.orig_crate_name !== undefined) {
    diag.arg("orig_crate_name", IntoDiagArg.of(self.orig_crate_name, Symbol_into_diag_arg));
  }
  if (self.orig_dependency_of !== undefined) {
    diag.arg("orig_dependency_of", IntoDiagArg.of(self.orig_dependency_of, Symbol_into_diag_arg));
  }
  diag.arg("orig_path", IntoDiagArg.of(self.orig_path, String_into_diag_arg));
  if (self.local_span !== undefined) {
    diag.span(self.local_span);
  }
  if (self.first_defined_span !== undefined) {
    diag.span_note(self.first_defined_span, { $: "Inline", _0: "the lang item is first defined here" });
  } else {
    if (self.orig_dependency_of === undefined) {
      diag.note({ $: "Inline", _0: "the lang item is first defined in crate `{$orig_crate_name}`" });
    } else {
      diag.note({ $: "Inline", _0: "the lang item is first defined in crate `{$orig_crate_name}` (which `{$orig_dependency_of}` depends on)" });
    }

    if (self.orig_is_local) {
      diag.note({ $: "Inline", _0: "first definition in the local crate (`{$orig_crate_name}`)" });
    } else {
      diag.note({ $: "Inline", _0: "first definition in `{$orig_crate_name}` loaded from {$orig_path}" });
    }

    if (self.is_local) {
      diag.note({ $: "Inline", _0: "second definition in the local crate (`{$crate_name}`)" });
    } else {
      diag.note({ $: "Inline", _0: "second definition in `{$crate_name}` loaded from {$path}" });
    }
  }
  return diag;
}
/** `DuplicateLangItem` as a `Diagnostic` trait object. */
export function DuplicateLangItem_diagnostic(self: DuplicateLangItem): Diagnostic {
  return { into_diag: (dcx, level) => DuplicateLangItem_into_diag(self, dcx, level) };
}
