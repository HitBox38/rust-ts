import { Err, Ok, type Result } from "../std/result.ts";
import type { Fmt } from "../std/fmt.ts";

/// The edition of the compiler. (See [RFC 2052](https://rust-lang.github.io/rfcs/2052-epochs.html).)
export type Edition =
  // When adding new editions, be sure to do the following:
  //
  // - update the `ALL_EDITIONS` const
  // - update the `EDITION_NAME_LIST` const
  // - add a `rust_####()` function to the session
  // - update the enum in Cargo's sources as well
  //
  // Editions *must* be kept in order, oldest to newest.
  /// The 2015 edition
  | "Edition2015"
  /// The 2018 edition
  | "Edition2018"
  /// The 2021 edition
  | "Edition2021"
  /// The 2024 edition
  | "Edition2024"
  /// The future edition - this variant will always exist and features associated with this
  /// edition can be moved to the next 20XX edition when it is established and it is confirmed
  /// that those features will be part of that edition.
  ///
  /// This variant allows edition changes to be implemented before being assigned to a concrete
  /// edition - primarily when there are two different unstable behaviours that need tested across
  /// an edition boundary.
  ///
  /// This edition will be permanently unstable and any features associated with this edition
  /// must also be behind a feature gate.
  | "EditionFuture";
export const Edition = {
  Edition2015: "Edition2015",
  Edition2018: "Edition2018",
  Edition2021: "Edition2021",
  Edition2024: "Edition2024",
  EditionFuture: "EditionFuture",
  // PORT: `impl Edition` methods live on the companion: `Edition.as_str(e)` is `e.as_str()`.
  lint_name: Edition_lint_name,
  as_str: Edition_as_str,
  is_stable: Edition_is_stable,
  is_rust_2015: Edition_is_rust_2015,
  at_least_rust_2018: Edition_at_least_rust_2018,
  at_least_rust_2021: Edition_at_least_rust_2021,
  at_least_rust_2024: Edition_at_least_rust_2024,
  at_least_edition_future: Edition_at_least_edition_future,
  from_str: Edition_from_str,
} as const;

/** Declaration order; `derive(PartialOrd)` compares by it. */
export function Edition_discriminant(e: Edition): number {
  switch (e) {
    case "Edition2015":
      return 0;
    case "Edition2018":
      return 1;
    case "Edition2021":
      return 2;
    case "Edition2024":
      return 3;
    case "EditionFuture":
      return 4;
  }
}

/** `#[derive(Debug)]`: the variant name. */
export function debug_Edition(e: Edition, _f?: Fmt): string {
  return e;
}

// Must be in order from oldest to newest.
export const ALL_EDITIONS: readonly Edition[] = [
  Edition.Edition2015,
  Edition.Edition2018,
  Edition.Edition2021,
  Edition.Edition2024,
  Edition.EditionFuture,
];

/// All the valid editions that `--edition` will accept on nightly.
export const EDITION_NAME_LIST = "<2015|2018|2021|2024|future>";
/// All the valid editions on stable, which doesn't include `future`.
export const EDITION_NAME_LIST_STABLE = "<2015|2018|2021|2024>";

export const DEFAULT_EDITION: Edition = Edition.Edition2015;

export const LATEST_STABLE_EDITION: Edition = Edition.Edition2024;

// rustc: compiler/rustc_span/src/edition.rs:58 fmt
/** `impl fmt::Display for Edition` */
export function display_Edition(self: Edition): string {
  const s = Edition_as_str(self);
  return `${s}`;
}

// rustc: compiler/rustc_span/src/edition.rs:65 lint_name
export function Edition_lint_name(self: Edition): string {
  switch (self) {
    case "Edition2015":
      return "rust_2015_compatibility";
    case "Edition2018":
      return "rust_2018_compatibility";
    case "Edition2021":
      return "rust_2021_compatibility";
    case "Edition2024":
      return "rust_2024_compatibility";
    case "EditionFuture":
      return "edition_future_compatibility";
  }
}

// rustc: compiler/rustc_span/src/edition.rs:75 as_str
export function Edition_as_str(self: Edition): string {
  switch (self) {
    case "Edition2015":
      return "2015";
    case "Edition2018":
      return "2018";
    case "Edition2021":
      return "2021";
    case "Edition2024":
      return "2024";
    case "EditionFuture":
      return "future";
  }
}

// rustc: compiler/rustc_span/src/edition.rs:85 is_stable
export function Edition_is_stable(self: Edition): boolean {
  switch (self) {
    case "Edition2015":
      return true;
    case "Edition2018":
      return true;
    case "Edition2021":
      return true;
    case "Edition2024":
      return true;
    case "EditionFuture":
      return false;
  }
}

/// Is this edition 2015?
// rustc: compiler/rustc_span/src/edition.rs:96 is_rust_2015
export function Edition_is_rust_2015(self: Edition): boolean {
  return self === Edition.Edition2015;
}

/// Are we allowed to use features from the Rust 2018 edition?
// rustc: compiler/rustc_span/src/edition.rs:101 at_least_rust_2018
export function Edition_at_least_rust_2018(self: Edition): boolean {
  return Edition_discriminant(self) >= Edition_discriminant(Edition.Edition2018);
}

/// Are we allowed to use features from the Rust 2021 edition?
// rustc: compiler/rustc_span/src/edition.rs:106 at_least_rust_2021
export function Edition_at_least_rust_2021(self: Edition): boolean {
  return Edition_discriminant(self) >= Edition_discriminant(Edition.Edition2021);
}

/// Are we allowed to use features from the Rust 2024 edition?
// rustc: compiler/rustc_span/src/edition.rs:111 at_least_rust_2024
export function Edition_at_least_rust_2024(self: Edition): boolean {
  return Edition_discriminant(self) >= Edition_discriminant(Edition.Edition2024);
}

/// Are we allowed to use features from the future edition?
// rustc: compiler/rustc_span/src/edition.rs:116 at_least_edition_future
export function Edition_at_least_edition_future(self: Edition): boolean {
  return Edition_discriminant(self) >= Edition_discriminant(Edition.EditionFuture);
}

// rustc: compiler/rustc_span/src/edition.rs:123 from_str
/** `impl FromStr for Edition` */
export function Edition_from_str(s: string): Result<Edition, undefined> {
  switch (s) {
    case "2015":
      return Ok(Edition.Edition2015);
    case "2018":
      return Ok(Edition.Edition2018);
    case "2021":
      return Ok(Edition.Edition2021);
    case "2024":
      return Ok(Edition.Edition2024);
    case "future":
      return Ok(Edition.EditionFuture);
    default:
      return Err(undefined);
  }
}
