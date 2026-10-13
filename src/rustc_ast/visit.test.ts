// Walk order and mutation tests for the ports of compiler/rustc_ast/src/{visit,mut_visit,ast_traits}.rs
// and compiler/rustc_ast_ir/src/visit.rs (lane ast-visit; upstream has no tests for these files).
// ASTs are built by hand; the parts a test never walks are opaque stand-ins (`opaque<T>()`), and the
// hooks that would reach them are overridden. Comments cite the upstream lines each assertion follows.
import { describe, expect, test } from "bun:test";
import { ControlFlow, UNIT_RESULT_MISMATCH, VisitorResult } from "../rustc_ast_ir/visit.ts";
import type { Span } from "../rustc_span/span_encoding.ts";
import { Ident, type Symbol } from "../rustc_span/symbol.ts";
import { Panic } from "../std/panic.ts";
import { Err, type Result } from "../std/result.ts";
import {
  type Arm,
  type AssocItem,
  type AssocItemKind,
  Attribute,
  BindingMode,
  type Block,
  Expr,
  type ExprKind,
  type ForeignItemKind,
  type Generics,
  type Impl,
  Item,
  type ItemKind,
  type Lifetime,
  type MacCall,
  type MacCallStmt,
  Pat,
  Path,
  PathSegment,
  Stmt,
  type StmtKind,
  type TraitRef,
  Ty,
  type Visibility,
} from "./ast.ts";
import { AstNodeWrapper, HasAttrs, HasNodeId, HasTokens } from "./ast_traits.ts";
import { MutVisitable, MutVisitor, MutWalkable, walk_expr as mut_walk_expr, walk_flat_map_stmt } from "./mut_visit.ts";
import type { NodeId } from "./node_id.ts";
import { Lit } from "./token.ts";
import type { LazyAttrTokenStream } from "./tokenstream.ts";
import {
  type AssocCtxt,
  BoundKind,
  type FnKind,
  FnCtxt,
  type LifetimeCtxt,
  Visitor,
  walk_block,
  walk_expr,
  walk_item,
  walk_lifetime,
  walk_pat,
  walk_path,
  walk_path_segment,
  walk_stmt,
  walk_ty,
  WalkItemKind,
  Walkable,
} from "./visit.ts";

const sp = (n: number) => n as Span;
const nid = (n: number) => n as NodeId;
const sym = (n: number) => n as Symbol;
/** A node the test never walks into. */
const opaque = <T>(tag: string): T => ({ opaque: tag }) as unknown as T;
const INHERITED: Visibility = { kind: { $: "Inherited" }, span: sp(0) };

function expr(id: number, kind: ExprKind, attrs: Attribute[] = []): Expr {
  return new Expr(nid(id), kind, sp(100 + id), attrs, undefined);
}
function lit(id: number): Expr {
  return expr(id, { $: "Lit", _0: new Lit({ $: "Integer" }, sym(id), undefined) });
}

/** Records the hooks of the immutable visitor in call order. */
class Recorder extends Visitor {
  log: string[] = [];
  override visit_expr(e: Expr): undefined {
    this.log.push(`expr ${e.id}`);
    return walk_expr(this, e);
  }
  override visit_id(id: NodeId): undefined {
    this.log.push(`id ${id}`);
    return undefined;
  }
  override visit_ident(ident: Ident): undefined {
    this.log.push(`ident ${ident.name}`);
    return super.visit_ident(ident);
  }
  override visit_attribute(a: Attribute): undefined {
    this.log.push(`attr ${a.id}`);
    return undefined;
  }
  override visit_path_segment(s: PathSegment): undefined {
    this.log.push(`seg ${s.ident.name}`);
    return undefined;
  }
  override visit_method_receiver_expr(ex: Expr): undefined {
    this.log.push(`receiver ${ex.id}`);
    return super.visit_method_receiver_expr(ex);
  }
  override visit_vis(_v: Visibility): undefined {
    this.log.push("vis");
    return undefined;
  }
  override visit_generics(_g: Generics): undefined {
    this.log.push("generics");
    return undefined;
  }
  override visit_ty(t: Ty): undefined {
    this.log.push(`ty ${t.id}`);
    return undefined;
  }
  override visit_assoc_item(item: Item<AssocItemKind>, ctxt: AssocCtxt): undefined {
    this.log.push(`assoc ${item.id} ${ctxt.$}${ctxt.$ === "Impl" ? ` of_trait=${ctxt.of_trait}` : ""}`);
    return undefined;
  }
  override visit_fn(fk: FnKind, _attrs: Attribute[], _span: Span, id: NodeId): undefined {
    this.log.push(`fn ${id} ${fk.$} ${JSON.stringify(fk.$ === "Fn" ? fk._0 : null)}`);
    return undefined;
  }
  override visit_mac_call(_m: MacCall): undefined {
    this.log.push("mac");
    return undefined;
  }
}

