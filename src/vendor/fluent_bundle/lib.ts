//! Fluent is a modern localization system designed to improve how software is translated.
//!
//! `fluent-bundle` is a mid-level component of the [Fluent Localization
//! System](https://www.projectfluent.org).
//!
//! The crate builds on top of the low level [`fluent-syntax`](https://crates.io/crates/fluent-syntax) package, and provides
//! foundational types and structures required for executing localization at runtime.
//!
//! There are four core concepts to understand Fluent runtime:
//!
//! * [`FluentMessage`] - A single translation unit
//! * [`FluentResource`] - A list of [`FluentMessage`] units
//! * [`FluentBundle`](crate::bundle::FluentBundle) - A collection of [`FluentResource`] lists
//! * [`FluentArgs`] - A list of elements used to resolve a [`FluentMessage`] value
//!
//! ## Example
//!
//! ```
//! use fluent_bundle::{FluentBundle, FluentValue, FluentResource, FluentArgs};
//! // Used to provide a locale for the bundle.
//! use unic_langid::langid;
//!
//! // 1. Crate a FluentResource
//!
//! let ftl_string = r#"
//!
//! hello-world = Hello, world!
//! intro = Welcome, { $name }.
//!
//! "#.to_string();
//!
//! let res = FluentResource::try_new(ftl_string)
//!     .expect("Failed to parse an FTL string.");
//!
//!
//! // 2. Crate a FluentBundle
//!
//! let langid_en = langid!("en-US");
//! let mut bundle = FluentBundle::new(vec![langid_en]);
//!
//!
//! // 3. Add the resource to the bundle
//!
//! bundle
//!     .add_resource(res)
//!     .expect("Failed to add FTL resources to the bundle.");
//!
//!
//! // 4. Retrieve a FluentMessage from the bundle
//!
//! let msg = bundle.get_message("hello-world")
//!     .expect("Message doesn't exist.");
//!
//!
//! // 5. Format the value of the simple message
//!
//! let mut errors = vec![];
//!
//! let pattern = msg.value()
//!     .expect("Message has no value.");
//!
//! let value = bundle.format_pattern(&pattern, None, &mut errors);
//!
//! assert_eq!(
//!     bundle.format_pattern(&pattern, None, &mut errors),
//!     "Hello, world!"
//! );
//!
//! // 6. Format the value of the message with arguments
//!
//! let mut args = FluentArgs::new();
//! args.set("name", "John");
//!
//! let msg = bundle.get_message("intro")
//!     .expect("Message doesn't exist.");
//!
//! let pattern = msg.value()
//!     .expect("Message has no value.");
//!
//! // The FSI/PDI isolation marks ensure that the direction of
//! // the text from the variable is not affected by the translation.
//! assert_eq!(
//!     bundle.format_pattern(&pattern, Some(&args), &mut errors),
//!     "Welcome, \u{2068}John\u{2069}."
//! );
//! ```
//!
//! # Ergonomics & Higher Level APIs
//!
//! Reading the example, you may notice how verbose it feels.
//! Many core methods are fallible, others accumulate errors, and there
//! are intermediate structures used in operations.
//!
//! This is intentional as it serves as building blocks for variety of different
//! scenarios allowing implementations to handle errors, cache and
//! optimize results.
//!
//! At the moment it is expected that users will use
//! the `fluent-bundle` crate directly, while the ecosystem
//! matures and higher level APIs are being developed.
//
// Port of fluent-bundle 0.16.0 (the version in upstream's Cargo.lock), src/lib.rs.
// Dependencies at their upstream Cargo.lock versions: fluent-syntax 0.12.0, intl-memoizer 0.5.3,
// type-map 0.5.1, fluent-langneg 0.13.1, intl_pluralrules 7.0.2, unic-langid 0.9.6.
// PORT: `self_cell` → resource.ts; `smallvec` / `rustc-hash` → arrays / `Map`.
// PORT: import the crate through this file: it loads the extension files (entry.ts adds the
// `GetEntry` impl to `FluentBundle`, concurrent.ts adds `new_concurrent` and the concurrent
// memoizer's `MemoizerKind` impl) after bundle.ts.
import "./bundle.ts";
import "./entry.ts";
import "./concurrent.ts";

export * as builtins from "./builtins.ts";
export * as bundle from "./bundle.ts";
export * as concurrent from "./concurrent.ts";
// #[doc(hidden)]
export * as memoizer from "./memoizer.ts";
// #[doc(hidden)]
export * as resolver from "./resolver/mod.ts";
export * as types from "./types/mod.ts";

export { FluentArgs, debug_FluentArgs } from "./args.ts";
/// Specialized [`FluentBundle`](crate::bundle::FluentBundle) over
/// non-concurrent [`IntlLangMemoizer`](intl_memoizer::IntlLangMemoizer).
///
/// This is the basic variant of the [`FluentBundle`](crate::bundle::FluentBundle).
///
/// The concurrent specialization can be constructed with
/// [`FluentBundle::new_concurrent`](crate::concurrent::FluentBundle::new_concurrent).
// PORT: `pub type FluentBundle<R> = bundle::FluentBundle<R, IntlLangMemoizer>`: the class's
// default type argument is `IntlLangMemoizer`.
export { FluentBundle } from "./bundle.ts";
export { FluentError, debug_FluentError, display_FluentError } from "./errors.ts";
export { FluentAttribute, FluentMessage } from "./message.ts";
export { FluentResource, debug_FluentResource } from "./resource.ts";
// #[doc(inline)]
export { FluentValue, debug_FluentValue } from "./types/mod.ts";

// Not ported: benchmarks (not library code).
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:15 read_file benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:22 get_strings benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:31 get_ids benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:40 get_args benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:60 add_functions benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:68 get_bundle benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver.rs:80 resolver_bench benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver_iai.rs:7 add_functions benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver_iai.rs:15 get_args benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver_iai.rs:35 get_ids benchmark (benches/), not library code
// crate-skip: fluent-bundle-0.16.0/benches/resolver_iai.rs:44 iai_resolve_preferences benchmark (benches/), not library code
