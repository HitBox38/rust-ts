// Port of annotate-snippets =0.12.16 `src/lib.rs`, with the features rustc enables
// (compiler/rustc_errors/Cargo.toml: default `std` + `simd`; `testing-colors` off).
//
//! Format [diagnostic reports][Report], including highlighting snippets of text
//!
//! (Upstream's crate docs — an example and a visual overview rendered from `examples/` — are not
//! repeated here.)
//!
//! # Cargo `features`
//!
//! - `simd` - Speeds up folding
//!
//! - `testing-colors` - Makes [Renderer::styled] colors OS independent, which
//! allows for easier testing when testing colored output. It should be added as
//! a feature in `[dev-dependencies]`, which can be done with the following command:
//! ```text
//! cargo add annotate-snippets --dev --feature testing-colors
//! ```
//
// PORT: crate-wide conventions are listed at the top of snippet.ts and renderer/mod.ts, and in
// docs/handoff/annotate-a.md (the contract for the render.rs port).

import * as renderer_ from "./renderer/mod.ts";

export * as level from "./level.ts";
export * as renderer from "./renderer/mod.ts";

/// Normalize the string to avoid any unicode control characters.
///
/// This is important for untrusted input, as it can contain
/// invalid unicode sequences.
// crate: annotate-snippets-0.12.16/src/lib.rs:118 normalize_untrusted_str
export function normalize_untrusted_str(s: string): string {
  return renderer_.normalize_whitespace(s);
}

export { Level } from "./level.ts";
export { Renderer } from "./renderer/mod.ts";
export {
  Annotation,
  AnnotationKind,
  Element,
  Group,
  type Message,
  OptionCow,
  Origin,
  Padding,
  Patch,
  Snippet,
  Title,
  type Report,
} from "./snippet.ts";