/** A Recorder that walks into types, patterns, paths and lifetimes. */
class Deep extends Recorder {
  override visit_ty(t: Ty): undefined {
    this.log.push(`ty ${t.id}`);
    return walk_ty(this, t);
  }
  override visit_pat(p: Pat): undefined {
    this.log.push(`pat ${p.id}`);
    return walk_pat(this, p);
  }
  override visit_path(p: Path): undefined {
    this.log.push(`path ${p.segments.length}`);
    return walk_path(this, p);
  }
  override visit_path_segment(s: PathSegment): undefined {
    this.log.push(`seg ${s.ident.name}`);
    return walk_path_segment(this, s);
  }
  override visit_lifetime(l: Lifetime, ctxt: LifetimeCtxt): undefined {
    this.log.push(`lifetime ${l.id} ${ctxt}`);
    return walk_lifetime(this, l);
  }
}

/** `&'a x` as a `Ty` (ids 1, 5, 2, 3; spans 50..54). */
function refTy(): Ty {
  const path = new Path(sp(53), [new PathSegment(new Ident(sym(9), sp(54)), nid(3), undefined)]);
  const inner = new Ty(nid(2), { $: "Path", _0: undefined, _1: path }, sp(52));
  return new Ty(nid(1), { $: "Ref", _0: { id: nid(5), ident: new Ident(sym(8), sp(51)) }, _1: inner, _2: "Not" }, sp(50));
}

/** `(y @ _, ..)` as a `Pat` (ids 1..4). */
function tuplePat(): Pat {
  const sub = new Pat(nid(3), { $: "Wild" }, sp(0));
  const ident = new Pat(nid(2), { $: "Ident", _0: BindingMode.NONE, _1: new Ident(sym(7), sp(0)), _2: sub }, sp(0));
  return new Pat(nid(1), { $: "Tuple", _0: [ident, new Pat(nid(4), { $: "Rest" }, sp(0))] }, sp(0));
}

