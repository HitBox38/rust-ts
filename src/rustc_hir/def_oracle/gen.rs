// Oracle generator for `src/rustc_hir/def.test.ts` (not part of the build).
//
// Uses the pinned toolchain's own rustc_hir / rustc_hir_id / rustc_structures (rustc-dev
// component) to dump, one `key<TAB>value` line each: every `DefKind` variant (Debug plain and
// pretty, `descr` for a local item / a local crate root / an extern crate root, `article`, `ns`,
// `def_path_data(Some(foo))`, and the bool predicates), every `MacroKinds` bit pattern, every `Res`
// variant shape (Debug, descr, article, ns, macro_kinds, matches_ns, *_def_id, pattern
// predicates), `NonMacroAttrKind`, `Namespace`, `PerNS`, every `DefPathData` (Debug, Display,
// get_opt_name, `as_sym`), `HirId` / `DefKey` Debug, and the rustc_structures Debug/Display impls.
// Regenerate with:
//
//   rustc +nightly-2026-10-11 --edition 2024 -O gen.rs -o $RUST_TS_DATA/tmp/hir-def/def_gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/hir-def/def_gen > cases.txt
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_span;
extern crate rustc_structures;

use rustc_ast::{FloatTy, IntTy, Mutability, UintTy};
use rustc_hir::def::{CtorKind, CtorOf, DefKind, MacroKinds, Namespace, NonMacroAttrKind, PerNS, Res};
use rustc_hir::definitions::{DefKey, DefPathData, DisambiguatedDefPathData};
use rustc_hir::{HirId, ItemLocalId, OwnerId, PrimTy, Safety};
use rustc_span::def_id::{CRATE_DEF_ID, CrateNum, DefId, DefIndex};
use rustc_span::{Symbol, create_default_session_globals_then};
use rustc_structures::{CollapseMacroDebuginfo, CrateType, Limit, NativeLibKind, SanitizerSet};

fn line(k: &str, v: impl AsRef<str>) {
    // keep one line per entry: escape newlines of `{:#?}` output
    println!("{k}\t{}", v.as_ref().replace('\\', "\\\\").replace('\n', "\\n"));
}

fn def_kinds() -> Vec<DefKind> {
    let mut v = vec![
        DefKind::Mod,
        DefKind::Struct,
        DefKind::Union,
        DefKind::Enum,
        DefKind::Variant,
        DefKind::Trait,
        DefKind::TyAlias,
        DefKind::ForeignTy,
        DefKind::TraitAlias,
        DefKind::AssocTy,
        DefKind::TyParam,
        DefKind::Fn,
        DefKind::Const,
        DefKind::ConstParam,
    ];
    for safety in [Safety::Unsafe, Safety::Safe] {
        for mutability in [Mutability::Not, Mutability::Mut] {
            for nested in [false, true] {
                v.push(DefKind::Static { safety, mutability, nested });
            }
        }
    }
    for of in [CtorOf::Struct, CtorOf::Variant] {
        for kind in [CtorKind::Fn, CtorKind::Const] {
            v.push(DefKind::Ctor(of, kind));
        }
    }
    v.push(DefKind::AssocFn);
    v.push(DefKind::AssocConst);
    for bits in 0..8u8 {
        v.push(DefKind::Macro(MacroKinds::from_bits_retain(bits)));
    }
    v.extend([
        DefKind::ExternCrate,
        DefKind::Use,
        DefKind::ForeignMod,
        DefKind::AnonConst,
        DefKind::OpaqueTy,
        DefKind::Field,
        DefKind::LifetimeParam,
        DefKind::GlobalAsm,
        DefKind::Impl { of_trait: false },
        DefKind::Impl { of_trait: true },
        DefKind::Closure,
        DefKind::SyntheticCoroutineBody,
        DefKind::TestBinderConstraints,
    ]);
    v
}

