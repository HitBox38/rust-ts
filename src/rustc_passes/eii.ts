// Port of compiler/rustc_passes/src/eii.rs
//! Checks necessary for externally implementable items:
//! Are all items implemented etc.?
import type { EiiDecl, EiiImpl } from "../rustc_attr_ir/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { DuplicateEiiImpls_diagnostic } from "../rustc_middle/diagnostics.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type CrateNum, type DefId, DefIdMap, LOCAL_CRATE } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import { unwrap } from "../std/panic.ts";
import { EiiWithoutImpl_diagnostic } from "./diagnostics.ts";

// rustc-type: compiler/rustc_passes/src/eii.rs:16 CheckingMode
// #[derive(Clone, Copy, Debug)]
type CheckingMode = "CheckDuplicates" | "CheckExistence";
const CheckingMode = { CheckDuplicates: "CheckDuplicates", CheckExistence: "CheckExistence" } as const;

// rustc: compiler/rustc_passes/src/eii.rs:21 get_checking_mode
function get_checking_mode(tcx: TyCtxt): CheckingMode {
  // if any of the crate types is not rlib, we must check for existence.
  if (tcx.crate_types().some((i) => !(i === "Rlib"))) {
    return CheckingMode.CheckExistence;
  } else {
    return CheckingMode.CheckDuplicates;
  }
}

// #[derive(Debug)] struct FoundImpl (eii.rs:48), local to `check_externally_implementable_items`.
interface FoundImpl {
  imp: EiiImpl;
  impl_crate: CrateNum;
}

// #[derive(Debug)] struct FoundEii (eii.rs:54), local to `check_externally_implementable_items`.
interface FoundEii {
  decl: EiiDecl;
  decl_crate: CrateNum;
  impls: DefIdMap<FoundImpl>;
}

/// Checks for a given crate, what EIIs need to be generated in it.
/// This is usually a small subset of all EIIs.
///
/// EII implementations come in two varieties: explicit and default.
/// This query is called once for every crate, to check whether there aren't any duplicate explicit implementations.
/// A duplicate may be caused by an implementation in the current crate,
/// though it's also entirely possible that the source is two dependencies with an explicit implementation.
/// Those work fine on their own but the combination of the two is a conflict.
///
/// However, if the current crate is a "root" crate, one that generates a final artifact like a binary,
/// then we check one more thing, namely that every EII actually has an implementation, either default or not.
/// If one EII has no implementation, that's an error at that point.
///
/// These two behaviors are implemented using `CheckingMode`.
// rustc: compiler/rustc_passes/src/eii.rs:44 check_externally_implementable_items
export function check_externally_implementable_items(tcx: TyCtxt, _: null): null {
  const checking_mode = get_checking_mode(tcx);

  // PORT: `FxIndexMap<DefId, _>` is a `DefIdMap` (keyed by value, insertion-ordered; `set` on an existing key keeps
  // its position, like `IndexMap::insert`).
  const eiis = new DefIdMap<FoundEii>();

  // collect all the EII declarations, and possibly implementations from all descendent crates
  for (const cnum of [...tcx.crates(null), LOCAL_CRATE]) {
    // get the eiis for the crate we're currently looking at
    const crate_eiis = tcx.externally_implementable_items(cnum);

    // update or insert the corresponding entries
    for (const [did, [decl_, impls]] of crate_eiis) {
      const decl = decl_ as EiiDecl;
      let entry = eiis.get(did);
      if (entry === undefined) {
        entry = {
          decl,
          decl_crate: cnum,
          impls: new DefIdMap(),
        };
        eiis.set(did, entry);
      }
      for (const [did_, i] of impls) {
        entry.impls.set(did_, { imp: i as EiiImpl, impl_crate: cnum });
      }
    }
  }

  // now we have all eiis! For each of them, choose one we want to actually generate.
  for (const [foreign_item, { decl, decl_crate, impls }] of eiis) {
    const default_impls: [DefId, CrateNum][] = [];
    const explicit_impls: [DefId, CrateNum][] = [];

    for (const [impl_did, { imp, impl_crate }] of impls) {
      if (imp.is_default) {
        default_impls.push([impl_did, impl_crate]);
      } else {
        explicit_impls.push([impl_did, impl_crate]);
      }
    }

    // more than one explicit implementation (across all crates)
    // is instantly an error.
    if (explicit_impls.length > 1) {
      tcx.dcx().emit_err(
        DuplicateEiiImpls_diagnostic({
          name: decl.name.name,
          first_span: tcx.def_span(explicit_impls[0]![0]),
          first_crate: tcx.crate_name(explicit_impls[0]![1]),
          second_span: tcx.def_span(explicit_impls[1]![0]),
          second_crate: tcx.crate_name(explicit_impls[1]![1]),

          help: null,

          additional_crates: explicit_impls.length > 2 ? null : undefined,
          num_additional_crates: explicit_impls.length - 2,
          additional_crate_names: explicit_impls
            .slice(2)
            .map((i) => `\`${display_Symbol(tcx.crate_name(i[1]))}\``)
            .join(", "),
        }),
      );
    }

    if (default_impls.length > 1) {
      const decl_span = unwrap(tcx.def_ident_span(foreign_item) as Span | undefined);
      tcx.dcx().span_delayed_bug(decl_span, "multiple not supported right now");
    }

    // note, for a single crate we never need to generate both a default and an explicit implementation.
    // In that case, generating the explicit implementation is enough!
    let local_impl: DefId;
    let is_default: boolean;
    if (explicit_impls[0] !== undefined) {
      // If we find an explicit implementation, it's instantly the chosen implementation.
      [local_impl, is_default] = [explicit_impls[0][0], false];
    } else if (default_impls[0] !== undefined) {
      // if we find a default implementation, we can emit it but the alias should be weak
      [local_impl, is_default] = [default_impls[0][0], true];
    } else if (checking_mode === "CheckDuplicates") {
      // if we find no explicit implementation,
      // that's fine if we're only checking for duplicates.
      // The existence will be checked somewhere else in a crate downstream.
      continue;
    } else {
      // We have a target to generate, but no impl to put in it. error!
      tcx.dcx().emit_err(
        EiiWithoutImpl_diagnostic({
          current_crate_name: tcx.crate_name(LOCAL_CRATE),
          decl_crate_name: tcx.crate_name(decl_crate),
          // FIXME: shouldn't call `item_name`
          name: decl.name.name,
          kind: DefKind.descr(tcx.def_kind(decl.foreign_item), decl.foreign_item),
          span: decl.name.span,
          help: null,
        }),
      );

      continue;
    }

    // if it's not local, who cares about generating it.
    // That's the local crates' responsibility
    const chosen_impl = local_impl.as_local();
    if (chosen_impl === undefined) {
      continue;
    }

    // tracing::debug!("generating EII {chosen_impl:?} (default={is_default})");
    void is_default;
  }
  return null;
}