describe("Visitor (visit.rs)", () => {
  test("walk_expr visits id, attrs, the kind's fields in order, then span (visit.rs:1009-1121)", () => {
    // Call(Paren(Lit 3), [Tup([Lit 5, Field(Lit 7, x)])]) with #[attr 9] on the root
    const tree = expr(
      1,
      {
        $: "Call",
        _0: expr(2, { $: "Paren", _0: lit(3) }),
        _1: [expr(4, { $: "Tup", _0: [lit(5), expr(6, { $: "Field", _0: lit(7), _1: new Ident(sym(42), sp(7)) })] })],
      },
      [new Attribute({ $: "DocComment", _0: "Line", _1: sym(0) }, 9 as never, "Outer", sp(9))],
    );
    const v = new Recorder();
    expect(v.visit_expr(tree)).toBeUndefined();
    expect(v.log).toEqual([
      "expr 1", "id 1", "attr 9", // visit_visitable!(vis, id, attrs) (visit.rs:1011)
      "expr 2", "id 2", "expr 3", "id 3", // Call(callee_expression, ..) (visit.rs:1023); Paren (1094); Lit is a no-op (1108)
      "expr 4", "id 4", "expr 5", "id 5", // ThinVec<Box<Expr>> -> visit_expr each (visit.rs:1144); Tup (1021)
      "expr 6", "id 6", "expr 7", "id 7", "ident 42", // Field(subexpression, ident) (visit.rs:1075)
    ]);
  });

  test("MethodCall visits the receiver first, then seg, args (visit.rs:1002-1007)", () => {
    const mc = expr(1, {
      $: "MethodCall",
      _0: { seg: new PathSegment(new Ident(sym(8), sp(0)), nid(50), undefined), receiver: lit(2), args: [lit(3)], span: sp(1) },
    });
    const v = new Recorder();
    v.visit_expr(mc);
    expect(v.log).toEqual(["expr 1", "id 1", "receiver 2", "expr 2", "id 2", "seg 8", "expr 3", "id 3"]);
  });

  test("closures: constness, movability, capture_clause, visit_fn, then the spans (visit.rs:1058-1061)", () => {
    const closure = expr(1, {
      $: "Closure",
      _0: {
        binder: { $: "NotPresent" },
        capture_clause: { $: "Ref" },
        constness: { $: "Yes", _0: sp(9) },
        coroutine_marker: undefined,
        movability: "Movable",
        fn_decl: opaque("decl"),
        body: lit(2),
        fn_decl_span: sp(3),
        fn_arg_span: sp(4),
      },
    });
    const v = new (class extends Recorder {
      override visit_capture_by(): undefined {
        this.log.push("capture");
        return undefined;
      }
    })();
    // `Const` is walked by its derived `Walkable` impl (tools/codegen walkable.gen.ts).
    v.visit_expr(closure);
    expect(v.log).toEqual(["expr 1", "id 1", "capture", "fn 1 Closure null"]);
  });

  test("walk_item: id, attrs, vis, kind, span (visit.rs:813-817); ExternCrate visits the ident (853)", () => {
    const item = new Item<ItemKind>([], nid(10), sp(1), INHERITED, { $: "ExternCrate", _0: undefined, _1: new Ident(sym(11), sp(2)) }, undefined);
    const v = new Recorder();
    v.visit_item(item);
    expect(v.log).toEqual(["id 10", "vis", "ident 11"]);
  });

  test("Impl: generics, self_ty, then items with AssocCtxt::Impl (visit.rs:989-999)", () => {
    const assoc = new Item<AssocItemKind>([], nid(21), sp(1), INHERITED, opaque("assoc kind"), undefined);
    const item = new Item<ItemKind>([], nid(20), sp(1), INHERITED, {
      $: "Impl",
      _0: { generics: opaque("generics"), constness: opaque("const"), of_trait: undefined, self_ty: new Ty(nid(22), opaque("ty"), sp(0)), items: [assoc] },
    }, undefined);
    const v = new Recorder();
    v.visit_item(item);
    expect(v.log).toEqual(["id 20", "vis", "generics", "ty 22", "assoc 21 Impl of_trait=false"]);
  });

  test("fn items of each kind get their FnCtxt (visit.rs:850, 914, 945)", () => {
    const f = opaque<never>("fn");
    const v = new Recorder();
    walk_item(v, new Item<ItemKind>([], nid(1), sp(0), INHERITED, { $: "Fn", _0: f }, undefined), WalkItemKind.ItemKind);
    walk_item(v, new Item<ForeignItemKind>([], nid(2), sp(0), INHERITED, { $: "Fn", _0: f }, undefined), WalkItemKind.ForeignItemKind);
    Visitor.prototype.visit_assoc_item.call(v, new Item<AssocItemKind>([], nid(3), sp(0), INHERITED, { $: "Fn", _0: f }, undefined), { $: "Impl", of_trait: true });
    expect(v.log).toEqual([
      "id 1", "vis", `fn 1 Fn ${JSON.stringify(FnCtxt.Free)}`,
      "id 2", "vis", `fn 2 Fn ${JSON.stringify(FnCtxt.Foreign)}`,
      "id 3", "vis", `fn 3 Fn {"$":"Assoc","_0":{"$":"Impl","of_trait":true}}`,
    ]);
  });

  test("walk_stmt: id, then the kind; MacCall visits attrs then the mac (visit.rs:1158-1173)", () => {
    const v = new Recorder();
    walk_stmt(v, new Stmt(nid(30), { $: "Semi", _0: lit(31) }, sp(0)));
    const mac: MacCallStmt = { mac: opaque("mac"), style: "Semicolon", attrs: [new Attribute({ $: "DocComment", _0: "Line", _1: sym(0) }, 33 as never, "Outer", sp(0))], tokens: undefined };
    v.visit_stmt(new Stmt(nid(32), { $: "MacCall", _0: mac }, sp(0)));
    expect(v.log).toEqual(["id 30", "expr 31", "id 31", "id 32", "attr 33", "mac"]);
  });

  test("ControlFlow result: try_visit! returns the Break from the walk (rustc_ast_ir visit.rs:68-78)", () => {
    class FindId extends Visitor<ControlFlow<NodeId>> {
      override Result = VisitorResult.ControlFlow<NodeId>();
      seen: number[] = [];
      override visit_id(id: NodeId): ControlFlow<NodeId> {
        this.seen.push(id);
        return id === 5 ? ControlFlow.Break(id) : ControlFlow.CONTINUE;
      }
    }
    const tree = expr(1, { $: "Tup", _0: [lit(2), expr(4, { $: "Paren", _0: lit(5) }), lit(6)] });
    const v = new FindId();
    expect(v.visit_expr(tree)).toEqual({ $: "Break", _0: nid(5) });
    expect(v.seen).toEqual([1, 2, 4, 5]); // lit 6 is never reached
    const w = new FindId();
    expect(w.visit_expr(lit(9))).toBe(ControlFlow.CONTINUE); // `V::Result::output()`
  });

  test("ControlFlow<()> Break with a `()` (`null`) payload still stops the walk (try_visit returns from_residual)", () => {
    class FindUnit extends Visitor<ControlFlow<null>> {
      override Result = VisitorResult.ControlFlow<null>();
      seen: number[] = [];
      override visit_id(id: NodeId): ControlFlow<null> {
        this.seen.push(id);
        return id === 4 ? ControlFlow.Break(null) : ControlFlow.CONTINUE;
      }
    }
    const v = new FindUnit();
    const tree = expr(1, { $: "Tup", _0: [lit(2), lit(4), lit(6)] });
    expect(v.visit_expr(tree)).toStrictEqual({ $: "Break", _0: null });
    expect(v.seen).toEqual([1, 2, 4]); // lit 6 is never reached
  });

  // Review w456a ast-visit M1 (reviewer's tmp/review-w456a/ast-visit/footgun.ts): rustc rejects a
  // visitor whose hooks return `ControlFlow` while `type Result` is `()`; the port panics instead of
  // silently turning the Break into Continue.
  test("a ControlFlow visitor that forgot `override Result` panics instead of dropping the Break", () => {
    class Find extends Visitor<ControlFlow<NodeId>> {
      override visit_id(id: NodeId): ControlFlow<NodeId> {
        return ControlFlow.Break(id);
      }
    }
    const e = expr(1, { $: "Paren", _0: expr(2, { $: "Underscore" }) });
    expect(() => walk_expr(new Find(), e)).toThrow(new Panic(UNIT_RESULT_MISMATCH));
    // A `()` visitor returning `Continue` objects is caught too, and `from_branch` rejects a Break.
    expect(() => VisitorResult.unit.branch(ControlFlow.CONTINUE as never)).toThrow(new Panic(UNIT_RESULT_MISMATCH));
    expect(() => VisitorResult.unit.from_branch(ControlFlow.Break(0) as never)).toThrow(new Panic(UNIT_RESULT_MISMATCH));
    expect(VisitorResult.unit.from_branch(ControlFlow.CONTINUE as never)).toBeUndefined();
  });

  test("Result<(), E> result maps Break to Err (rustc_ast_ir visit.rs:44-65)", () => {
    class Fail extends Visitor<Result<null, string>> {
      override Result = VisitorResult.Result<string>();
      override visit_ident(ident: Ident): Result<null, string> {
        return Err(`ident ${ident.name}`);
      }
    }
    const tree = expr(1, { $: "Field", _0: lit(2), _1: new Ident(sym(7), sp(0)) });
    expect(new Fail().visit_expr(tree)).toEqual({ $: "Err", _0: "ident 7" });
    expect(new Fail().visit_expr(lit(3))).toStrictEqual({ $: "Ok", _0: null }); // `()` as a stored value is `null`
  });

  // Derived `Walkable` impls (rustc_macros/src/visitable.rs, generated into walkable.gen.ts): each
  // field in declaration order, with the field's `#[visitable(extra = ..)]`.
  test("derived Walkable: Block visits stmts, id, rules, span (ast.rs:624 field order)", () => {
    const v = new Recorder();
    const block: Block = { stmts: [new Stmt(nid(20), { $: "Expr", _0: lit(2) }, sp(1))], id: nid(10), rules: { $: "Default" }, span: sp(2) };
    walk_block(v, block);
    expect(v.log).toEqual(["id 20", "expr 2", "id 2", "id 10"]);
  });

  test("derived Walkable: Ty / TyKind::Ref (lifetime with LifetimeCtxt::Ref) / Path / PathSegment", () => {
    const v = new Deep();
    v.visit_ty(refTy());
    expect(v.log).toEqual(["ty 1", "id 1", "lifetime 5 Ref", "id 5", "ident 8", "ty 2", "id 2", "path 1", "seg 9", "ident 9", "id 3"]);
  });

  test("derived Walkable: Pat / PatKind::Tuple / PatKind::Ident (BindingMode, Ident, Option<Box<Pat>>)", () => {
    const v = new Deep();
    v.visit_pat(tuplePat());
    expect(v.log).toEqual(["pat 1", "id 1", "pat 2", "id 2", "ident 7", "pat 3", "id 3", "pat 4", "id 4"]);
  });

  test("derived Walkable: try_visit! stops the walk at a Break inside a derived impl", () => {
    class FindId extends Visitor<ControlFlow<NodeId>> {
      override Result = VisitorResult.ControlFlow<NodeId>();
      seen: number[] = [];
      override visit_id(id: NodeId): ControlFlow<NodeId> {
        this.seen.push(id);
        return id === 3 ? ControlFlow.Break(id) : ControlFlow.CONTINUE;
      }
    }
    const v = new FindId();
    expect(walk_pat(v, tuplePat())).toEqual({ $: "Break", _0: nid(3) });
    expect(v.seen).toEqual([1, 2, 3]); // pat 4 is never reached
  });

  test("visit_lifetime takes its LifetimeCtxt extra (visit.rs:345)", () => {
    const seen: string[] = [];
    class L extends Visitor {
      override visit_lifetime(_l: Lifetime, ctxt: "Ref" | "Bound" | "GenericArg"): undefined {
        seen.push(ctxt);
        return undefined;
      }
    }
    const v = new L();
    v.visit_lifetime(opaque("lt"), "Bound");
    expect(seen).toEqual(["Bound"]);
  });

  // visit.rs:989-999: generics, then (if `of_trait`) defaultness, safety, polarity, trait_ref, then self_ty,
  // then the items with `AssocCtxt::Impl { of_trait: of_trait.is_some() }`.
  test("Impl walk order with and without of_trait (visit.rs:989-999)", () => {
    class V extends Recorder {
      override visit_trait_ref(_t: TraitRef): undefined {
        this.log.push("trait_ref");
        return undefined;
      }
      override visit_assoc_item(_i: AssocItem, ctxt: AssocCtxt): undefined {
        this.log.push(`assoc ${JSON.stringify(ctxt)}`);
        return undefined;
      }
    }
    const impl_ = (of_trait: boolean): Impl => ({
      generics: opaque("generics"),
      constness: opaque("constness"),
      of_trait: of_trait
        ? { defaultness: { $: "Default", _0: sp(1) }, safety: { $: "Unsafe", _0: sp(2) }, polarity: { $: "Negative", _0: sp(3) }, trait_ref: opaque("trait_ref") }
        : undefined,
      self_ty: new Ty(nid(7), opaque("tykind"), sp(4)),
      items: [opaque("item")],
    });
    const v = new V();
    Walkable.Impl(impl_(true), v);
    expect(v.log).toEqual(["generics", "trait_ref", "ty 7", 'assoc {"$":"Impl","of_trait":true}']);
    const w = new V();
    Walkable.Impl(impl_(false), w);
    expect(w.log).toEqual(["generics", "ty 7", 'assoc {"$":"Impl","of_trait":false}']);

    // The mutable walk also visits the header's spans (mut_visit.rs: `Span` is `visit_span`), in field order.
    const log: string[] = [];
    class M extends MutVisitor {
      override visit_generics(_g: Generics): void {
        log.push("generics");
      }
      override visit_span(s: { value: Span }): void {
        log.push(`span ${s.value}`);
      }
      override visit_trait_ref(_t: TraitRef): void {
        log.push("trait_ref");
      }
      override visit_ty(t: Ty): void {
        log.push(`ty ${t.id}`);
      }
      override flat_map_assoc_item(i: AssocItem, ctxt: AssocCtxt): AssocItem[] {
        log.push(`assoc ${JSON.stringify(ctxt)}`);
        return [i];
      }
    }
    MutWalkable.Impl(impl_(true), new M());
    expect(log).toEqual(["generics", "span 1", "span 2", "span 3", "trait_ref", "ty 7", 'assoc {"$":"Impl","of_trait":true}']);
  });

  test("BoundKind::descr (visit.rs:57-64)", () => {
    expect(BoundKind.descr(BoundKind.Bound)).toBe("bounds");
    expect(BoundKind.descr("Impl")).toBe("`impl Trait`");
    expect(BoundKind.descr("TraitObject")).toBe("`dyn` trait object bounds");
    expect(BoundKind.descr("SuperTraits")).toBe("supertrait bounds");
  });
});

