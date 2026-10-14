//! Oracle probe for src/rustc_metadata/rmeta/rmeta_ty.oracle.test.ts (lane rmeta-ty).
//!
//!   rmetatydump <crate>[,<crate>...] <rustc arguments...>
//!
//! Runs a compilation with the pinned nightly's own `rustc_driver` (rustc-dev component) and, in
//! `after_expansion`, prints for every listed (loaded) crate, for a sample of its DefIndexes (`sample(n)`), the typed
//! values the extern providers of cstore_impl.rs decode from crate metadata, through the oracle's queries:
//!
//!   crate <name> num_def_ids=<n>
//!   <i> kind=<DefKind:?>
//!   <i> type_of <shape>                   `type_of` (DefKinds whose `type_of` encoder.rs always records)
//!   <i> type_of.dbg <{:?}>
//!   <i> fn_sig <shape>                    `fn_sig` (`should_encode_fn_sig`)
//!   <i> fn_sig.dbg <{:?}>
//!   <i> generics parent=<did|-> params=[<name>#<index>:<Lifetime|Type|Const>, ..]   `generics_of`
//!   <i> outlives [<clause shape>, ..]     `inferred_outlives_of` (`should_encode_generics`)
//!   <i> outlives.dbg <{:?}>
//!   <i> clauses parent=<did|-> [<clause shape>, ..]   `explicit_clauses_of` (`should_encode_generics`)
//!   <i> super [<clause shape>, ..]        `explicit_super_clauses_of` (traits / trait aliases)
//!   <i> implied [<clause shape>, ..]      `explicit_implied_clauses_of` (traits / trait aliases)
//!   <i> bounds [<clause shape>, ..]       `explicit_item_bounds` (associated types, opaque types)
//!   <i> variances [<Variance:?>, ..]      `variances_of` (`should_encode_variances`, without associated types)
//!   <i> assoc <Const|Fn|Type> name=<sym|-> has_self=<bool|-> container=<Trait|InherentImpl|TraitImpl(<did>)>
//!
//! The `<shape>` lines spell a type out structurally, independently of the pretty printer (see `ty_shape`): a DefId is
//! `<crate name>:<index>`, a parameter `<name>#<index>`, a bound variable `^<debruijn|C>.<var>`. The `.dbg` lines
//! are the values' `{:?}` (their Debug goes through the pretty printer).
#![feature(rustc_private)]

extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_metadata;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_type_ir;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir::def::{CtorKind, DefKind};
use rustc_hir::def_id::{CrateNum, DefId, DefIndex};
use rustc_interface::interface;
use rustc_metadata::creader::CStore;
use rustc_middle::ty::{self, GenericArgKind, Ty, TyCtxt};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;
use rustc_span::Span;
use rustc_type_ir::{BoundVarIndexKind, ClauseKind, ConstKind, RegionKind, TyKind};

/// The DefIndexes printed for a crate with `n` DefIndexes (the TS test uses the same rule): [0, 300), every 37th
/// index of [300, n - 100), [n - 100, n).
fn sample(n: usize) -> Vec<usize> {
    let mut out: Vec<usize> = Vec::new();
    for i in 0..n {
        if i < 300 || i + 100 >= n || (i - 300) % 37 == 0 {
            out.push(i);
        }
    }
    out
}

fn did(tcx: TyCtxt<'_>, d: DefId) -> String {
    format!("{}:{}", tcx.crate_name(d.krate), d.index.as_u32())
}

fn bvi(k: BoundVarIndexKind) -> String {
    match k {
        BoundVarIndexKind::Bound(d) => format!("{}", d.as_u32()),
        BoundVarIndexKind::Canonical => "C".to_string(),
    }
}

fn args_shape<'tcx>(tcx: TyCtxt<'tcx>, args: ty::GenericArgsRef<'tcx>) -> String {
    let v: Vec<String> = args.iter().map(|a| arg_shape(tcx, a)).collect();
    format!("<{}>", v.join(", "))
}

