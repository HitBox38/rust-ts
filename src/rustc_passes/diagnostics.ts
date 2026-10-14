// Port of compiler/rustc_passes/src/diagnostics.rs: the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set rustc_passes);
// the manual `impl Diagnostic` blocks are ported here.
import { bool_into_diag_arg, PathBuf_into_diag_arg, String_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { DiagMessage } from "../rustc_error_messages/lib.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0152, E0601, IntoDiagArg, type Level } from "../rustc_errors/lib.ts";
import { MainDefinition } from "../rustc_middle/middle/resolve.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import type { DuplicateLangItem, NoMainErr } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

// impl<'a> Diagnostic<'a> for NoMainErr
// #[track_caller]
// rustc: compiler/rustc_passes/src/diagnostics.rs:328 into_diag
export function NoMainErr_into_diag(self: NoMainErr, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "`main` function not found in crate `{$crate_name}`" });
  diag.span(DUMMY_SP);
  diag.code(E0601);
  diag.arg("crate_name", IntoDiagArg.of(self.crate_name, Symbol_into_diag_arg));
  diag.arg("filename", IntoDiagArg.of(self.filename, PathBuf_into_diag_arg));
  diag.arg("has_filename", IntoDiagArg.of(self.has_filename, bool_into_diag_arg));
  let note: DiagMessage;
  if (self.non_main_fns.length !== 0) {
    for (const span of self.non_main_fns) {
      diag.span_note(span, { $: "Inline", _0: "here is a function named `main`" });
    }
    diag.note({ $: "Inline", _0: "you have one or more functions named `main` not defined at the crate level" });
    diag.help({ $: "Inline", _0: "consider moving the `main` function definitions" });
    // There were some functions named `main` though. Try to give the user a hint.
    note = {
      $: "Inline",
      _0:
        "the main function must be defined at the crate level{$has_filename ->\n" +
        '                    [true] {" "}(in `{$filename}`)\n' +
        '                    *[false] {""}\n' +
        "                }",
    };
  } else if (self.has_filename) {
    note = { $: "Inline", _0: "consider adding a `main` function to `{$filename}`" };
  } else {
    note = { $: "Inline", _0: "consider adding a `main` function at the crate level" };
  }
  if (self.file_empty) {
    diag.note(note);
  } else {
    diag.span(Span.shrink_to_hi(self.sp));
    diag.span_label(Span.shrink_to_hi(self.sp), note);
  }

  if (self.main_def_opt !== undefined && MainDefinition.opt_fn_def_id(self.main_def_opt) === undefined) {
    const main_def = self.main_def_opt;
    // There is something at `crate::main`, but it is not a function definition.
    diag.span_label(main_def.span, { $: "Inline", _0: "non-function item at `crate::main` is found" });
  }

  if (self.add_teach_note) {
    diag.note({
      $: "Inline",
      _0: "if you don't know the basics of Rust, you can go look to the Rust Book to get started: https://doc.rust-lang.org/book/",
    });
  }

  return diag;
}
/** `NoMainErr` as a `Diagnostic` trait object. */
export function NoMainErr_diagnostic(self: NoMainErr): Diagnostic {
  return { into_diag: (dcx, level) => NoMainErr_into_diag(self, dcx, level) };
}

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
