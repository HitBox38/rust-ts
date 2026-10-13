// Port of compiler/rustc_builtin_macros/src/define_opaque.rs
import { ast } from "../rustc_ast/lib.ts";
import { DUMMY_NODE_ID } from "../rustc_ast/node_id.ts";
import type { NodeId } from "../rustc_ast/lib.ts";
import type { Annotatable, ExtCtxt } from "../rustc_expand/base.ts";
import type { Span } from "../rustc_span/lib.ts";
import { field_mut, type MutRef } from "../std/mut_ref.ts";

type DefineOpaque = [NodeId, ast.Path][] | undefined;

/** PORT: `&mut x.define_opaque` of a `Fn` / `ConstItem` / `StaticItem` item kind. */
function define_opaque_of(kind: ast.ItemKind | ast.AssocItemKind, assoc: boolean): MutRef<DefineOpaque> | undefined {
  switch (kind.$) {
    case "Fn":
      return field_mut(kind._0, "define_opaque");
    case "Const":
      return field_mut(kind._0, "define_opaque");
    case "Static":
      return assoc ? undefined : field_mut((kind as Extract<ast.ItemKind, { $: "Static" }>)._0, "define_opaque");
    default:
      return undefined;
  }
}

// rustc: compiler/rustc_builtin_macros/src/define_opaque.rs:5 expand
export function expand(ecx: ExtCtxt, _expand_span: Span, meta_item: ast.MetaItem, item: Annotatable): Annotatable[] {
  let define_opaque: MutRef<DefineOpaque> | undefined;
  switch (item.$) {
    case "Item": {
      const p = item._0;
      define_opaque = define_opaque_of(p.kind, false);
      break;
    }
    case "AssocItem": {
      const i = item._0;
      define_opaque = define_opaque_of(i.kind, true);
      break;
    }
    case "Stmt": {
      const s = item._0;
      define_opaque = s.kind.$ === "Item" ? define_opaque_of(s.kind._0.kind, false) : undefined;
      break;
    }
    default:
      define_opaque = undefined;
  }

  const list = meta_item.meta_item_list();
  if (list === undefined) {
    ecx.dcx().span_err(meta_item.span, "expected list of type aliases");
    return [item];
  }

  if (define_opaque !== undefined) {
    const v: [NodeId, ast.Path][] = [];
    for (const entry of list) {
      if (entry.$ === "MetaItem" && entry._0.is_word()) {
        const meta_item_ = entry._0;
        v.push([DUMMY_NODE_ID, ast.clone_Path(meta_item_.path)]);
      } else {
        ecx.dcx().span_err(ast.MetaItemInner.span(entry), "expected path to type alias");
      }
    }
    define_opaque.value = v;
  } else {
    ecx.dcx().span_err(meta_item.span, "only functions, statics, and consts can define opaque types");
  }

  return [item];
}
