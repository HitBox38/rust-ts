// Port of compiler/rustc_metadata/src/diagnostics.rs.
//
// The `#[derive(Diagnostic)]` types are generated into diagnostics.gen.ts (tools/codegen/types.ts, set
// `rustc_metadata`). The three hand-written `impl Diagnostic` (`MultipleCandidates` :308,
// `InvalidMetadataFiles` :421, `CannotFindCrate` :453) are below, with their structs; the locator's error
// reporting (`CrateError::report`) is their only user.
import { str_into_diag_arg, String_into_diag_arg, Symbol_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, E0463, E0464, E0786, IntoDiagArg, type Level } from "../rustc_errors/lib.ts";
import { Span, type PathBuf } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { type CrateFlavor, CrateFlavor_into_diag_arg } from "./locator.ts";

export * from "./diagnostics.gen.ts";

// PORT: `env!("CFG_RELEASE_CHANNEL")` of the oracle toolchain (as in rustc_driver_impl/lib.ts).
const CFG_RELEASE_CHANNEL: string = "nightly";

export interface MultipleCandidates {
  span: Span;
  flavor: CrateFlavor;
  crate_name: Symbol;
  candidates: PathBuf[];
}

/** `impl Diagnostic<'_> for MultipleCandidates` */
// rustc: compiler/rustc_metadata/src/diagnostics.rs:309 into_diag
export function MultipleCandidates_into_diag(self: MultipleCandidates, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "multiple candidates for `{$flavor}` dependency `{$crate_name}` found" });
  diag.arg("crate_name", IntoDiagArg.of(self.crate_name, Symbol_into_diag_arg));
  diag.arg("flavor", IntoDiagArg.of(self.flavor, CrateFlavor_into_diag_arg));
  diag.code(E0464);
  diag.span(self.span);
  for (const [i, candidate] of self.candidates.entries()) {
    diag.note(`candidate #${i + 1}: ${candidate}`);
  }
  return diag;
}
/** `MultipleCandidates` as a `Diagnostic` trait object. */
export function MultipleCandidates_diagnostic(self: MultipleCandidates): Diagnostic {
  return { into_diag: (dcx, level) => MultipleCandidates_into_diag(self, dcx, level) };
}

export interface InvalidMetadataFiles {
  span: Span;
  crate_name: Symbol;
  add_info: string;
  crate_rejections: string[];
}

/** `impl Diagnostic<'_> for InvalidMetadataFiles` */
// rustc: compiler/rustc_metadata/src/diagnostics.rs:423 into_diag
export function InvalidMetadataFiles_into_diag(self: InvalidMetadataFiles, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "found invalid metadata files for crate `{$crate_name}`{$add_info}" });
  diag.arg("crate_name", IntoDiagArg.of(self.crate_name, Symbol_into_diag_arg));
  diag.arg("add_info", IntoDiagArg.of(self.add_info, String_into_diag_arg));
  diag.code(E0786);
  diag.span(self.span);
  for (const crate_rejection of self.crate_rejections) {
    diag.note(crate_rejection);
  }
  return diag;
}
/** `InvalidMetadataFiles` as a `Diagnostic` trait object. */
export function InvalidMetadataFiles_diagnostic(self: InvalidMetadataFiles): Diagnostic {
  return { into_diag: (dcx, level) => InvalidMetadataFiles_into_diag(self, dcx, level) };
}

export interface CannotFindCrate {
  span: Span;
  crate_name: Symbol;
  add_info: string;
  missing_core: boolean;
  current_crate: string;
  is_nightly_build: boolean;
  profiler_runtime: Symbol;
  locator_triple: TargetTuple;
  is_ui_testing: boolean;
  is_tier_3: boolean;
}

/** `impl Diagnostic<'_> for CannotFindCrate` */
// rustc: compiler/rustc_metadata/src/diagnostics.rs:455 into_diag
export function CannotFindCrate_into_diag(self: CannotFindCrate, dcx: DiagCtxtHandle, level: Level): Diag {
  const diag = Diag.new(dcx, level, { $: "Inline", _0: "can't find crate for `{$crate_name}`{$add_info}" });
  diag.arg("crate_name", IntoDiagArg.of(self.crate_name, Symbol_into_diag_arg));
  diag.arg("current_crate", IntoDiagArg.of(self.current_crate, String_into_diag_arg));
  diag.arg("add_info", IntoDiagArg.of(self.add_info, String_into_diag_arg));
  diag.arg("locator_triple", IntoDiagArg.of(TargetTuple.tuple(self.locator_triple), str_into_diag_arg));
  diag.code(E0463);
  diag.span(self.span);
  if (self.crate_name === sym.std || self.crate_name === sym.core) {
    if (self.missing_core) {
      diag.note({ $: "Inline", _0: "the `{$locator_triple}` target may not be installed" });
    } else {
      diag.note({ $: "Inline", _0: "the `{$locator_triple}` target may not support the standard library" });
    }

    const has_precompiled_std = !self.is_tier_3;

    if (self.missing_core) {
      if (CFG_RELEASE_CHANNEL === "dev" && !self.is_ui_testing) {
        // Note: Emits the nicer suggestion only for the dev channel.
        diag.help({ $: "Inline", _0: "consider adding the standard library to the sysroot with `x build library --target {$locator_triple}`" });
      } else if (has_precompiled_std) {
        // NOTE: this suggests using rustup, even though the user may not have it installed.
        // That's because they could choose to install it; or this may give them a hint which
        // target they need to install from their distro.
        diag.help({ $: "Inline", _0: "consider downloading the target with `rustup target add {$locator_triple}`" });
      }
    }

    // Suggest using #![no_std]. #[no_core] is unstable and not really supported anyway.
    // NOTE: this is a dummy span if `extern crate std` was injected by the compiler.
    // If it's not a dummy, that means someone added `extern crate std` explicitly and
    // `#![no_std]` won't help.
    if (!self.missing_core && Span.is_dummy(self.span)) {
      diag.note({ $: "Inline", _0: "`std` is required by `{$current_crate}` because it does not declare `#![no_std]`" });
    }
    // Recommend -Zbuild-std even on stable builds for Tier 3 targets because
    // it's the recommended way to use the target, the user should switch to nightly.
    if (self.is_nightly_build || !has_precompiled_std) {
      diag.help({ $: "Inline", _0: "consider building the standard library from source with `cargo build -Zbuild-std`" });
    }
  } else if (self.crate_name === self.profiler_runtime) {
    diag.note({ $: "Inline", _0: "the compiler may have been built without the profiler runtime" });
  } else if (Symbol.as_str(self.crate_name).startsWith("rustc_")) {
    diag.help({ $: "Inline", _0: "maybe you need to install the missing components with: `rustup component add rust-src rustc-dev llvm-tools-preview`" });
  }
  diag.span_label(self.span, { $: "Inline", _0: "can't find crate" });
  return diag;
}
/** `CannotFindCrate` as a `Diagnostic` trait object. */
export function CannotFindCrate_diagnostic(self: CannotFindCrate): Diagnostic {
  return { into_diag: (dcx, level) => CannotFindCrate_into_diag(self, dcx, level) };
}
