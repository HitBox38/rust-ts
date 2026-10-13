// Port of compiler/rustc_attr_parsing/src/stability.rs
// `impl AttributeParser { fn check_attribute_stability }`: an extension module of interface.ts
// (PORTING §5 "Methods defined in another file"); lib.ts calls `install()` after loading interface.ts.
//
// PORT: `macro_rules! unstable` -> the function `unstable(sym.<feat>, ...notes)`. The macro's
// `_ = rustc_feature::Features::$feat;` is a compile-time check that the feature exists; it has no
// runtime effect and is not reproduced.
import type { AttrPath } from "../rustc_attr_ir/lib.ts";
import { display_AttrPath } from "../rustc_attr_ir/lib.ts";
import type { AttributeStability } from "../rustc_feature/lib.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { AttributeParser } from "./interface.ts";

/** `unstable!($feat $(, $notes)*)` */
export function unstable(feat: Symbol, ...notes: string[]): AttributeStability {
  return { $: "Unstable", gate_name: feat, notes };
}

declare module "./interface.ts" {
  interface AttributeParser {
    check_attribute_stability(attr_path: AttrPath, attr_span: Span, expected_stability: AttributeStability): void;
  }
}

// rustc: compiler/rustc_attr_parsing/src/stability.rs:22 check_attribute_stability
function check_attribute_stability(
  this: AttributeParser,
  attr_path: AttrPath,
  attr_span: Span,
  expected_stability: AttributeStability,
): void {
  if (this.should_emit.$ === "Nothing") {
    return;
  }

  if (expected_stability.$ !== "Unstable") {
    return;
  }
  const { gate_name, notes } = expected_stability;

  if (this.features().enabled(gate_name) || Span.allows_unstable(attr_span, gate_name)) {
    return;
  }

  let explain: string;
  let default_notes: readonly string[];
  switch (gate_name) {
    case sym.rustc_attrs:
      [explain, default_notes] = [
        "use of an internal attribute",
        [`the \`${display_AttrPath(attr_path)}\` attribute is an internal implementation detail that will never be stable`],
      ];
      break;
    case sym.staged_api:
      [explain, default_notes] = ["stability attributes may not be used outside of the standard library", []];
      break;
    case sym.custom_mir:
      [explain, default_notes] = ["the `custom_mir` attribute is just used for the Rust test suite", []];
      break;
    case sym.allow_internal_unsafe:
      [explain, default_notes] = ["the `allow_internal_unsafe` attribute side-steps the `unsafe_code` lint", []];
      break;
    case sym.allow_internal_unstable:
      [explain, default_notes] = ["the `allow_internal_unstable` attribute side-steps feature gating and stability checks", []];
      break;
    case sym.compiler_builtins:
      [explain, default_notes] = [
        "the `compiler_builtins` attribute is used to identify the `compiler_builtins` crate which contains compiler-rt intrinsics and will never be stable",
        [],
      ];
      break;
    case sym.custom_test_frameworks:
      [explain, default_notes] = ["custom test frameworks are an unstable feature", []];
      break;
    case sym.linkage:
      [explain, default_notes] = ["the `linkage` attribute is experimental and not portable across platforms", []];
      break;
    case sym.dropck_eyepatch:
      [explain, default_notes] = ["the `may_dangle` attribute has unstable semantics and may be removed in the future", []];
      break;
    case sym.intrinsics:
      [explain, default_notes] = ["the `rustc_intrinsic` attribute is used to declare intrinsics as function items", []];
      break;
    case sym.lang_items:
      [explain, default_notes] = ["lang items are subject to change", []];
      break;
    case sym.prelude_import:
      [explain, default_notes] = ["the `prelude_import` attribute is for use by rustc only", []];
      break;
    case sym.profiler_runtime:
      [explain, default_notes] = [
        "the `profiler_runtime` attribute is used to identify the `profiler_builtins` crate which contains the profiler runtime and will never be stable",
        [],
      ];
      break;
    case sym.thread_local:
      [explain, default_notes] = ["the `thread_local` attribute is an experimental feature, and does not currently handle destructors", []];
      break;
    case sym.rustdoc_internals:
      [explain, default_notes] = ["this subset of the `doc` attribute is meant for internal use only", []];
      break;
    case sym.doc_notable_trait:
      [explain, default_notes] = ["the `doc(notable_trait)` attribute is experimental", []];
      break;
    case sym.doc_cfg:
      [explain, default_notes] = ["the `doc(cfg)` and `doc(auto_cfg)` attributes are experimental", []];
      break;
    case sym.doc_masked:
      [explain, default_notes] = ["the `doc(masked)` attribute is experimental", []];
      break;
    default:
      [explain, default_notes] = [`the \`${display_AttrPath(attr_path)}\` attribute is an experimental feature`, []];
  }

  // For unstable subsets of an attribute, point at that
  const err_span =
    gate_name === sym.rustdoc_internals || gate_name === sym.doc_notable_trait || gate_name === sym.doc_cfg || gate_name === sym.doc_masked
      ? attr_span
      : attr_path.span;

  const diag = feature_err(this.sess_, gate_name, err_span, explain);

  // Remove the suggestion for `#![feature(staged_api)]` as these attributes are currently
  // not usable outside std. If we do ever expose `#[stable]` etc under a different feature
  // name then it would be unfortunate to have nightlies out there suggesting `staged_api`.
  if (gate_name === sym.staged_api) {
    diag.deref_mut().children.length = 0;
  }

  for (const note of default_notes) {
    diag.note(note);
  }
  for (const note of notes) {
    diag.note(note);
  }

  diag.emit();
}

// PORT (attr-parse-b): installed by `install()`, called from lib.ts: the attribute parser modules import
// `unstable` from here while context.ts (and interface.ts) are still evaluating their imports, so
// `AttributeParser` is not initialized when this module's body runs (see target_checking.ts).
export function install(): void {
  AttributeParser.prototype.check_attribute_stability = check_attribute_stability;
}
