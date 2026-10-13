// Oracle generator for `src/rustc_attr_ir/debug_oracle.test.ts` (not part of the build).
//
// Builds a fixed set of `rustc_attr_ir` values with the real crates of the pinned toolchain
// (rustc-dev component) and prints, per value, its `{:?}` and `{:#?}` Debug, its `PrintAttribute`
// rendering (`rustc_ast_pretty::pp::Printer`) and, for `AttributeKind`s, `encode_cross_crate()` /
// `is_extern_indicator()`; then the `LangItem` table (every `LangItem::from_name` over the predefined
// symbols) and a few `Target` names. The TS test builds the same values and must print the same text.
// Regenerate with:
//
//   rustc +nightly-2026-10-11 --edition 2024 gen.rs -o $RUST_TS_DATA/tmp/attr-ir-gen/gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/attr-ir-gen/gen > cases.txt
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
#![feature(rustc_private)]
#![feature(variant_count)]
extern crate rustc_ast;
extern crate rustc_ast_pretty;
extern crate rustc_attr_ir;
extern crate rustc_driver;
extern crate rustc_span;
extern crate thin_vec;

use std::fmt::Debug;
use std::num::NonZero;
use std::path::PathBuf;

use rustc_ast::attr::data_structures::CfgEntry;
use rustc_ast::attr::version::RustcVersion;
use rustc_ast::expand::autodiff_attrs::{DiffActivity, DiffMode};
use rustc_ast::token::{CommentKind, DocFragmentKind};
use rustc_ast::{AttrStyle, LitKind, MetaItemLit, StrStyle, UintTy};
use rustc_ast_pretty::pp::Printer;
use rustc_attr_ir::diagnostic::*;
use rustc_attr_ir::target::{MethodKind, Target};
use rustc_attr_ir::*;
use rustc_span::def_id::{DefId, DefIndex, LOCAL_CRATE};
use rustc_span::hygiene::Transparency;
use rustc_span::symbol::PREDEFINED_SYMBOLS_COUNT;
use rustc_span::{AttrId, DUMMY_SP, Ident, Symbol, sym};
use thin_vec::thin_vec;

fn pa<T: PrintAttribute>(v: &T) -> String {
    let mut p = Printer::new();
    v.print_attribute(&mut p);
    p.eof()
}

fn show<T: Debug + PrintAttribute>(name: &str, v: &T) {
    println!("== {name}");
    println!("{v:?}");
    println!("{v:#?}");
    println!("-- print_attribute (should_render: {})", v.should_render());
    println!("{}", pa(v));
}

fn kind(name: &str, k: AttributeKind) {
    show(name, &k);
    let e = match k.encode_cross_crate() {
        EncodeCrossCrate::Yes => "Yes",
        EncodeCrossCrate::No => "No",
    };
    println!("-- encode_cross_crate: {e}, is_extern_indicator: {}", k.is_extern_indicator());
}

fn s(x: &str) -> Symbol {
    Symbol::intern(x)
}