describe("MutVisitor (mut_visit.rs)", () => {
  class Renumber extends MutVisitor {
    next = 100;
    spans: number[] = [];
    override visit_id(id: { value: NodeId }): void {
      id.value = nid(this.next++);
    }
    override visit_span(s: { value: Span }): void {
      this.spans.push(s.value);
    }
  }

  test("derived MutWalkable: Ty is renumbered in walk order; the lifetime gets LifetimeCtxt::Ref (mut_visit.rs)", () => {
    const ctxts: string[] = [];
    class R2 extends Renumber {
      override visit_lifetime(l: Lifetime, ctxt: LifetimeCtxt): void {
        ctxts.push(ctxt);
        super.visit_lifetime(l, ctxt);
      }
    }
    const t = refTy();
    const v = new R2();
    v.visit_ty(t);
    const k = t.kind as { _0: Lifetime; _1: Ty };
    const p = (k._1.kind as { _1: Path })._1;
    expect([t.id, k._0.id, k._1.id, p.segments[0]!.id]).toEqual([nid(100), nid(101), nid(102), nid(103)]);
    expect(ctxts).toEqual(["Ref"]);
    // Spans: lifetime ident, path span, segment ident, inner Ty span, outer Ty span.
    expect(v.spans).toEqual([51, 53, 54, 52, 50]);
  });

  // Review w456a ast-visit M2: rustc_expand's `visit_method_receiver_expr` does
  // `self.visit_node(AstNodeWrapper::from_mut(node, MethodReceiverTag))` and `visit_node` stores the
  // expansion with `*node = ..` (expand.rs:2468-2480, :2607). The store must reach the receiver slot.
  test("AstNodeWrapper::from_mut writes a replacement through to the caller's node (ast_traits.rs:332)", () => {
    class Expand extends MutVisitor {
      override visit_method_receiver_expr(ex: Expr): void {
        const node = AstNodeWrapper.from_mut(ex, "MethodReceiverTag");
        if (node.wrapped.kind.$ === "Underscore") node.wrapped = lit(42); // `*node = self.collect_bang(..)`
      }
    }
    const receiver = expr(2, { $: "Underscore" });
    const call = { seg: new PathSegment(new Ident(sym(5), sp(0)), nid(6), undefined), receiver, args: [], span: sp(7) };
    const tree = expr(1, { $: "MethodCall", _0: call } as ExprKind);
    mut_walk_expr(new Expand(), tree);
    expect(call.receiver).toBe(receiver); // the slot keeps its object; its contents are replaced
    expect(receiver.id).toBe(nid(42));
    expect(receiver.kind.$).toBe("Lit");
    expect(receiver).toBeInstanceOf(Expr);

    // `*w = new_wrapper` written `Object.assign(w, new_wrapper)` also writes through.
    const e = expr(3, { $: "Underscore" });
    const w = AstNodeWrapper.from_mut(e, "MethodReceiverTag");
    Object.assign(w, AstNodeWrapper.new(expr(9, { $: "Paren", _0: lit(10) }), "MethodReceiverTag"));
    expect(w.wrapped).toBe(e);
    expect(e.id).toBe(nid(9));
    expect(e.kind.$).toBe("Paren");
  });

  // mut_visit.rs:69-78: the mutable `Spanned<T>` impl visits `span` first, then `node` (the immutable
  // impl ignores the span).
  test("mutable Spanned<T> visits the span before the node (mut_visit.rs:69)", () => {
    const log: string[] = [];
    class S extends MutVisitor {
      override visit_span(s: { value: Span }): void {
        log.push(`span ${s.value}`);
      }
    }
    const holder = { op: { node: { tag: "node" }, span: sp(9) } };
    const T_ = <K extends PropertyKey>(o: { [P in K]: { tag: string } }, k: K): void => {
      log.push(`node ${o[k].tag}`);
    };
    MutVisitable.Spanned(holder, "op", new S(), undefined, T_);
    expect(log).toEqual(["span 9", "node node"]);
  });

  test("visit_id gets a writable place; ids are renumbered in walk order (visit.rs:1010-1011)", () => {
    const inner = lit(3);
    const tree = expr(1, { $: "Assign", _0: expr(2, { $: "Paren", _0: inner }), _1: lit(4), _2: sp(77) });
    const v = new Renumber();
    v.visit_expr(tree);
    expect(tree.id).toBe(nid(100));
    expect((tree.kind as { _0: Expr })._0.id).toBe(nid(101));
    expect(inner.id).toBe(nid(102));
    expect((tree.kind as { _1: Expr })._1.id).toBe(nid(103));
    // Spans: inner exprs' spans after their kinds, then Assign's span field, then the root span.
    expect(v.spans).toEqual([103, 102, 104, 77, 101]);
  });

  test("filter_map_expr removes list elements in place (mut_visit.rs:260-268, flat_map_in_place)", () => {
    class DropLits extends MutVisitor {
      override filter_map_expr(e: Expr): Expr | undefined {
        return e.kind.$ === "Lit" ? undefined : super.filter_map_expr(e);
      }
    }
    const keep = expr(3, { $: "Paren", _0: lit(4) });
    const arr: Expr[] = [lit(2), keep, lit(5)];
    const tree = expr(1, { $: "Array", _0: arr });
    mut_walk_expr(new DropLits(), tree);
    expect(arr).toEqual([keep]); // same array object, edited in place
    expect((keep.kind as { _0: Expr })._0.kind.$).toBe("Lit"); // a `Box<Expr>` field is not a list
  });

  test("flat_map_in_place keeps order when an element expands to several (mut_visit.rs:269)", () => {
    const a = opaque<Arm>("a"), b = opaque<Arm>("b"), c = opaque<Arm>("c"), a2 = opaque<Arm>("a2");
    class Dup extends MutVisitor {
      override flat_map_arm(arm: Arm): Arm[] {
        return arm === a ? [a, a2] : arm === b ? [] : [arm];
      }
    }
    const holder = { arms: [a, b, c] };
    MutVisitable["ThinVec<Arm>"](holder, "arms", new Dup(), undefined);
    expect(holder.arms).toEqual([a, a2, c]);
  });

  test("walk_flat_map_stmt: visit_id, then the kind, then visit_span on the single result (mut_visit.rs:325-343)", () => {
    const v = new Renumber();
    const out = walk_flat_map_stmt(v, new Stmt(nid(1), { $: "Expr", _0: lit(2) }, sp(55)));
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(nid(100));
    expect((out[0]!.kind as { _0: Expr })._0.id).toBe(nid(101));
    expect(v.spans).toEqual([102, 55]);
  });

  test("walk_flat_map_stmt panics when a statement is duplicated (mut_visit.rs:337-340)", () => {
    class TwoItems extends MutVisitor {
      override flat_map_item(i: Item): Item[] {
        return [i, i];
      }
    }
    const item = new Item<ItemKind>([], nid(5), sp(0), INHERITED, opaque("kind"), undefined);
    expect(() => walk_flat_map_stmt(new TwoItems(), new Stmt(nid(1), { $: "Item", _0: item }, sp(0)))).toThrow(
      new Panic("cloning statement `NodeId`s is prohibited by default, the visitor should implement custom statement visiting"),
    );
  });

  test("filter_map_expr returning None drops an Expr statement (mut_visit.rs:355)", () => {
    class DropAll extends MutVisitor {
      override filter_map_expr(_e: Expr): Expr | undefined {
        return undefined;
      }
    }
    expect(walk_flat_map_stmt(new DropAll(), new Stmt(nid(1), { $: "Semi", _0: lit(2) }, sp(0)))).toEqual([]);
  });

  test("visit_ident: a span write replaces the Ident in its slot, never the shared object (visit.rs:634-639)", () => {
    class Respan extends MutVisitor {
      override visit_span(s: { value: Span }): void {
        s.value = sp(999);
      }
    }
    const shared = new Ident(sym(1), sp(5));
    const kind: ExprKind = { $: "Field", _0: lit(2), _1: shared };
    new Respan().visit_expr(expr(1, kind));
    expect((kind as { _1: Ident })._1).not.toBe(shared);
    expect((kind as { _1: Ident })._1).toEqual(new Ident(sym(1), sp(999)));
    expect(shared.span).toBe(sp(5));
  });
});

