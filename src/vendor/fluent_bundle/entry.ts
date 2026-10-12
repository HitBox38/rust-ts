//! `Entry` is used to store the lookup information for Messages, Terms and Functions in
//! `FluentBundle` instances.
//
// Port of fluent-bundle 0.16.0, src/entry.rs.
// PORT: `impl<R: Borrow<FluentResource>, M> GetEntry for FluentBundle<R, M>` is attached to
// `FluentBundle.prototype` (extension-file pattern, PORTING §5): lib.ts imports this file after
// bundle.ts.
import type { Message, Term } from "../fluent_syntax/ast/mod.ts";
import type { FluentArgs } from "./args.ts";
import { FluentBundle } from "./bundle.ts";
import type { MemoizerKind } from "./memoizer.ts";
import type { FluentValue } from "./types/mod.ts";

export type FluentFunction = (positional: readonly FluentValue[], named: FluentArgs) => FluentValue;

type ResourceIdx = number;
type EntryIdx = number;

/// The [`Entry`] stores indexes into the [`FluentBundle`]'s resources for Messages and Terms,
/// and owns the [`Box`] pointers to the [`FluentFunction`].
export type Entry =
  | { readonly $: "Message"; readonly _0: [ResourceIdx, EntryIdx] }
  | { readonly $: "Term"; readonly _0: [ResourceIdx, EntryIdx] }
  | { readonly $: "Function"; readonly _0: FluentFunction };

export interface GetEntry {
  /// Looks up a message by its string ID, and returns it if it exists.
  // crate: fluent-bundle-0.16.0/src/entry.rs:29 get_entry_message
  get_entry_message(id: string): Message | undefined;

  /// Looks up a term by its string ID, and returns it if it exists.
  // crate: fluent-bundle-0.16.0/src/entry.rs:32 get_entry_term
  get_entry_term(id: string): Term | undefined;

  /// Looks up a function by its string ID, and returns it if it exists.
  // crate: fluent-bundle-0.16.0/src/entry.rs:35 get_entry_function
  get_entry_function(id: string): FluentFunction | undefined;
}

declare module "./bundle.ts" {
  interface FluentBundle<M extends MemoizerKind> extends GetEntry {}
}

// crate: fluent-bundle-0.16.0/src/entry.rs:39 get_entry_message
FluentBundle.prototype.get_entry_message = function <M extends MemoizerKind>(
  this: FluentBundle<M>,
  id: string,
): Message | undefined {
  const entry = this.entries.get(id);
  if (entry === undefined) return undefined;
  switch (entry.$) {
    case "Message": {
      const [resource_idx, entry_idx] = entry._0;
      const res = this.resources[resource_idx];
      if (res === undefined) return undefined;
      const e = res.get_entry(entry_idx);
      if (e === undefined) return undefined;
      if (e.$ === "Message") {
        const msg = e._0;
        return msg;
      } else {
        return undefined;
      }
    }
    default:
      return undefined;
  }
};

// crate: fluent-bundle-0.16.0/src/entry.rs:53 get_entry_term
FluentBundle.prototype.get_entry_term = function <M extends MemoizerKind>(
  this: FluentBundle<M>,
  id: string,
): Term | undefined {
  const entry = this.entries.get(id);
  if (entry === undefined) return undefined;
  switch (entry.$) {
    case "Term": {
      const [resource_idx, entry_idx] = entry._0;
      const res = this.resources[resource_idx];
      if (res === undefined) return undefined;
      const e = res.get_entry(entry_idx);
      if (e === undefined) return undefined;
      if (e.$ === "Term") {
        const msg = e._0;
        return msg;
      } else {
        return undefined;
      }
    }
    default:
      return undefined;
  }
};

// crate: fluent-bundle-0.16.0/src/entry.rs:67 get_entry_function
FluentBundle.prototype.get_entry_function = function <M extends MemoizerKind>(
  this: FluentBundle<M>,
  id: string,
): FluentFunction | undefined {
  const entry = this.entries.get(id);
  if (entry === undefined) return undefined;
  switch (entry.$) {
    case "Function": {
      const function_ = entry._0;
      return function_;
    }
    default:
      return undefined;
  }
};