fn main() {
    create_default_session_globals_then(|| {
        let local_item = DefId { krate: CrateNum::from_u32(0), index: DefIndex::from_u32(7) };
        let local_root = DefId { krate: CrateNum::from_u32(0), index: DefIndex::from_u32(0) };
        let extern_root = DefId { krate: CrateNum::from_u32(3), index: DefIndex::from_u32(0) };
        let foo = Symbol::intern("foo");

        for (i, k) in def_kinds().into_iter().enumerate() {
            let p = format!("defkind.{i}");
            line(&format!("{p}.debug"), format!("{k:?}"));
            line(&format!("{p}.pretty"), format!("{k:#?}"));
            line(&format!("{p}.descr.local"), k.descr(local_item));
            line(&format!("{p}.descr.local_root"), k.descr(local_root));
            line(&format!("{p}.descr.extern_root"), k.descr(extern_root));
            line(&format!("{p}.article"), k.article());
            line(&format!("{p}.ns"), format!("{:?}", k.ns()));
            line(&format!("{p}.def_path_data"), format!("{:?}", k.def_path_data(Some(foo))));
            line(
                &format!("{p}.flags"),
                format!(
                    "{} {} {} {} {} {}",
                    k.is_assoc(),
                    k.is_module_like(),
                    k.is_adt(),
                    k.is_fn_like(),
                    k.has_generics(),
                    k.has_codegen_attrs()
                ),
            );
        }

        for bits in 0..8u8 {
            let m = MacroKinds::from_bits_retain(bits);
            line(&format!("macrokinds.{bits}"), format!("{m:?} {:?} {}", m.descr(), m.article()));
        }

        let prims = [
            PrimTy::Int(IntTy::I8),
            PrimTy::Int(IntTy::Isize),
            PrimTy::Uint(UintTy::U128),
            PrimTy::Float(FloatTy::F16),
            PrimTy::Float(FloatTy::F64),
            PrimTy::Str,
            PrimTy::Bool,
            PrimTy::Char,
        ];
        let mut res: Vec<Res<u32>> = vec![
            Res::Def(DefKind::Fn, local_item),
            Res::Def(DefKind::Mod, local_root),
            Res::Def(DefKind::Mod, extern_root),
            Res::Def(DefKind::Enum, local_item),
            Res::Def(DefKind::Trait, local_item),
            Res::Def(DefKind::Ctor(CtorOf::Struct, CtorKind::Fn), local_item),
            Res::Def(DefKind::Ctor(CtorOf::Variant, CtorKind::Const), local_item),
            Res::Def(DefKind::Macro(MacroKinds::DERIVE_ATTR), local_item),
            Res::Def(DefKind::Static { safety: Safety::Safe, mutability: Mutability::Mut, nested: false }, extern_root),
        ];
        res.extend(prims.iter().map(|&p| Res::PrimTy(p)));
        res.extend([
            Res::SelfTyParam { trait_: local_item },
            Res::SelfTyAlias { alias_to: extern_root, is_trait_impl: true },
            Res::SelfCtor(local_item),
            Res::Local(42),
            Res::ToolMod,
            Res::OpenMod(foo),
            Res::NonMacroAttr(NonMacroAttrKind::Builtin(Symbol::intern("inline"))),
            Res::NonMacroAttr(NonMacroAttrKind::Tool),
            Res::NonMacroAttr(NonMacroAttrKind::DeriveHelper),
            Res::NonMacroAttr(NonMacroAttrKind::DeriveHelperCompat),
            Res::Err,
        ]);
        for (i, r) in res.iter().enumerate() {
            let p = format!("res.{i}");
            line(&format!("{p}.debug"), format!("{r:?}"));
            line(&format!("{p}.pretty"), format!("{r:#?}"));
            line(&format!("{p}.descr"), r.descr());
            line(&format!("{p}.article"), r.article());
            line(&format!("{p}.ns"), format!("{:?}", r.ns()));
            line(&format!("{p}.macro_kinds"), format!("{:?}", r.macro_kinds()));
            line(
                &format!("{p}.matches_ns"),
                format!(
                    "{} {} {}",
                    r.matches_ns(Namespace::TypeNS),
                    r.matches_ns(Namespace::ValueNS),
                    r.matches_ns(Namespace::MacroNS)
                ),
            );
            line(
                &format!("{p}.ids"),
                format!("{:?} {:?} {:?}", r.opt_def_id(), r.mod_def_id(), r.module_like_def_id()),
            );
            line(
                &format!("{p}.pat"),
                format!("{} {}", r.expected_in_tuple_struct_pat(), r.expected_in_unit_struct_pat()),
            );
            line(&format!("{p}.map_id"), format!("{:?}", r.map_id(|x| x + 1)));
        }

        for (i, k) in [
            NonMacroAttrKind::Builtin(Symbol::intern("inline")),
            NonMacroAttrKind::Tool,
            NonMacroAttrKind::DeriveHelper,
            NonMacroAttrKind::DeriveHelperCompat,
        ]
        .into_iter()
        .enumerate()
        {
            line(&format!("nonmacroattr.{i}"), format!("{k:?} {} {} {}", k.descr(), k.article(), k.is_used()));
        }

        for ns in [Namespace::TypeNS, Namespace::ValueNS, Namespace::MacroNS] {
            line(&format!("namespace.{ns:?}"), ns.descr());
        }

        let per: PerNS<Option<Res<u32>>> =
            PerNS { value_ns: Some(Res::Local(1)), type_ns: None, macro_ns: Some(Res::ToolMod) };
        line("perns.debug", format!("{per:?}"));
        line("perns.pretty", format!("{per:#?}"));
        line("perns.present_items", format!("{:?}", per.present_items().collect::<Vec<_>>()));
        line("in_namespace.mod", format!("{:?}", Res::Def(DefKind::Mod, local_item).in_namespace()));
        line("in_namespace.enum", format!("{:?}", Res::Def(DefKind::Enum, local_item).in_namespace()));
        line("in_namespace.err", format!("{:?}", Res::Err.in_namespace()));

        let datas = [
            DefPathData::CrateRoot,
            DefPathData::Impl,
            DefPathData::ForeignMod,
            DefPathData::Use,
            DefPathData::GlobalAsm,
            DefPathData::TypeNs(foo),
            DefPathData::ValueNs(foo),
            DefPathData::MacroNs(foo),
            DefPathData::LifetimeNs(Symbol::intern("'a")),
            DefPathData::Closure,
            DefPathData::TestBinderConstraints,
            DefPathData::Ctor,
            DefPathData::AnonConst,
            DefPathData::OpaqueTy,
            DefPathData::OpaqueLifetime(Symbol::intern("'b")),
            DefPathData::AnonAssocTy(foo),
            DefPathData::SyntheticCoroutineBody,
            DefPathData::NestedStatic,
        ];
        for (i, d) in datas.iter().enumerate() {
            let dd0 = DisambiguatedDefPathData { data: *d, disambiguator: 0 };
            let dd3 = DisambiguatedDefPathData { data: *d, disambiguator: 3 };
            line(
                &format!("defpathdata.{i}"),
                format!(
                    "{d:?} | {d} | {:?} | {} {} {} | {dd3:?}",
                    d.get_opt_name(),
                    dd0.as_sym(true),
                    dd3.as_sym(true),
                    dd3.as_sym(false)
                ),
            );
        }
        let key = DefKey {
            parent: Some(DefIndex::from_u32(4)),
            disambiguated_data: DisambiguatedDefPathData { data: DefPathData::TypeNs(foo), disambiguator: 1 },
        };
        line("defkey.debug", format!("{key:?}"));
        line("defkey.pretty", format!("{key:#?}"));

        let hir_id = HirId { owner: OwnerId { def_id: CRATE_DEF_ID }, local_id: ItemLocalId::from_u32(10) };
        line("hirid.debug", format!("{hir_id:?}"));
        line("hirid.pretty", format!("{hir_id:#?}"));
        line("hirid.display", format!("{hir_id}"));
        line("ownerid.debug", format!("{:?}", hir_id.owner));
        line("res_hirid.debug", format!("{:?}", Res::<HirId>::Local(hir_id)));

        // rustc_structures
        line("limit.unlimited", format!("{} {:?}", Limit::unlimited(), Limit::new(5)));
        for ct in [
            CrateType::Executable,
            CrateType::Dylib,
            CrateType::Rlib,
            CrateType::StaticLib,
            CrateType::Cdylib,
            CrateType::ProcMacro,
            CrateType::Sdylib,
        ] {
            line(&format!("cratetype.{ct:?}"), format!("{ct} {}", ct.has_metadata()));
        }
        for c in [
            CollapseMacroDebuginfo::No,
            CollapseMacroDebuginfo::Unspecified,
            CollapseMacroDebuginfo::External,
            CollapseMacroDebuginfo::Yes,
        ] {
            line(&format!("collapse.{}", c as u8), format!("{c:?}"));
        }
        for (i, k) in [
            NativeLibKind::Static { bundle: Some(true), whole_archive: None, export_symbols: Some(false) },
            NativeLibKind::Dylib { as_needed: None },
            NativeLibKind::RawDylib { as_needed: Some(true) },
            NativeLibKind::Framework { as_needed: None },
            NativeLibKind::LinkArg,
            NativeLibKind::WasmImportModule,
            NativeLibKind::Unspecified,
        ]
        .into_iter()
        .enumerate()
        {
            line(
                &format!("nativelibkind.{i}"),
                format!("{k:?} {} {} {}", k.has_modifiers(), k.is_statically_included(), k.is_dllimport()),
            );
        }
        for bits in [0u16, 1, 3, 0x20 | 0x100, 0x3fff, 0x800 | 0x4000] {
            let s = SanitizerSet::from_bits_retain(bits);
            let display = if s.iter().all(|x| x.as_str().is_some()) { format!("{s}") } else { "<panics>".into() };
            line(
                &format!("sanitizer.{bits}"),
                format!("{s:?} | {display} | {:?} | {:?}", s.as_str(), s.mutually_exclusive()),
            );
        }
    });
}
