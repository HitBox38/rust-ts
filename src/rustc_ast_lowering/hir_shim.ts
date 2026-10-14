// PORT(hir-shim): temporary stand-in for the HIR types of `compiler/rustc_hir/src/hir.rs`, which lane
// hir-types generates in parallel (wave 13). It is not a port of any upstream file.
//
// rustc_ast_lowering names HIR types as `hir::X` (`use rustc_hir as hir`); its TS modules write `hir.X`
// with `import type * as hir from "./hir_shim.ts"`. Every name below is an upstream type of hir.rs
// (`rustc_hir::X`, re-exported at the crate root by `pub use hir::*`), plus `rustc_hir::lints::DelayedLint`.
// The ast re-exports of hir.rs (`BindingMode`, `CaptureBy`, `UnOp`, ...) and the rustc_hir_id ids
// (`HirId`, `OwnerId`, `ItemLocalId`) are imported from rustc_ast / rustc_hir_id directly, not from here.
//
// On integration with hir-types, root replaces this file's body with
//     export type * from "../rustc_hir/lib.ts";      (or the module hir-types exports hir.rs from)
//     export type { DelayedLint } from "../rustc_hir/lints.ts";
// and tsc then checks every contract signature against the generated types (a name hir-types did not
// generate is a compile error, not a silent `unknown`). Generic parameters kept here are the non-lifetime
// ones of the upstream types (`OpaqueTyOrigin<D>`, `Ty<Unambig = ()>`, `ConstArg<Unambig = ()>`,
// `Path<R = Res>`), so `hir.Path<..>` spellings in the contract stay valid after the swap.

export type AmbigArg = unknown;
export type AngleBrackets = unknown;
export type AnonConst = unknown;
export type Arm = unknown;
export type AssocItemConstraint = unknown;
export type Block = unknown;
export type BlockCheckMode = unknown;
export type Body = unknown;
export type BodyId = unknown;
export type ClosureBinder = unknown;
export type ClosureKind = unknown;
export type ConstArg<_Unambig = unknown> = unknown;
export type ConstArgExprField = unknown;
export type ConstBlock = unknown;
export type ConstItemRhs = unknown;
export type Constness = unknown;
export type CoroutineDesugaring = unknown;
export type CoroutineKind = unknown;
export type CoroutineSource = unknown;
export type Defaultness = unknown;
export type Destination = unknown;
export type DotDotPos = unknown;
export type Expr = unknown;
export type ExprField = unknown;
export type ExprKind = unknown;
export type FieldDef = unknown;
export type FnDecl = unknown;
export type FnDeclFlags = unknown;
export type FnHeader = unknown;
export type FnRetTy = unknown;
export type FnSig = unknown;
export type ForeignItem = unknown;
export type ForeignItemId = unknown;
export type GenericArg = unknown;
export type GenericArgs = unknown;
export type GenericBound = unknown;
export type GenericBounds = unknown;
export type GenericParam = unknown;
export type GenericParamKind = unknown;
export type GenericParamSource = unknown;
export type Generics = unknown;
export type ImplItem = unknown;
export type ImplItemId = unknown;
export type ImplItemImplKind = unknown;
export type ImplRestriction = unknown;
export type InlineAsm = unknown;
export type Item = unknown;
export type ItemId = unknown;
export type ItemKind = unknown;
export type LetStmt = unknown;
export type Lifetime = unknown;
export type LifetimeSource = unknown;
export type LifetimeSyntax = unknown;
export type Lit = unknown;
export type LocalSource = unknown;
export type MatchSource = unknown;
export type MaybeOwner = unknown;
export type MissingLifetimeKind = unknown;
export type Mod = unknown;
export type MutRestriction = unknown;
export type Node = unknown;
export type OpaqueTy = unknown;
export type OpaqueTyOrigin<_D = unknown> = unknown;
export type OwnerInfo = unknown;
export type OwnerNode = unknown;
export type Param = unknown;
export type ParamName = unknown;
export type ParentedNode = unknown;
export type Pat = unknown;
export type PatExpr = unknown;
export type PatField = unknown;
export type PatKind = unknown;
export type Path<_R = unknown> = unknown;
export type PathSegment = unknown;
export type PolyTraitRef = unknown;
export type PreciseCapturingArg = unknown;
export type PredicateOrigin = unknown;
export type QPath = unknown;
export type RangeEnd = unknown;
export type RestrictionKind = unknown;
export type Safety = unknown;
export type Stmt = unknown;
export type StmtKind = unknown;
export type TestBinderBody = unknown;
export type TestBinderBoundTypeConstraint = unknown;
export type TestBinderConstraint = unknown;
export type TestBinderExists = unknown;
export type TestBinderForall = unknown;
export type TraitBoundModifiers = unknown;
export type TraitCandidate = unknown;
export type TraitImplHeader = unknown;
export type TraitItem = unknown;
export type TraitItemId = unknown;
export type TraitRef = unknown;
export type Ty<_Unambig = unknown> = unknown;
export type TyKind = unknown;
export type TyPat = unknown;
export type UnsafeSource = unknown;
export type UsePath = unknown;
export type UseTree = unknown;
export type Variant = unknown;
export type VariantData = unknown;
export type WherePredicate = unknown;
/** `rustc_hir::lints::DelayedLint` (compiler/rustc_hir/src/lints.rs) */
export type DelayedLint = unknown;
