//! The `resolver` module contains the definitions and implementations for the internal
//! `ResolveValue` and `WriteValue` traits. The former converts AST nodes to a
//! [`FluentValue`], and the latter converts them to a string that is written to an
//! implementor of the [`std::fmt::Write`] trait.
//
// Port of fluent-bundle 0.16.0, src/resolver/mod.rs.
// PORT: the traits are implemented for fluent_syntax AST types, so each impl is an impl table
// (`WriteValue_for_Pattern.write(pattern, w, scope)` for `pattern.write(w, scope)`), exported
// from the file holding the upstream impl. `fmt::Write` / `fmt::Result` are fluent_syntax's
// `Write` / `Result<null, FmtError>` (unicode.ts).
import type { Result } from "../../../std/result.ts";
import type { FmtError, Write } from "../../fluent_syntax/unicode.ts";
import type { MemoizerKind } from "../memoizer.ts";
import type { FluentValue } from "../types/mod.ts";
import type { Scope } from "./scope.ts";

export * as errors from "./errors.ts";
export { ResolverError } from "./errors.ts";
export { Scope } from "./scope.ts";
export { WriteValue_for_Expression } from "./expression.ts";
export { ResolveValue_for_InlineExpression, WriteValue_for_InlineExpression } from "./inline_expression.ts";
export { ResolveValue_for_Pattern, WriteValue_for_Pattern } from "./pattern.ts";

/// Resolves an AST node to a [`FluentValue`].
export interface ResolveValue<T> {
  /// Resolves an AST node to a [`FluentValue`].
  // crate: fluent-bundle-0.16.0/src/resolver/mod.rs:25 resolve
  resolve<M extends MemoizerKind>(self: T, scope: Scope<M>): FluentValue;
}

/// Resolves an AST node to a string that is written to source `W`.
export interface WriteValue<T> {
  /// Resolves an AST node to a string that is written to source `W`.
  // crate: fluent-bundle-0.16.0/src/resolver/mod.rs:37 write
  write<M extends MemoizerKind>(self: T, w: Write, scope: Scope<M>): Result<null, FmtError>;

  /// Writes error information to `W`. This can be used to add FTL errors inline
  /// to a message.
  // crate: fluent-bundle-0.16.0/src/resolver/mod.rs:49 write_error
  write_error(self: T, _w: Write): Result<null, FmtError>;
}
