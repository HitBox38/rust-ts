//! "Hooks" let you write `tcx` methods in downstream crates and call them in this crate, reducing
//! the amount of code that needs to be in this crate (which is already very big). This is somewhat
//! similar to queries, but queries come with a lot of machinery for caching and incremental
//! compilation, whereas hooks are just plain function pointers without any of the query magic.
// Port of compiler/rustc_middle/src/hooks.rs.
//
// PORT: `declare_hooks!` is expanded by hand (13 hooks; same approach as config.rs's
// `define_output_types!`, driver-session handoff §16): one `Providers` table type, its `default()`,
// and the `TyCtxt` methods, installed on the prototype by `define_hooks()` (run by lib.ts). Argument
// and return types that are not ported yet are `unknown`.
import type { DefId, DefPathHash, StableCrateId } from "../rustc_span/def_id.ts";
import type { CrateNum, LocalDefId } from "../rustc_span/def_id.ts";
import type { ExpnHash, ExpnId } from "../rustc_span/hygiene.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { panic } from "../std/panic.ts";
import { TyCtxt } from "./ty/context.ts";

/** The hooks of `declare_hooks! { .. }` (hooks.rs:61-133): name -> `fn(TyCtxt, args..) -> V`. */
export interface Providers {
  /// Tries to destructure an `mir::Const` ADT or array into its variant index
  /// and its field values. This should only be used for pretty printing.
  try_destructure_mir_constant_for_user_output: (tcx: TyCtxt, val: unknown, ty: unknown) => unknown;

  /// Getting a &core::panic::Location referring to a span.
  const_caller_location: (tcx: TyCtxt, file: Symbol, line: number, col: number) => unknown;

  /// Imports all `SourceFile`s from the given crate into the current session.
  /// This normally happens automatically when we decode a `Span` from
  /// that crate's metadata - however, the incr comp cache needs
  /// to trigger this manually when decoding a foreign `Span`
  import_source_files: (tcx: TyCtxt, key: CrateNum) => null;

  expn_hash_to_expn_id: (tcx: TyCtxt, cnum: CrateNum, index_guess: number, hash: ExpnHash) => ExpnId;

  /// Converts a `DefPathHash` to its corresponding `DefId` in the current compilation
  /// session, if it still exists. This is used during incremental compilation to
  /// turn a deserialized `DefPathHash` into its current `DefId`.
  /// Will fetch a DefId from a DefPathHash for a foreign crate.
  def_path_hash_to_def_id_extern: (tcx: TyCtxt, hash: DefPathHash, stable_crate_id: StableCrateId) => DefId | undefined;

  /// Returns `true` if we should codegen an instance in the local crate, or returns `false` if we
  /// can just link to the upstream crate and therefore don't need a mono item.
  ///
  /// Note: this hook isn't called within `rustc_middle` but #127779 suggests it's a hook instead
  /// of a normal function because external tools might want to override it.
  should_codegen_locally: (tcx: TyCtxt, instance: unknown) => boolean;

  alloc_self_profile_query_strings: (tcx: TyCtxt) => null;

  /// Saves and writes the DepGraph to the file system.
  ///
  /// This function saves both the dep-graph and the query result cache,
  /// and drops the result cache.
  ///
  /// This function should only run after all queries have completed.
  /// Trying to execute a query afterwards would attempt to read the result cache we just dropped.
  save_dep_graph: (tcx: TyCtxt) => null;

  verify_query_key_hashes: (tcx: TyCtxt) => null;

  /// Ensure the given scalar is valid for the given type.
  /// This checks non-recursive runtime validity.
  validate_scalar_in_layout: (tcx: TyCtxt, scalar: unknown, ty: unknown) => boolean;

  /// **Do not call this directly; call the `mir_built` query instead.**
  ///
  /// Creates the MIR for a given `DefId`, including unreachable code.
  build_mir_inner_impl: (tcx: TyCtxt, def: LocalDefId) => unknown;

  /// Serializes all eligible query return values into the on-disk cache.
  encode_query_values: (tcx: TyCtxt, encoder: unknown) => null;

  /// Identifies landing pads that don't do anything, allowing some post-monomorphization
  /// simplifications during codegen.
  find_noop_landing_pads_for_instance: (tcx: TyCtxt, body: unknown, instance: unknown, typing_env: unknown) => unknown;

  /// Configures extra data to be included when pretty printing MIR
  mir_pretty_extra_data: (tcx: TyCtxt, body: unknown) => unknown;
}

type HookName = keyof Providers;
const HOOK_NAMES: readonly HookName[] = [
  "try_destructure_mir_constant_for_user_output",
  "const_caller_location",
  "import_source_files",
  "expn_hash_to_expn_id",
  "def_path_hash_to_def_id_extern",
  "should_codegen_locally",
  "alloc_self_profile_query_strings",
  "save_dep_graph",
  "verify_query_key_hashes",
  "validate_scalar_in_layout",
  "build_mir_inner_impl",
  "encode_query_values",
  "find_noop_landing_pads_for_instance",
  "mir_pretty_extra_data",
];

// rustc: compiler/rustc_middle/src/hooks.rs:47 default
export function Providers_default(): Providers {
  const p: Record<string, unknown> = {};
  for (const name of HOOK_NAMES) p[name] = (): never => default_hook(name);
  return p as unknown as Providers;
}

// rustc: compiler/rustc_middle/src/hooks.rs:58 clone
export function clone_Providers(self: Providers): Providers {
  return { ...self };
}

type HookMethods = { [N in HookName]: Providers[N] extends (tcx: TyCtxt, ...args: infer A) => infer R ? (...args: A) => R : never };
declare module "./ty/context.ts" {
  interface TyCtxt extends HookMethods {}
}

let defined = false;
/** `impl TyCtxt { pub fn $name(self, args..) -> $V { (self.hooks.$name)(self, args..) } }` */
export function define_hooks(): void {
  if (defined) return;
  defined = true;
  for (const name of HOOK_NAMES) {
    if (Object.prototype.hasOwnProperty.call(TyCtxt.prototype, name)) panic(`define_hooks: \`${name}\` is already a TyCtxt method`);
    (TyCtxt.prototype as unknown as Record<string, unknown>)[name] = function (this: TyCtxt, ...args: unknown[]): unknown {
      return (this.hooks[name] as (tcx: TyCtxt, ...a: unknown[]) => unknown)(this, ...args);
    };
  }
}

// rustc: compiler/rustc_middle/src/hooks.rs:137 default_hook
function default_hook(name: string): never {
  return panic(`\`tcx.${name}\` cannot be called as \`${name}\` was never assigned to a provider function`);
}
