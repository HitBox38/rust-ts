// Port of compiler/rustc_mir_build/src/thir/util.rs (lane thir-cx-print).
import { debug_DefKind } from "../../rustc_hir/def.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { TypeckResults } from "../../rustc_middle/ty/decls.ts";
import type { CanonicalUserType } from "../../rustc_middle/ty/typeck_results.ts";
import { debug_Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_UserType } from "../../rustc_middle/ty/typeck_results.ts";
import { bug } from "../../rustc_span/macros.ts";
import { debug_Canonical } from "../../rustc_type_ir/canonical.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert_matches } from "../../std/panic.ts";

/// Looks up the type associated with this hir-id and applies the
/// user-given generic parameters; the hir-id must map to a suitable
/// type.
// rustc: compiler/rustc_mir_build/src/thir/util.rs:12 user_args_applied_to_ty_of_hir_id
export function user_args_applied_to_ty_of_hir_id(
  tcx: TyCtxt,
  typeck_results: TypeckResults,
  hir_id: HirId,
): CanonicalUserType | undefined {
  const user_provided_types = typeck_results.user_provided_types();
  const found = user_provided_types.get(hir_id);
  if (found === undefined) return undefined;
  // PORT: `let mut user_ty = *..` is a copy (`CanonicalUserType: Copy`); the `&mut user_ty.value.kind` write below
  // rebuilds the copied path instead of mutating the table's value.
  let user_ty: CanonicalUserType = found;
  // debug!("user_subts_applied_to_ty_of_hir_id: user_ty={:?}", user_ty);
  const ty = typeck_results.node_type(hir_id);
  const kind = ty.kind();
  switch (kind.$) {
    case "Adt": {
      const adt_def = kind._0;
      // This "fixes" user type annotations for tupled ctor patterns for ADTs.
      // That's because `type_of(ctor_did)` returns a FnDef, but we actually
      // want to be annotating the type of the ADT itself. It's a bit goofy,
      // but it's easier to adjust this here rather than in the path lowering
      // code for patterns in HIR.
      const user_kind = user_ty.value.kind;
      if (user_kind.$ === "TypeOf") {
        const did = user_kind._0;
        // This is either already set up correctly (struct, union, enum, or variant),
        // or needs adjusting (ctor). Make sure we don't start adjusting other
        // user annotations like consts or fn calls.
        const def_kind = tcx.def_kind(did);
        // PORT: `pattern` is `stringify!` of the pattern (tokens on one line); only reached in an ICE message.
        assert_matches(
          def_kind,
          def_kind.$ === "Ctor" || def_kind.$ === "Struct" || def_kind.$ === "Enum" || def_kind.$ === "Union" || def_kind.$ === "Variant",
          "DefKind::Ctor(..) | DefKind::Struct | DefKind::Enum | DefKind::Union | DefKind::Variant",
          (v) => debug_DefKind(v, PLAIN),
        );
        user_ty = { ...user_ty, value: { ...user_ty.value, kind: { $: "TypeOf", _0: adt_def.did(), _1: user_kind._1 } } };
      }
      return user_ty;
    }
    case "FnDef":
      return user_ty;
    default:
      return bug(`ty: ${debug_Ty(ty, PLAIN)} should not have user provided type ${debug_Canonical(user_ty, PLAIN, debug_UserType)} recorded `);
  }
}
