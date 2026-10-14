// Test helper of src/rustc_hir_analysis/check/check_region_intrinsic.test.ts (lane check-region-intrinsic).
//
//   bun run.ts scopes <rustc arguments...>
//
// Subject side of the `scopedump` probe (./scopedump/main.rs): runs the ported driver up to expansion and prints, for
// every `tcx.hir_body_owners()` in that order, `"{did:?}:\n{tree:#?}\n\n"` with `tree = tcx.region_scope_tree(did)`.
//
// The `{:#?}` of `ScopeTree` (`#[derive(Debug)]`) is written here rather than with region.gen.ts's `debug_ScopeTree`,
// which prints its two hash maps through `unported_debug`: upstream's `extended_temp_scopes` (`ItemLocalMap`) and
// `backwards_incompatible_scope` (`UnordMap`) both print as `UnordMap { inner: {..} }` in hashbrown bucket order. The
// port keeps them as insertion-ordered `Map`s; neither is ever removed from, so replaying their insertion order into
// an `FxHashMap` (rust_ts/hash_map.ts) reproduces rustc's bucket order. Their entries are `(ItemLocalId, Option<Scope>)`
// / `(ItemLocalId, Scope)`: 12 bytes, align 4 (`Option<Scope>` uses `ItemLocalId`'s niche).
import { debug_HirId, debug_ItemLocalId, type ItemLocalId } from "../../../rustc_hir_id/lib.ts";
import type { Compiler } from "../../../rustc_interface/interface.ts";
import { debug_Scope, type Scope, type ScopeTree } from "../../../rustc_middle/middle/region.ts";
import type { TyCtxt } from "../../../rustc_middle/ty/context.ts";
import { debug_LocalDefId } from "../../../rustc_span/def_id.ts";
import { FxHashMap, u32_key } from "../../../rust_ts/hash_map.ts";
import { debug_map, debug_option, debug_struct, type Fmt, format_debug, PLAIN, PRETTY } from "../../../std/fmt.ts";

const ENTRY = { size: 8, align: 4 };

function replay<V>(m: Map<ItemLocalId, V>): FxHashMap<ItemLocalId, V> {
  const fx = FxHashMap.default<ItemLocalId, V>(u32_key as never, ENTRY);
  for (const [k, v] of m) fx.set(k, v);
  return fx;
}

function debug_unord<V>(m: Map<ItemLocalId, V>, f: Fmt, debug_V: (v: V, f: Fmt) => string): string {
  const fx = replay(m);
  return debug_struct(f, "UnordMap", [["inner", debug_map(f, [...fx].map(([k, v]) => [debug_ItemLocalId(k, f), debug_V(v, f)]))]]);
}

function debug_tree(v: ScopeTree, f: Fmt): string {
  return debug_struct(f, "ScopeTree", [
    ["root_body", debug_option(v.root_body, f, debug_HirId)],
    ["parent_map", debug_map(f, [...v.parent_map].map(([k, x]) => [debug_Scope(k, f), debug_Scope(x, f)]))],
    ["var_map", debug_map(f, [...v.var_map].map(([k, x]) => [debug_ItemLocalId(k, f), debug_Scope(x, f)]))],
    ["extended_temp_scopes", debug_unord(v.extended_temp_scopes, f, (x: Scope | undefined, f) => debug_option(x, f, debug_Scope))],
    ["backwards_incompatible_scope", debug_unord(v.backwards_incompatible_scope, f, debug_Scope)],
  ]);
}

async function main(args: string[]): Promise<number> {
  const mode = args[0];
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../../rustc_session/config.ts");
  if (mode === "scopes") {
    const callbacks = {
      config(): void {},
      after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
        let out = "";
        for (const did of tcx.hir_body_owners()) {
          const tree = tcx.region_scope_tree(did) as ScopeTree;
          out += `${debug_LocalDefId(did, PLAIN)}:\n${format_debug(tree, debug_tree, PRETTY)}\n\n`;
        }
        std_print(out);
        return "Stop" as const;
      },
    };
    return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args.slice(1)], callbacks));
  }
  console.error(`ERROR: unknown mode ${mode}`);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