fn arg_shape<'tcx>(tcx: TyCtxt<'tcx>, a: ty::GenericArg<'tcx>) -> String {
    match a.kind() {
        GenericArgKind::Lifetime(r) => region_shape(r),
        GenericArgKind::Type(t) => ty_shape(tcx, t),
        GenericArgKind::Const(c) => const_shape(tcx, c),
    }
}

fn term_shape<'tcx>(tcx: TyCtxt<'tcx>, t: ty::Term<'tcx>) -> String {
    match t.kind() {
        ty::TermKind::Ty(t) => ty_shape(tcx, t),
        ty::TermKind::Const(c) => const_shape(tcx, c),
    }
}

fn region_shape(r: ty::Region<'_>) -> String {
    match r.kind() {
        RegionKind::ReEarlyParam(p) => format!("'{}#{}", p.name, p.index),
        RegionKind::ReBound(k, br) => format!("'^{}.{}", bvi(k), br.var.as_u32()),
        RegionKind::ReLateParam(_) => "'late".to_string(),
        RegionKind::ReStatic => "'static".to_string(),
        RegionKind::ReVar(_) => "'var".to_string(),
        RegionKind::RePlaceholder(_) => "'placeholder".to_string(),
        RegionKind::ReErased => "'erased".to_string(),
        RegionKind::ReError(_) => "'error".to_string(),
    }
}

fn const_shape<'tcx>(_tcx: TyCtxt<'tcx>, c: ty::Const<'tcx>) -> String {
    match c.kind() {
        ConstKind::Param(p) => format!("const {}#{}", p.name, p.index),
        ConstKind::Infer(_) => "const Infer".to_string(),
        ConstKind::Bound(k, b) => format!("const ^{}.{}", bvi(k), b.var.as_u32()),
        ConstKind::Placeholder(_) => "const Placeholder".to_string(),
        ConstKind::Alias(..) => "const Alias".to_string(),
        ConstKind::Value(_) => "const Value".to_string(),
        ConstKind::Error(_) => "const Error".to_string(),
        ConstKind::Expr(_) => "const Expr".to_string(),
    }
}

fn tys_shape<'tcx>(tcx: TyCtxt<'tcx>, tys: &[Ty<'tcx>]) -> String {
    let v: Vec<String> = tys.iter().map(|t| ty_shape(tcx, *t)).collect();
    v.join(", ")
}

