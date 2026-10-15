// Port of compiler/rustc_codegen_ssa/src/diagnostics.rs.
//
// The types and their `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` impls are generated into
// diagnostics.gen.ts (tools/codegen/types.ts, set rustc_codegen_ssa). This file adds the hand-written impls
// (`impl Diagnostic`, `impl IntoDiagArg`, constructors) and the types the set skips:
// - `FeatureNotValid`, `CrossArchFeatureNote`, `FeatureNotValidHint`: PORT: written here in the generator's shape
//   because the generated `DiagSymbolList_into_diag_arg_with((x) => x)(..)` call cannot infer `S` for a
//   `DiagSymbolList<&str>` field (tsc TS2322); the only change is the typed lambda `(x: string) => x`.
// - The linker / incremental / intrinsic diagnostics whose field types are not ported (`IncorrectCguReuseType`,
//   `LinkingFailed`, `ProcessingDymutilFailed`, `StrippingDebugInfoFailed`, `InvalidMonomorphization`,
//   `FailedToGetLayout`) are not generated; their manual impls stop as `unported(..)`.
import { DiagSymbolList_into_diag_arg_with } from "../rustc_attr_parsing/diagnostics.ts";
import { str_into_diag_arg, String_into_diag_arg, number_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { MutRef } from "../rustc_span/hygiene.ts";
import { type DiagSymbolList } from "../rustc_errors/diagnostic_impls.ts";
import { Diag, type DiagArgMap, type DiagArgValue, type DiagCtxtHandle, type Diagnostic, format_diag_message, IntoDiagArg, type Level, type Subdiagnostic } from "../rustc_errors/lib.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { type Span } from "../rustc_span/lib.ts";
import { debug_str } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import * as gen from "./diagnostics.gen.ts";
import { type DebugArgPath, type ExpectedPointerMutability, type LinkExeStatusStackBufferOverrun, MissingFeatures_subdiagnostic, type TargetFeatureDisableOrEnable, type ThorinErrorWrapper } from "./diagnostics.gen.ts";

export * from "./diagnostics.gen.ts";

export type CopyPath = gen.CopyPath;
export type MissingNativeLibrary = gen.MissingNativeLibrary;

// impl<'a> CopyPath<'a>
export const CopyPath = {
  // rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:129 new
  new(from: string, to: string, error: CopyPath["error"]): CopyPath {
    return { from: { _0: from }, to: { _0: to }, error };
  },
} as const;

// impl IntoDiagArg for DebugArgPath<'_>
// PORT: `format!("{:?}", path)`: `<Path as Debug>` is the `OsStr` Debug, which for the UTF-8 paths a JS string holds
// is the `str` Debug.
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:137 into_diag_arg
export function DebugArgPath_into_diag_arg(self: DebugArgPath, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return { $: "Str", _0: debug_str(self._0) };
}

// impl Diagnostic<'_> for ThorinErrorWrapper
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:206 into_diag
export function ThorinErrorWrapper_into_diag(_self: ThorinErrorWrapper, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_codegen_ssa::diagnostics::ThorinErrorWrapper::into_diag (thorin::Error, split DWARF; not ported)");
}

// impl Diagnostic<'_> for LinkingFailed<'_>
// PORT: `LinkingFailed` is skipped by the codegen set (fields `ExitStatus` / `back::command::Command`, linker).
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:338 into_diag
export function LinkingFailed_into_diag(_self: unknown, _dcx: DiagCtxtHandle, _level: Level): Diag {
  return unported("rustc_codegen_ssa::diagnostics::LinkingFailed::into_diag (linker; not ported)");
}

// impl<'a> Diagnostic<'a> for LinkExeStatusStackBufferOverrun
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:467 into_diag
export function LinkExeStatusStackBufferOverrun_into_diag(_self: LinkExeStatusStackBufferOverrun, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "0xc0000409 is `STATUS_STACK_BUFFER_OVERRUN`" });
  diag.note({ $: "Inline", _0: "this may have been caused by a program abort and not a stack buffer overrun" });
  diag.note({ $: "Inline", _0: "consider checking the Application Event Log for Windows Error Reporting events to see the fail fast error code" });
  return diag;
}
/** `LinkExeStatusStackBufferOverrun` as a `Diagnostic` trait object. */
export function LinkExeStatusStackBufferOverrun_diagnostic(self: LinkExeStatusStackBufferOverrun): Diagnostic {
  return { into_diag: (dcx, level) => LinkExeStatusStackBufferOverrun_into_diag(self, dcx, level) };
}