describe("ast_traits.rs", () => {
  const tokens = opaque<LazyAttrTokenStream>("tokens");

  test("HasNodeId: node_id / node_id_mut through Box and AstNodeWrapper (ast_traits.rs:25-28, 56-59, 346-349)", () => {
    const e = lit(4);
    expect(HasNodeId.Expr.node_id(e)).toBe(nid(4));
    HasNodeId.Box(HasNodeId.Expr).node_id_mut(e).value = nid(8);
    expect(e.id).toBe(nid(8));
    const w = AstNodeWrapper.new(e, "OptExprTag");
    const W = HasNodeId.AstNodeWrapper<Expr, string>(HasNodeId.Expr);
    W.node_id_mut(w).value = nid(9);
    expect(W.node_id(w)).toBe(nid(9));
    expect(AstNodeWrapper.from(w).wrapped).toBe(e);
    expect(AstNodeWrapper.from_mut(e, "tag").wrapped).toBe(e);
  });

  test("HasTokens: StmtKind / Stmt / Option and the none impls (ast_traits.rs:74-182)", () => {
    const e = new Expr(nid(1), { $: "Underscore" }, sp(0), [], tokens);
    const stmt = new Stmt(nid(2), { $: "Expr", _0: e }, sp(0));
    expect(HasTokens.Stmt.tokens(stmt)).toBe(tokens);
    HasTokens.Stmt.tokens_mut(stmt)!.value = undefined;
    expect(e.tokens).toBeUndefined();
    expect(HasTokens.StmtKind.tokens({ $: "Empty" } as StmtKind)).toBeUndefined();
    expect(HasTokens.Arm.tokens_mut(opaque("arm"))).toBeUndefined();
    expect(HasTokens.Option(HasTokens.Expr).tokens(undefined)).toBeUndefined();
    const doc = new Attribute({ $: "DocComment", _0: "Line", _1: sym(0) }, 0 as never, "Outer", sp(0));
    expect(() => HasTokens.Attribute.tokens(doc)).toThrow(Panic); // unreachable!() (ast_traits.rs:173)
  });

  test("HasAttrs: consts, attrs, visit_attrs edits in place (ast_traits.rs:198-318)", () => {
    const a = new Attribute({ $: "DocComment", _0: "Line", _1: sym(0) }, 1 as never, "Outer", sp(0));
    const e = expr(1, { $: "Underscore" });
    const stmt = new Stmt(nid(2), { $: "Semi", _0: e }, sp(0));
    expect(HasAttrs.Item.SUPPORTS_CUSTOM_INNER_ATTRS).toBe(true);
    expect(HasAttrs.Expr.SUPPORTS_CUSTOM_INNER_ATTRS).toBe(false);
    expect(HasAttrs.Ty.SUPPORTS_CUSTOM_INNER_ATTRS).toBe(false);
    expect(HasAttrs.Stmt.SUPPORTS_CUSTOM_INNER_ATTRS).toBe(true); // = StmtKind's (ast_traits.rs:287, 311)
    HasAttrs.Stmt.visit_attrs(stmt, (attrs) => attrs.splice(0, 0, a));
    expect(e.attrs).toEqual([a]);
    expect(HasAttrs.Stmt.attrs(stmt)).toEqual([a]);
    expect(HasAttrs.Ty.attrs(new Ty(nid(3), opaque("k"), sp(0)))).toEqual([]);
    const W = HasAttrs.AstNodeWrapper<Expr, string>(HasAttrs.Box(HasAttrs.Expr));
    expect(W.attrs(AstNodeWrapper.new(e, "tag"))).toEqual([a]);
    expect(HasAttrs.Option(HasAttrs.Expr).attrs(undefined)).toEqual([]);
  });
});