/// A type, spelled out structurally.
fn ty_shape<'tcx>(tcx: TyCtxt<'tcx>, t: Ty<'tcx>) -> String {
    match *t.kind() {
        TyKind::Bool => "bool".to_string(),
        TyKind::Char => "char".to_string(),
        TyKind::Int(i) => i.name_str().to_string(),
        TyKind::Uint(u) => u.name_str().to_string(),
        TyKind::Float(f) => f.name_str().to_string(),
        TyKind::Adt(def, args) => format!("Adt({}){}", did(tcx, def.did()), args_shape(tcx, args)),
        TyKind::Foreign(d) => format!("Foreign({})", did(tcx, d)),
        TyKind::Str => "str".to_string(),
        TyKind::Array(e, c) => format!("[{}; {}]", ty_shape(tcx, e), const_shape(tcx, c)),
        TyKind::Pat(e, _) => format!("Pat({})", ty_shape(tcx, e)),
        TyKind::Slice(e) => format!("[{}]", ty_shape(tcx, e)),
        TyKind::RawPtr(e, m) => format!("*{} {}", m.ptr_str(), ty_shape(tcx, e)),
        TyKind::Ref(r, e, m) => format!("&{} {}{}", region_shape(r), m.prefix_str(), ty_shape(tcx, e)),
        TyKind::FnDef(d, args) => {
            format!("FnDef({})<{}>{}", did(tcx, d), args.bound_vars().len(), args_shape(tcx, args.skip_binder()))
        }
        TyKind::FnPtr(sig_tys, _) => {
            format!("FnPtr<{}>({})", sig_tys.bound_vars().len(), tys_shape(tcx, sig_tys.skip_binder().inputs_and_output))
        }
        TyKind::UnsafeBinder(_) => "UnsafeBinder".to_string(),
        TyKind::Dynamic(preds, r) => format!("Dynamic[{}]({})", preds.len(), region_shape(r)),
        TyKind::Closure(d, args) => format!("Closure({}){}", did(tcx, d), args_shape(tcx, args)),
        TyKind::CoroutineClosure(d, args) => format!("CoroutineClosure({}){}", did(tcx, d), args_shape(tcx, args)),
        TyKind::Coroutine(d, args) => format!("Coroutine({}){}", did(tcx, d), args_shape(tcx, args)),
        TyKind::CoroutineWitness(d, args) => format!("CoroutineWitness({}){}", did(tcx, d), args_shape(tcx, args)),
        TyKind::Never => "!".to_string(),
        TyKind::Tuple(ts) => format!("({})", tys_shape(tcx, ts)),
        TyKind::Alias(_, alias) => {
            let k = alias.kind;
            let (name, d) = if let Some(d) = k.try_to_projection() {
                ("Projection", d)
            } else if let Some(d) = k.try_to_inherent() {
                ("Inherent", d)
            } else if let Some(d) = k.try_to_opaque() {
                ("Opaque", d)
            } else {
                ("Free", k.try_to_free().unwrap())
            };
            format!("{}({}){}", name, did(tcx, d), args_shape(tcx, alias.args))
        }
        TyKind::Param(p) => format!("{}#{}", p.name, p.index),
        TyKind::Bound(k, b) => format!("^{}.{}", bvi(k), b.var.as_u32()),
        TyKind::Placeholder(_) => "Placeholder".to_string(),
        TyKind::Infer(_) => "Infer".to_string(),
        TyKind::Error(_) => "Error".to_string(),
    }
}

/// A clause, spelled out structurally (`<n>` is the number of bound variables of its binder).
fn clause_shape<'tcx>(tcx: TyCtxt<'tcx>, c: ty::Clause<'tcx>) -> String {
    let k = c.kind();
    let n = k.bound_vars().len();
    let body = match k.skip_binder() {
        ClauseKind::Trait(p) => format!("Trait({}){}", did(tcx, p.trait_ref.def_id), args_shape(tcx, p.trait_ref.args)),
        ClauseKind::RegionOutlives(p) => format!("RegionOutlives({}: {})", region_shape(p.0), region_shape(p.1)),
        ClauseKind::TypeOutlives(p) => format!("TypeOutlives({}: {})", ty_shape(tcx, p.0), region_shape(p.1)),
        ClauseKind::Projection(p) => format!(
            "Projection({}){} == {}",
            did(tcx, p.def_id()),
            args_shape(tcx, p.projection_term.args),
            term_shape(tcx, p.term)
        ),
        ClauseKind::ConstArgHasType(c, t) => format!("ConstArgHasType({}: {})", const_shape(tcx, c), ty_shape(tcx, t)),
        ClauseKind::WellFormed(t) => format!("WellFormed({})", term_shape(tcx, t)),
        ClauseKind::ConstEvaluatable(c) => format!("ConstEvaluatable({})", const_shape(tcx, c)),
        ClauseKind::HostEffect(p) => format!("HostEffect({}){}", did(tcx, p.trait_ref.def_id), args_shape(tcx, p.trait_ref.args)),
        ClauseKind::UnstableFeature(s) => format!("UnstableFeature({s})"),
    };
    format!("<{n}>{body}")
}

