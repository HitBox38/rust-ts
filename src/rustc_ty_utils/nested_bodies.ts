// Port of compiler/rustc_ty_utils/src/nested_bodies.rs (lane ty-utils).
import type { BodyId } from "../rustc_hir/hir.ts";
import { Visitor } from "../rustc_hir/intravisit.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import type { LocalDefId } from "../rustc_span/def_id.ts";

// rustc: compiler/rustc_ty_utils/src/nested_bodies.rs:7 nested_bodies_within
function nested_bodies_within(tcx: TyCtxt, item: LocalDefId): List<LocalDefId> {
  const body = tcx.hir_body_owned_by(item);
  const collector = new NestedBodiesVisitor(tcx, item, []);
  collector.visit_body(body);
  return tcx.mk_local_def_ids(collector.nested_bodies);
}

// rustc-type: compiler/rustc_ty_utils/src/nested_bodies.rs:14 NestedBodiesVisitor
class NestedBodiesVisitor extends Visitor {
  constructor(
    readonly tcx: TyCtxt,
    readonly root_def_id: LocalDefId,
    readonly nested_bodies: LocalDefId[],
  ) {
    super();
  }

  // ---- impl<'tcx> Visitor<'tcx> for NestedBodiesVisitor<'tcx> ----

  // rustc: compiler/rustc_ty_utils/src/nested_bodies.rs:21 visit_nested_body
  override visit_nested_body(id: BodyId): undefined {
    const body_def_id = this.tcx.hir_body_owner_def_id(id);
    if (this.tcx.typeck_root_def_id_local(body_def_id) === this.root_def_id) {
      // We visit nested bodies before adding the current body. This
      // means that nested bodies are always stored before their parent.
      const body = this.tcx.hir_body(id);
      this.visit_body(body);
      this.nested_bodies.push(body_def_id);
    }
    return undefined;
  }
}

// rustc: compiler/rustc_ty_utils/src/nested_bodies.rs:33 provide
export function provide(providers: Providers): void {
  providers.nested_bodies_within = nested_bodies_within;
}
