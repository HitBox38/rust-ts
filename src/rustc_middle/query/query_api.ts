// Port of compiler/rustc_middle/src/query/query_api.rs: the expansion of
// `rustc_with_all_queries! { define_query_api! }` for every query at once.
//
// PORT: the per-query items the macro writes out (`pub mod $name`, `TaggedQueryKey`, `Providers`, the
// `TyCtxt`/`TyCtxtAt`/`TyCtxtEnsure*`/`TyCtxtFeed` methods) are *typed* in the generated queries.gen.ts
// (tools/codegen/queries.ts) and *implemented* here once, generically, from `QUERY_DECLS`:
// `define_query_api()` installs the methods on the prototypes (run by the crate root, lib.ts, after
// every class exists). The `const _: ()` key/value size assertions have no TS counterpart.
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { catch_fatal_errors } from "../../rustc_span/fatal_error.ts";
import { type Debug, debug_str, debug_tuple, PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import type { Result } from "../../std/result.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { ExternProviders, ExternQuery, Providers, QueryName, QueryTypes, TaggedQueryKey as TaggedQueryKeyT } from "../queries.gen.ts";
import { QUERY_DECLS, QUERY_NAMES } from "../queries.gen.ts";
import { TyCtxt, TyCtxtFeed } from "../ty/context.ts";
import type { TyCtxtEnsureQueries, TyCtxtEnsureResultQueries, TyCtxtFeedQueries, TyCtxtQueries } from "../queries.gen.ts";
import { query_ensure_ok, query_ensure_result, query_feed, query_get_at, TyCtxtAt, TyCtxtEnsureDone, TyCtxtEnsureOk, TyCtxtEnsureResult } from "./calls.ts";
import type { StableHash } from "../../rustc_data_structures/stable_hash.ts";
import type { QueryKey } from "./keys.ts";
import type { QueryVTable } from "./system.ts";

/**
 * One query of the `rustc_with_all_queries!` list (generated into `QUERY_DECLS`): the QMODLIST, the `desc`
 * closure, the `QueryKey` impl of the key type and its `IntoQueryKey` conversion (`maybe_into_query_key!`),
 * and the Debug of the value (`format_value` in query_vtables.rs) when it is ported.
 */
export interface QueryDecl<K, V> {
  readonly name: QueryName;
  readonly key: QueryKey<K, unknown>;
  /** `maybe_into_query_key!($K)` + `IntoQueryKey::into_query_key` */
  readonly into_key: (key: never) => K;
  // Search for (QMODLIST) to find all occurrences of this query modifier list.
  readonly arena_cache: boolean;
  readonly cache_on_disk: boolean;
  readonly depth_limit: boolean;
  readonly eval_always: boolean;
  readonly feedable: boolean;
  readonly handle_cycle_error: boolean;
  readonly no_force: boolean;
  readonly no_hash: boolean;
  readonly separate_provide_extern: boolean;
  readonly returns_error_guaranteed: boolean;
  /** `desc: { |tcx: TyCtxt<'tcx>, $key_pat: $key_ty| format!(..) }` */
  readonly desc: (tcx: TyCtxt, key: K) => string;
  /** `Debug` of the value; `undefined` while the value type is not ported. */
  readonly debug_value: Debug<V> | undefined;
  /** `StableHash` of the value (`hash_result` in `hash_value_fn`); `undefined` for `no_hash` queries and while the
   * value type's impl is not ported. */
  readonly stable_hash_value: StableHash<V> | undefined;
}

type AnyDecl = QueryDecl<unknown, unknown>;
const decl_of = (name: QueryName): AnyDecl => QUERY_DECLS[name] as unknown as AnyDecl;
const into_key = (d: AnyDecl, key: unknown): unknown => (d.into_key as (k: unknown) => unknown)(key);

/// This helper function takes a value returned by the query provider
/// (or loaded from disk, or supplied by query feeding), allocates
/// it in an arena if requested by the `arena_cache` modifier, and
/// then returns an erased copy of it.
// rustc: compiler/rustc_middle/src/query/query_api.rs:69 provided_to_erased
export function provided_to_erased<V>(_tcx: TyCtxt, provided_value: V): V {
  // PORT: arena allocation and value erasure are identities (PORTING §5; arena_cached.rs, erase.rs).
  return provided_value;
}

// ---- impl TaggedQueryKey ----------------------------------------------------------------------

export type TaggedQueryKey = TaggedQueryKeyT;

export const TaggedQueryKey = {
  /// Returns the name of the query this key is tagged with.
  ///
  /// This is useful for error/debug output, but don't use it to check for
  /// specific query names. Instead, match on the `TaggedQueryKey` variant.
  // rustc: compiler/rustc_middle/src/query/query_api.rs:143 query_name
  query_name(self: TaggedQueryKey): QueryName {
    return self.$;
  },

  /// Formats a human-readable description of this query and its key, as
  /// specified by the `desc` query modifier.
  ///
  /// Used when reporting query cycle errors and similar problems.
  // rustc: compiler/rustc_middle/src/query/query_api.rs:155 description
  description(self: TaggedQueryKey, tcx: TyCtxt): string {
    // PORT: `ty::print::with_no_queries!(..)` only changes how `ty::print` renders paths; the printer is
    // not ported (descriptions that print paths are unported until it is).
    const name = self.$;
    const description = decl_of(name).desc(tcx, self._0);
    if (tcx.sess.verbose_internals()) {
      return `${description} [${debug_str(name)}]`;
    } else {
      return description;
    }
  },

  /// Calls `self.description` or returns a fallback if there was a fatal error
  // rustc: compiler/rustc_middle/src/query/query_api.rs:169 catch_description
  catch_description(self: TaggedQueryKey, tcx: TyCtxt): string {
    const r = catch_fatal_errors(() => TaggedQueryKey.description(self, tcx));
    return r.$ === "Ok" ? r._0 : `<error describing ${TaggedQueryKey.query_name(self)}>`;
  },

  /// Returns the default span for this query if `span` is a dummy span.
  // rustc: compiler/rustc_middle/src/query/query_api.rs:174 default_span
  default_span(self: TaggedQueryKey, tcx: TyCtxt, span: Span): Span {
    if (!Span.is_dummy(span)) {
      return span;
    }
    if (self.$ === "def_span") {
      // The `def_span` query is used to calculate `default_span`,
      // so exit to avoid infinite recursion.
      return DUMMY_SP;
    }
    return decl_of(self.$).key.default_span(self._0, tcx);
  },

  /// Calls `self.default_span` or returns `DUMMY_SP` if there was a fatal error
  // rustc: compiler/rustc_middle/src/query/query_api.rs:192 catch_default_span
  catch_default_span(self: TaggedQueryKey, tcx: TyCtxt, span: Span): Span {
    const r = catch_fatal_errors(() => TaggedQueryKey.default_span(self, tcx, span));
    return r.$ === "Ok" ? r._0 : DUMMY_SP;
  },
};

/** `#[derive(Debug)] enum TaggedQueryKey { $name($name::Key), .. }` */
export const debug_TaggedQueryKey: Debug<TaggedQueryKey> = (v, f) => debug_tuple(f, v.$, [decl_of(v.$).key.debug(v._0, f)]);

// ---- Providers / ExternProviders ----------------------------------------------------------------

// rustc: compiler/rustc_middle/src/query/query_api.rs:238 default
export function Providers_default(): Providers {
  const p: Record<string, unknown> = {};
  for (const name of QUERY_NAMES) {
    const d = decl_of(name);
    p[name] = (_: TyCtxt, key: unknown): never => default_query(name, (f) => (d.separate_provide_extern ? d.key.debug_local(key as never, f) : d.key.debug(key, f)));
  }
  return p as Providers;
}

// rustc: compiler/rustc_middle/src/query/query_api.rs:250 default
export function ExternProviders_default(): ExternProviders {
  const p: Record<string, unknown> = {};
  for (const name of QUERY_NAMES) {
    const d = decl_of(name);
    if (d.separate_provide_extern) {
      p[name] = (_: TyCtxt, key: unknown): never => default_extern_query(name, (f) => d.key.debug(key, f));
    }
  }
  return p as ExternProviders;
}

// rustc: compiler/rustc_middle/src/query/query_api.rs:265 clone
export function clone_Providers(self: Providers): Providers {
  return { ...self };
}

// rustc: compiler/rustc_middle/src/query/query_api.rs:270 clone
export function clone_ExternProviders(self: ExternProviders): ExternProviders {
  return { ...self };
}

// ---- the TyCtxt / TyCtxtAt / TyCtxtEnsure* / TyCtxtFeed query methods ----------------------------

declare module "../ty/context.ts" {
  interface TyCtxt extends TyCtxtQueries {}
  interface TyCtxtFeed<K> extends TyCtxtFeedQueries {
    /** (phantom: keeps `K` used for the type checker) */
    readonly __feed_key?: K;
  }
}
declare module "./calls.ts" {
  interface TyCtxtAt extends TyCtxtQueries {}
  interface TyCtxtEnsureOk extends TyCtxtEnsureQueries {}
  interface TyCtxtEnsureResult extends TyCtxtEnsureResultQueries {}
  interface TyCtxtEnsureDone extends TyCtxtEnsureQueries {}
}

let defined = false;

/**
 * Installs the query methods of `define_query_api!` (query_api.rs:273-361) on the prototypes. Idempotent;
 * called by src/rustc_middle/lib.ts once every class exists.
 */
export function define_query_api(): void {
  if (defined) return;
  defined = true;
  const install = (proto: object, name: string, f: unknown): void => {
    if (Object.prototype.hasOwnProperty.call(proto, name)) panic(`define_query_api: \`${name}\` is already a method of ${proto.constructor.name}`);
    (proto as Record<string, unknown>)[name] = f;
  };
  for (const name of QUERY_NAMES) {
    const d = decl_of(name);
    const vtable = (tcx: TyCtxt): QueryVTable<unknown, unknown> => tcx.query_system.query_vtables[name] as unknown as QueryVTable<unknown, unknown>;

    // impl TyCtxt { pub fn $name(self, key) -> $V { self.at(DUMMY_SP).$name(key) } }
    install(TyCtxt.prototype, name, function (this: TyCtxt, key: unknown): unknown {
      return (this.at(DUMMY_SP) as unknown as Record<string, (k: unknown) => unknown>)[name]!(key);
    });

    // impl TyCtxtAt { pub fn $name(self, key) -> $V { restore_val(query_get_at(..)) } }
    install(TyCtxtAt.prototype, name, function (this: TyCtxtAt, key: unknown): unknown {
      return query_get_at(this.tcx, this.span, vtable(this.tcx), into_key(d, key));
    });

    // impl TyCtxtEnsureOk { pub fn $name(self, key) { query_ensure_ok(..) } }
    install(TyCtxtEnsureOk.prototype, name, function (this: TyCtxtEnsureOk, key: unknown): void {
      query_ensure_ok(this.tcx, vtable(this.tcx), into_key(d, key));
    });

    // Only defined when the `returns_error_guaranteed` modifier is present.
    if (d.returns_error_guaranteed) {
      install(TyCtxtEnsureResult.prototype, name, function (this: TyCtxtEnsureResult, key: unknown): unknown {
        return query_ensure_result(this.tcx, vtable(this.tcx) as unknown as QueryVTable<unknown, Result<unknown, ErrorGuaranteed>>, into_key(d, key));
      });
    }

    install(TyCtxtEnsureDone.prototype, name, function (this: TyCtxtEnsureDone, key: unknown): void {
      // This has the same implementation as `tcx.$query(..)` as it isn't currently
      // beneficial to have an optimized variant due to how promotion works.
      void (this.tcx as unknown as Record<string, (k: unknown) => unknown>)[name]!(key);
    });

    // Only defined when the `feedable` modifier is present.
    if (d.feedable) {
      install(TyCtxtFeed.prototype, name, function (this: TyCtxtFeed<unknown>, value: unknown): void {
        query_feed(this.tcx, vtable(this.tcx), into_key(d, this.key()), provided_to_erased(this.tcx, value));
      });
    }
  }
}

// rustc: compiler/rustc_middle/src/query/query_api.rs:370 default_query
export function default_query(name: string, key: (f: typeof PLAIN) => string): never {
  return panic(
    `\`tcx.${name}(${key(PLAIN)})\` is not supported for this key;\n` +
      "hint: Queries can be either made to the local crate, or the external crate. " +
      "This error means you tried to use it for one that's not supported.\n" +
      `If that's not the case, ${name} was likely never assigned to a provider function.\n`,
  );
}

// rustc: compiler/rustc_middle/src/query/query_api.rs:380 default_extern_query
export function default_extern_query(name: string, key: (f: typeof PLAIN) => string): never {
  return panic(`\`tcx.${name}(${key(PLAIN)})\` unsupported by its crate; ` + `perhaps the \`${name}\` query was never assigned a provider function`);
}

/** Types of the `QueryTypes` table, re-exported for providers (`queries::$name::Key` etc.). */
export type { QueryTypes, ExternQuery };