fn main() {
    rustc_span::create_default_session_globals_then(|| {
        let sp = DUMMY_SP;
        kind(
            "Repr",
            AttributeKind::Repr {
                reprs: thin_vec![
                    (ReprAttr::ReprC, sp),
                    (ReprAttr::ReprInt(IntType::UnsignedInt(UintTy::U8)), sp),
                    (ReprAttr::ReprTransparent, sp),
                ],
                first_span: sp,
            },
        );
        kind("Inline", AttributeKind::Inline(InlineAttr::Force { attr_span: sp, reason: Some(s("why")) }, sp));
        kind("InlineHint", AttributeKind::Inline(InlineAttr::Hint, sp));
        kind(
            "Deprecated",
            AttributeKind::Deprecated {
                deprecation: Deprecation {
                    since: DeprecatedSince::NonStandard(s("1.0")),
                    note: Some(Ident::with_dummy_span(s("use bar"))),
                    suggestion: None,
                },
                span: sp,
            },
        );
        kind(
            "DeprecatedVersion",
            AttributeKind::Deprecated {
                deprecation: Deprecation {
                    since: DeprecatedSince::RustcVersion(RustcVersion { major: 1, minor: 2, patch: 3 }),
                    note: None,
                    suggestion: Some(s("bar")),
                },
                span: sp,
            },
        );
        kind(
            "Stability",
            AttributeKind::Stability {
                stability: Stability {
                    level: StabilityLevel::Unstable {
                        reason: UnstableReason::Some(s("not yet")),
                        issue: NonZero::new(123),
                        implied_by: None,
                        old_name: Some(s("old")),
                    },
                    feature: s("my_feature"),
                },
                span: sp,
            },
        );
        kind(
            "RustcConstStability",
            AttributeKind::RustcConstStability {
                stability: PartialConstStability {
                    level: StabilityLevel::Stable {
                        since: StableSince::Version(RustcVersion { major: 1, minor: 80, patch: 0 }),
                        allowed_through_unstable_modules: Some((s("msg"), s("path::to"))),
                    },
                    feature: s("const_feature"),
                    promotable: false,
                },
                span: sp,
            },
        );
        kind(
            "MacroUse",
            AttributeKind::MacroUse {
                span: sp,
                arguments: MacroUseArgs::UseSpecific(thin_vec![Ident::with_dummy_span(s("a")), Ident::with_dummy_span(s("b"))]),
            },
        );
        kind("MacroUseAll", AttributeKind::MacroUse { span: sp, arguments: MacroUseArgs::UseAll });
        kind(
            "DocComment",
            AttributeKind::DocComment {
                style: AttrStyle::Outer,
                kind: DocFragmentKind::Sugared(CommentKind::Line),
                span: sp,
                comment: s(" hello"),
            },
        );
        kind("DocCommentRaw", AttributeKind::DocComment { style: AttrStyle::Inner, kind: DocFragmentKind::Raw(sp), span: sp, comment: s("x") });
        kind("LangPartialEq", AttributeKind::Lang(LangItem::PartialEq));
        kind("LangPanicImpl", AttributeKind::Lang(LangItem::PanicImpl));
        let mut doc = DocAttribute::default();
        doc.aliases.insert(s("alias1"), sp);
        doc.hidden = Some(sp);
        doc.inline = Some((DocInline::NoInline, sp));
        doc.keyword = Some((s("kw"), sp));
        doc.auto_cfg_change = thin_vec![(true, sp)];
        kind("Doc", AttributeKind::Doc(Box::new(doc)));
        kind("DocDefault", AttributeKind::Doc(Box::new(DocAttribute::default())));
        let directive = Directive {
            is_rustc_attr: true,
            filters: thin_vec![(
                Filter {
                    span: sp,
                    pred: Predicate::All(thin_vec![
                        Predicate::Flag(Flag::CrateLocal),
                        Predicate::Not(Box::new(Predicate::Match(NameValue {
                            name: Name::GenericArg(s("T")),
                            value: FilterFormatString { pieces: thin_vec![LitOrArg::Lit(s("&[")), LitOrArg::Arg(s("A"))] },
                        }))),
                        Predicate::Any(thin_vec![Predicate::Match(NameValue {
                            name: Name::SelfUpper,
                            value: FilterFormatString { pieces: thin_vec![] },
                        })]),
                    ]),
                },
                Directive::default(),
            )],
            message: Some((
                sp,
                FormatString {
                    input: s("the {T} for {This}"),
                    span: sp,
                    pieces: thin_vec![
                        Piece::Lit(s("the ")),
                        Piece::Arg(FormatArg::GenericParam { generic_param: s("T"), span: sp }),
                        Piece::Lit(s(" for ")),
                        Piece::Arg(FormatArg::This),
                        Piece::Arg(FormatArg::AsIs(s("x"))),
                    ],
                },
            )),
            label: None,
            notes: thin_vec![FormatString { input: s("n"), span: sp, pieces: thin_vec![Piece::Arg(FormatArg::SelfUpper)] }],
            parent_label: None,
        };
        kind("OnUnimplemented", AttributeKind::OnUnimplemented { directive: Some(Box::new(directive)) });
        kind("OnUnknownNone", AttributeKind::OnUnknown { directive: None });
        kind(
            "CfgTrace",
            AttributeKind::CfgTrace(thin_vec![
                (CfgEntry::Bool(true, sp), sp),
                (
                    CfgEntry::All(
                        thin_vec![
                            CfgEntry::NameValue { name: s("feature"), value: Some(s("x")), span: sp },
                            CfgEntry::Not(Box::new(CfgEntry::Version(Some(RustcVersion { major: 1, minor: 70, patch: 0 }), sp)), sp),
                        ],
                        sp
                    ),
                    sp
                ),
            ]),
        );
        kind(
            "RustcMir",
            AttributeKind::RustcMir(thin_vec![
                RustcMirKind::BorrowckGraphvizPostflow { path: PathBuf::from("a/b.dot") },
                RustcMirKind::PeekLiveness,
                RustcMirKind::BorrowckGraphvizFormat { format: BorrowckGraphvizFormatKind::TwoPhase },
            ]),
        );
        kind("CustomMir", AttributeKind::CustomMir(Some((MirDialect::Built, sp)), None));
        kind("Coverage", AttributeKind::Coverage(CoverageAttrKind::Off));
        kind("Optimize", AttributeKind::Optimize(OptimizeAttr::Speed, sp));
        kind("ProcMacroDerive", AttributeKind::ProcMacroDerive { trait_name: s("Foo"), helper_attrs: thin_vec![s("foo"), s("bar")] });
        kind("LinkOrdinal", AttributeKind::LinkOrdinal { ordinal: 7, span: sp });
        kind("PatchableFunctionEntry", AttributeKind::PatchableFunctionEntry { prefix: Some(1), entry: None, section: Some(s(".text")) });
        kind("RustcLegacyConstGenerics", AttributeKind::RustcLegacyConstGenerics { fn_indexes: thin_vec![(0, sp), (2, sp)], attr_span: sp });
        kind("RustcSkipDuringMethodDispatch", AttributeKind::RustcSkipDuringMethodDispatch { array: true, boxed_slice: false });
        kind("Cold", AttributeKind::Cold);
        kind("NoMangle", AttributeKind::NoMangle(sp));
        kind("Feature", AttributeKind::Feature(thin_vec![Ident::with_dummy_span(s("f1"))], sp));
        kind(
            "RustcAutodiff",
            AttributeKind::RustcAutodiff(Some(Box::new(RustcAutodiff {
                mode: DiffMode::Reverse,
                width: 1,
                input_activity: thin_vec![DiffActivity::Active, DiffActivity::FakeActivitySize(Some(3))],
                ret_activity: DiffActivity::None,
            }))),
        );
        kind(
            "UnstableRemoved",
            AttributeKind::UnstableRemoved(thin_vec![UnstableRemovedFeature {
                feature: s("gone"),
                reason: s("removed"),
                link: s("https://example.com"),
                since: RustcVersion { major: 1, minor: 0, patch: 0 },
            }]),
        );
        kind(
            "RustcCguTestAttr",
            AttributeKind::RustcCguTestAttr(thin_vec![(sp, CguFields::ExpectedCguReuse { cfg: s("cfail1"), module: s("m"), kind: CguKind::PreDashLto })]),
        );
        kind(
            "EiiDeclaration",
            AttributeKind::EiiDeclaration(EiiDecl {
                foreign_item: DefId { krate: LOCAL_CRATE, index: DefIndex::from_u32(5) },
                impl_unsafe: false,
                name: Ident::with_dummy_span(s("eii")),
            }),
        );
        kind("RustcMacroTransparency", AttributeKind::RustcMacroTransparency(Transparency::SemiOpaque));
        kind("Used", AttributeKind::Used { used_by: UsedBy::Linker });
        kind("CrateName", AttributeKind::CrateName { name: s("krate"), name_span: sp, attr_span: sp });
        kind("RustcDumpLayout", AttributeKind::RustcDumpLayout(thin_vec![RustcDumpLayoutKind::Align, RustcDumpLayoutKind::Size]));
        kind("RustcClean", AttributeKind::RustcClean(thin_vec![RustcCleanAttribute {
            span: sp,
            cfg: s("rpass2"),
            except: Some(RustcCleanQueries { entries: thin_vec![s("hir_owner"), s("typeck")], span: sp }),
            loaded_from_disk: None,
        }]));
        kind("RegisterTool", AttributeKind::RegisterTool { attr_tools: thin_vec![], lint_tools: thin_vec![Ident::with_dummy_span(s("clippy"))] });

        let unparsed = Attribute::Unparsed(Box::new(AttrItem {
            path: AttrPath { segments: Box::new([s("rustfmt"), s("skip")]), span: sp },
            args: AttrArgs::Eq {
                eq_span: sp,
                expr: MetaItemLit { symbol: s("v"), suffix: None, kind: LitKind::Str(s("v"), StrStyle::Cooked), span: sp },
            },
            id: HashIgnoredAttrId { attr_id: AttrId::from_u32(5) },
            style: AttrStyle::Inner,
            span: sp,
        }));
        let word = Attribute::Unparsed(Box::new(AttrItem {
            path: AttrPath { segments: Box::new([s("my_tool")]), span: sp },
            args: AttrArgs::Empty,
            id: HashIgnoredAttrId { attr_id: AttrId::from_u32(0) },
            style: AttrStyle::Outer,
            span: sp,
        }));
        let parsed = Attribute::Parsed(AttributeKind::AutomaticallyDerived);
        for (name, a) in [("Unparsed", &unparsed), ("UnparsedWord", &word), ("Parsed", &parsed)] {
            println!("== Attribute {name}");
            println!("{a:?}");
            println!("{a:#?}");
            println!(
                "-- is_parsed_attr {} name {:?} path {:?} is_word {} value_str {:?} doc_str {:?} is_proc_macro_attr {} is_automatically_derived_attr {}",
                a.is_parsed_attr(),
                a.name(),
                a.path(),
                a.is_word(),
                a.value_str(),
                a.doc_str(),
                a.is_proc_macro_attr(),
                rustc_ast::attr::AttributeExt::is_automatically_derived_attr(a),
            );
        }
        if let Attribute::Unparsed(item) = &unparsed {
            println!("== AttrPath Display\n{}", item.path);
        }

        println!("== LangItem table (from_name over the predefined symbols)");
        println!("variant_count {}", std::mem::variant_count::<LangItem>());
        for i in 0..PREDEFINED_SYMBOLS_COUNT {
            let sym = Symbol::new(i);
            if let Some(item) = LangItem::from_name(sym) {
                let g = match item.required_generics() {
                    GenericRequirement::None => "None".to_string(),
                    GenericRequirement::Minimum(n) => format!("Minimum({n})"),
                    GenericRequirement::Exact(n) => format!("Exact({n})"),
                };
                println!(
                    "{i}\t{item:?}\t{:?}\t{}\t{:?}\t{}\t{}\t{:?}\t{}",
                    item.name(),
                    item.variant_name(),
                    item.target(),
                    g,
                    item.is_weak(),
                    item.link_name(),
                    pa(&item),
                );
            }
        }
        println!("== Target");
        for t in [
            Target::Fn,
            Target::Impl { of_trait: true },
            Target::Impl { of_trait: false },
            Target::Method(MethodKind::Trait { body: true }),
            Target::Method(MethodKind::TraitImpl),
            Target::AssocTy(rustc_attr_ir::target::AssocCtxt::Trait),
            Target::Delegation { mac: true },
        ] {
            println!("{t:?}\t{t}\t{}\t{}", t.plural_name(), t.is_associated_item());
        }
        let _ = sym::doc;
    });
}