// impl IntoDiagArg for ExpectedPointerMutability
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:1078 into_diag_arg
export function ExpectedPointerMutability_into_diag_arg(self: ExpectedPointerMutability, _: MutRef<PathBuf | undefined>): DiagArgValue {
  switch (self) {
    case "Mut":
      return { $: "Str", _0: "*mut" };
    case "Not":
      return { $: "Str", _0: "*_" };
  }
}

// impl Diagnostic<'_> for TargetFeatureDisableOrEnable<'_>
// rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:1269 into_diag
export function TargetFeatureDisableOrEnable_into_diag(self: TargetFeatureDisableOrEnable, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "the target features {$features} must all be either enabled or disabled together" });
  if (self.span !== undefined) {
    const span = self.span;
    diag.span(span);
  }
  if (self.missing_features !== undefined) {
    const missing_features = self.missing_features;
    diag.subdiagnostic(MissingFeatures_subdiagnostic(missing_features));
  }
  diag.arg("features", IntoDiagArg.of(self.features.join(", "), String_into_diag_arg));
  return diag;
}
/** `TargetFeatureDisableOrEnable` as a `Diagnostic` trait object. */
export function TargetFeatureDisableOrEnable_diagnostic(self: TargetFeatureDisableOrEnable): Diagnostic {
  return { into_diag: (dcx, level) => TargetFeatureDisableOrEnable_into_diag(self, dcx, level) };
}

// rustc-type: compiler/rustc_codegen_ssa/src/diagnostics.rs:1288 FeatureNotValid
export interface FeatureNotValid {
  feature: string;
  span: Span;
  hint: FeatureNotValidHint;
  cross_arch: CrossArchFeatureNote | undefined;
}
/** `#[derive(Diagnostic)]`: `impl<'_sess> Diagnostic<'_sess> for FeatureNotValid` (generator shape; see the header). */
export function FeatureNotValid_into_diag(self: FeatureNotValid, dcx: DiagCtxtHandle, level: Level): Diag {
  const { feature: __binding_0, span: __binding_1, hint: __binding_2, cross_arch: __binding_3 } = self;
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "the feature named `{$feature}` is not valid for this target" });
  diag.arg("feature", IntoDiagArg.of(__binding_0, str_into_diag_arg));
  diag.span(__binding_1);
  diag.span_label(__binding_1, { $: "Inline", _0: "`{$feature}` is not valid for this target" });
  diag.subdiagnostic(FeatureNotValidHint_subdiagnostic(__binding_2));
  if (__binding_3 !== undefined) {
    diag.subdiagnostic(CrossArchFeatureNote_subdiagnostic(__binding_3));
  }
  return diag;
}
/** `FeatureNotValid` as a `Diagnostic` trait object. */
export function FeatureNotValid_diagnostic(self: FeatureNotValid): Diagnostic {
  return { into_diag: (dcx, level) => FeatureNotValid_into_diag(self, dcx, level) };
}

// rustc-type: compiler/rustc_codegen_ssa/src/diagnostics.rs:1300 CrossArchFeatureNote
export type CrossArchFeatureNote =
  | { readonly $: "Single"; feature: string; arch: string }
  | { readonly $: "Multiple"; feature: string; arches: DiagSymbolList<string> };
