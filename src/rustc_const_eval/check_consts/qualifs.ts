// Stub module (lane mt-promote): compiler/rustc_const_eval/src/check_consts/qualifs.rs is not ported yet.
// Declared by lane const-check for check.ts; mt-promote's port replaces this file.
// PORT (const-check's proposal, to be confirmed by mt-promote): `trait Qualif` has only associated consts and fns, so a
// `Q: Qualif` type parameter is the impl table `Q_: Qualif` passed as a value (precedent: mb-scope's
// `T_: DropTreeBuilder`); `HasMutInterior` / `NeedsDrop` / `NeedsNonConstDrop` are those tables. `in_place::<Q, _>` takes
// the table first.
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { ConstQualifs, Local, PlaceRef } from "../../rustc_middle/mir/mod.ts";
import type { Ty } from "../../rustc_middle/ty/mod.ts";
import type { AdtDef } from "../../rustc_middle/ty/adt.ts";
import { unported } from "../../std/panic.ts";
import type { ConstCx } from "./mod.ts";

// stub: compiler/rustc_const_eval/src/check_consts/qualifs.rs:20 in_any_value_of_ty (lane mt-promote)
export function in_any_value_of_ty(_cx: ConstCx, _ty: Ty, _tainted_by_errors: ErrorGuaranteed | undefined): ConstQualifs {
  return unported("rustc_const_eval::check_consts::qualifs::in_any_value_of_ty");
}

/// A "qualif"(-ication) is a way to look for something "bad" in the MIR that would disqualify some
/// code for promotion or prevent it from evaluating at compile time.
// rustc-type: compiler/rustc_const_eval/src/check_consts/qualifs.rs:44 Qualif
export interface Qualif {
  /// The name of the file used to debug the dataflow analysis that computes this qualif.
  readonly ANALYSIS_NAME: string;
  /// Whether this `Qualif` is cleared when a local is moved from.
  readonly IS_CLEARED_ON_MOVE: boolean;
  /// Whether this `Qualif` might be evaluated after the promotion and can encounter a promoted.
  readonly ALLOW_PROMOTED: boolean;
  in_qualifs(qualifs: ConstQualifs): boolean;
  in_any_value_of_ty(cx: ConstCx, ty: Ty): boolean;
  is_structural_in_adt_value(cx: ConstCx, adt: AdtDef): boolean;
}

function stub_qualif(name: string): Qualif {
  return {
    get ANALYSIS_NAME(): string {
      return unported(`rustc_const_eval::check_consts::qualifs::${name}::ANALYSIS_NAME`);
    },
    get IS_CLEARED_ON_MOVE(): boolean {
      return unported(`rustc_const_eval::check_consts::qualifs::${name}::IS_CLEARED_ON_MOVE`);
    },
    get ALLOW_PROMOTED(): boolean {
      return unported(`rustc_const_eval::check_consts::qualifs::${name}::ALLOW_PROMOTED`);
    },
    in_qualifs: () => unported(`rustc_const_eval::check_consts::qualifs::${name}::in_qualifs`),
    in_any_value_of_ty: () => unported(`rustc_const_eval::check_consts::qualifs::${name}::in_any_value_of_ty`),
    is_structural_in_adt_value: () => unported(`rustc_const_eval::check_consts::qualifs::${name}::is_structural_in_adt_value`),
  };
}

// stub: compiler/rustc_const_eval/src/check_consts/qualifs.rs:79 HasMutInterior (lane mt-promote)
export const HasMutInterior: Qualif = stub_qualif("HasMutInterior");
// stub: compiler/rustc_const_eval/src/check_consts/qualifs.rs:139 NeedsDrop (lane mt-promote)
export const NeedsDrop: Qualif = stub_qualif("NeedsDrop");
// stub: compiler/rustc_const_eval/src/check_consts/qualifs.rs:161 NeedsNonConstDrop (lane mt-promote)
export const NeedsNonConstDrop: Qualif = stub_qualif("NeedsNonConstDrop");

/// Returns `true` if this `Place` contains qualif `Q`.
// stub: compiler/rustc_const_eval/src/check_consts/qualifs.rs:285 in_place (lane mt-promote)
export function in_place(_Q: Qualif, _cx: ConstCx, _in_local: (local: Local) => boolean, _place: PlaceRef): boolean {
  return unported("rustc_const_eval::check_consts::qualifs::in_place");
}