fn clauses_shape<'tcx>(tcx: TyCtxt<'tcx>, cs: &[(ty::Clause<'tcx>, Span)]) -> String {
    let v: Vec<String> = cs.iter().map(|(c, _)| clause_shape(tcx, *c)).collect();
    format!("[{}]", v.join(", "))
}

fn opt_did(tcx: TyCtxt<'_>, d: Option<DefId>) -> String {
    match d {
        Some(d) => did(tcx, d),
        None => "-".to_string(),
    }
}

/// `should_encode_type` (encoder.rs:1288) for the DefKinds it records unconditionally (`AnonConst` is left out: its
/// DefId may be skipped altogether).
fn has_type_of(kind: DefKind) -> bool {
    matches!(
        kind,
        DefKind::Struct
            | DefKind::Union
            | DefKind::Enum
            | DefKind::Variant
            | DefKind::Ctor(..)
            | DefKind::Field
            | DefKind::Fn
            | DefKind::Const
            | DefKind::Static { nested: false, .. }
            | DefKind::TyAlias
            | DefKind::ForeignTy
            | DefKind::Impl { .. }
            | DefKind::AssocFn
            | DefKind::AssocConst
            | DefKind::Closure
            | DefKind::ConstParam
            | DefKind::SyntheticCoroutineBody
    )
}

/// `should_encode_fn_sig` (encoder.rs:1349).
fn has_fn_sig(kind: DefKind) -> bool {
    matches!(kind, DefKind::Fn | DefKind::AssocFn | DefKind::Ctor(_, CtorKind::Fn))
}

/// `should_encode_generics` (encoder.rs:1252), without `AnonConst`.
fn has_generics(kind: DefKind) -> bool {
    matches!(
        kind,
        DefKind::Struct
            | DefKind::Union
            | DefKind::Enum
            | DefKind::Variant
            | DefKind::Trait
            | DefKind::TyAlias
            | DefKind::ForeignTy
            | DefKind::TraitAlias
            | DefKind::AssocTy
            | DefKind::Fn
            | DefKind::Const
            | DefKind::Static { .. }
            | DefKind::Ctor(..)
            | DefKind::AssocFn
            | DefKind::AssocConst
            | DefKind::OpaqueTy
            | DefKind::Impl { .. }
            | DefKind::Field
            | DefKind::TyParam
            | DefKind::Closure
            | DefKind::SyntheticCoroutineBody
    )
}

/// `should_encode_variances` (encoder.rs:1213), without `AssocTy` (RPITITs).
fn has_variances(kind: DefKind) -> bool {
    matches!(
        kind,
        DefKind::Struct | DefKind::Union | DefKind::Enum | DefKind::OpaqueTy | DefKind::Fn | DefKind::Ctor(..) | DefKind::AssocFn
    )
}

fn dump(tcx: TyCtxt<'_>, wanted: &[String]) -> String {
    let mut out = String::new();
    for want in wanted {
        let Some(&cnum) = tcx.crates(()).iter().find(|&&c| tcx.crate_name(c).as_str() == want) else {
            panic!("crate {want} is not loaded");
        };
        let cnum: CrateNum = cnum;
        let n = CStore::from_tcx(tcx).num_def_ids_untracked(cnum);
        writeln!(out, "crate {want} num_def_ids={n}").unwrap();
        for i in sample(n) {
            let d = DefId { krate: cnum, index: DefIndex::from_usize(i) };
            let kind = tcx.def_kind(d);
            writeln!(out, "{i} kind={kind:?}").unwrap();
            if has_type_of(kind) {
                let t = tcx.type_of(d);
                writeln!(out, "{i} type_of {}", ty_shape(tcx, t.skip_binder())).unwrap();
                writeln!(out, "{i} type_of.dbg {t:?}").unwrap();
            }
            if has_fn_sig(kind) {
                let s = tcx.fn_sig(d);
                let sig = s.skip_binder();
                writeln!(
                    out,
                    "{i} fn_sig <{}>({}) c_variadic={} safety={:?} abi={:?}",
                    sig.bound_vars().len(),
                    tys_shape(tcx, sig.skip_binder().inputs_and_output),
                    sig.skip_binder().c_variadic(),
                    sig.skip_binder().safety(),
                    sig.skip_binder().abi(),
                )
                .unwrap();
                writeln!(out, "{i} fn_sig.dbg {s:?}").unwrap();
            }
            if has_generics(kind) {
                let g = tcx.generics_of(d);
                let ps: Vec<String> = g
                    .own_params
                    .iter()
                    .map(|p| {
                        let k = match p.kind {
                            ty::GenericParamDefKind::Lifetime => "Lifetime",
                            ty::GenericParamDefKind::Type { .. } => "Type",
                            ty::GenericParamDefKind::Const { .. } => "Const",
                        };
                        format!("{}#{}:{}", p.name, p.index, k)
                    })
                    .collect();
                writeln!(out, "{i} generics parent={} params=[{}]", opt_did(tcx, g.parent), ps.join(", ")).unwrap();
                let o = tcx.inferred_outlives_of(d);
                writeln!(out, "{i} outlives {}", clauses_shape(tcx, o)).unwrap();
                writeln!(out, "{i} outlives.dbg {o:?}").unwrap();
                let c = tcx.explicit_clauses_of(d);
                writeln!(out, "{i} clauses parent={} {}", opt_did(tcx, c.parent), clauses_shape(tcx, c.clauses)).unwrap();
            }
            if let DefKind::Trait | DefKind::TraitAlias = kind {
                writeln!(out, "{i} super {}", clauses_shape(tcx, tcx.explicit_super_clauses_of(d).skip_binder())).unwrap();
                writeln!(out, "{i} implied {}", clauses_shape(tcx, tcx.explicit_implied_clauses_of(d).skip_binder())).unwrap();
            }
            if let DefKind::AssocTy | DefKind::OpaqueTy = kind {
                writeln!(out, "{i} bounds {}", clauses_shape(tcx, tcx.explicit_item_bounds(d).skip_binder())).unwrap();
            }
            if has_variances(kind) {
                let v: Vec<String> = tcx.variances_of(d).iter().map(|v| format!("{v:?}")).collect();
                writeln!(out, "{i} variances [{}]", v.join(", ")).unwrap();
            }
            if let DefKind::AssocFn | DefKind::AssocConst | DefKind::AssocTy = kind {
                let a = tcx.associated_item(d);
                let (k, name, has_self) = match a.kind {
                    ty::AssocKind::Const { name } => ("Const", name.to_string(), "-".to_string()),
                    ty::AssocKind::Fn { name, has_self } => ("Fn", name.to_string(), has_self.to_string()),
                    ty::AssocKind::Type { data } => match data {
                        ty::AssocTypeData::Normal(name) => ("Type", name.to_string(), "-".to_string()),
                        ty::AssocTypeData::Rpitit(_) => ("Type", "-".to_string(), "-".to_string()),
                    },
                };
                let container = match a.container {
                    ty::AssocContainer::Trait => "Trait".to_string(),
                    ty::AssocContainer::InherentImpl => "InherentImpl".to_string(),
                    ty::AssocContainer::TraitImpl(Ok(t)) => format!("TraitImpl({})", did(tcx, t)),
                    ty::AssocContainer::TraitImpl(Err(_)) => "TraitImpl(Err)".to_string(),
                };
                writeln!(out, "{i} assoc {k} name={name} has_self={has_self} container={container}").unwrap();
            }
        }
    }
    out
}

struct Probe {
    wanted: Vec<String>,
}

impl Callbacks for Probe {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let out = dump(tcx, &self.wanted);
        let mut stdout = std::io::stdout().lock();
        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let raw = rustc_driver::args::raw_args(&early_dcx);
    if raw.len() < 3 {
        eprintln!("usage: rmetatydump <crate>[,<crate>...] <rustc arguments...>");
        return ExitCode::from(2);
    }
    let wanted: Vec<String> = raw[1].split(',').map(|s| s.to_string()).collect();
    let mut args = vec![raw[0].clone()];
    args.extend(raw[2..].iter().cloned());
    let mut callbacks = Probe { wanted };
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&args, &mut callbacks))
}