/** `#[derive(Subdiagnostic)]`: `impl Subdiagnostic for CrossArchFeatureNote` (generator shape; see the header). */
export function CrossArchFeatureNote_add_to_diag(self: CrossArchFeatureNote, diag: Diag): void {
  switch (self.$) {
    case "Single": {
      const { feature: __binding_0, arch: __binding_1 } = self;
      const sub_args: DiagArgMap = new Map();
      sub_args.set("feature", str_into_diag_arg(__binding_0, diag.long_ty_path()));
      sub_args.set("arch", str_into_diag_arg(__binding_1, diag.long_ty_path()));
      const __message = format_diag_message(
        { $: "Inline", _0: "`{$feature}` is present on the `{$arch}` target architecture. Did you mean to compile for that target, or use conditional compilation?" },
        sub_args,
      );
      diag.note(__message);
      return;
    }
    case "Multiple": {
      const { feature: __binding_0, arches: __binding_1 } = self;
      const sub_args: DiagArgMap = new Map();
      sub_args.set("feature", str_into_diag_arg(__binding_0, diag.long_ty_path()));
      sub_args.set("arches", DiagSymbolList_into_diag_arg_with((x: string) => x)(__binding_1, diag.long_ty_path()));
      const __message = format_diag_message(
        {
          $: "Inline",
          _0: "`{$feature}` is present on the {$arches} target architectures. Did you mean to compile for one of those targets, or use conditional compilation?",
        },
        sub_args,
      );
      diag.note(__message);
      return;
    }
  }
}
/** `CrossArchFeatureNote` as a `Subdiagnostic` trait object. */
export function CrossArchFeatureNote_subdiagnostic(self: CrossArchFeatureNote): Subdiagnostic {
  return { add_to_diag: (diag) => CrossArchFeatureNote_add_to_diag(self, diag) };
}

// rustc-type: compiler/rustc_codegen_ssa/src/diagnostics.rs:1312 FeatureNotValidHint
export type FeatureNotValidHint =
  | { readonly $: "RemovePlusFromFeatureName"; span: Span; stripped: string }
  | { readonly $: "ValidFeatureNames"; possibilities: DiagSymbolList<string>; and_more: number };
/** `#[derive(Subdiagnostic)]`: `impl Subdiagnostic for FeatureNotValidHint` (generator shape; see the header). */
export function FeatureNotValidHint_add_to_diag(self: FeatureNotValidHint, diag: Diag): void {
  switch (self.$) {
    case "RemovePlusFromFeatureName": {
      const { span: __binding_0, stripped: __binding_1 } = self;
      const __code_0 = ['enable = "' + __binding_1 + '"'];
      const sub_args: DiagArgMap = new Map();
      const __message = format_diag_message({ $: "Inline", _0: "consider removing the leading `+` in the feature name" }, sub_args);
      diag.span_suggestions_with_style(__binding_0, __message, __code_0, "MaybeIncorrect", "ShowAlways");
      return;
    }
    case "ValidFeatureNames": {
      const { possibilities: __binding_0, and_more: __binding_1 } = self;
      const sub_args: DiagArgMap = new Map();
      sub_args.set("possibilities", DiagSymbolList_into_diag_arg_with((x: string) => x)(__binding_0, diag.long_ty_path()));
      sub_args.set("and_more", number_into_diag_arg(__binding_1, diag.long_ty_path()));
      const __message = format_diag_message(
        { $: "Inline", _0: 'valid names are: {$possibilities}{$and_more ->\n            [0] {""}\n            *[other] {" "}and {$and_more} more\n        }' },
        sub_args,
      );
      diag.help(__message);
      return;
    }
  }
}
/** `FeatureNotValidHint` as a `Subdiagnostic` trait object. */
export function FeatureNotValidHint_subdiagnostic(self: FeatureNotValidHint): Subdiagnostic {
  return { add_to_diag: (diag) => FeatureNotValidHint_add_to_diag(self, diag) };
}

// impl<'a> MissingNativeLibrary<'a>
export const MissingNativeLibrary = {
  // rustc: compiler/rustc_codegen_ssa/src/diagnostics.rs:1359 new
  new(libname: string, verbatim: boolean): MissingNativeLibrary {
    // if it looks like the user has provided a complete filename rather just the bare lib name,
    // then provide a note that they might want to try trimming the name
    let suggested_name: string | undefined;
    if (!verbatim) {
      // PORT: `str::strip_circumfix("lib", ".a")` / `strip_suffix(".lib")`.
      if (libname.startsWith("lib") && libname.endsWith(".a") && libname.length >= "lib".length + ".a".length) {
        // this is a unix style filename so trim prefix & suffix
        suggested_name = libname.slice("lib".length, libname.length - ".a".length);
      } else if (libname.endsWith(".lib")) {
        // this is a Windows style filename so just trim the suffix
        suggested_name = libname.slice(0, libname.length - ".lib".length);
      } else {
        suggested_name = undefined;
      }
    } else {
      suggested_name = undefined;
    }

    return {
      libname,
      suggest_name: suggested_name === undefined ? undefined : { suggested_name },
    };
  },
} as const;
