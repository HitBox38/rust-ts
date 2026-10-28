// Port of compiler/rustc_symbol_mangling/src/legacy.rs (lane symbol-mangling).
//
// PORT decisions:
// - `LegacySymbolMangler` implements `Printer` + `PrettyPrinter` + `fmt::Write`: it extends the `PrettyPrinter`
//   abstract class (rustc_middle ty/print/pretty.ts), whose abstract `write_str` is the `fmt::Write` impl.
//   `write!(self, "..", args)` is one `write_str` of the formatted text (as pretty.ts).
// - `SymbolPath`'s `String`s hold only ASCII (the sanitizer in `write_str` escapes everything else), so
//   `temp_buf.len()` is `.length`.
// - `Hash64` is a `bigint`; `{hash:016x}` is its zero-padded hex.
// - `get_symbol_hash` hashes `Ty` / `PolyFnSig` / `GenericArgsRef` with the generated derives (rustc_middle
//   stable_hash.gen.ts, rustc_type_ir ty_stable_hash.gen.ts) and the impls_ty.rs impls (lane misc-blockers).
import { StableHasher, stable_hash_Discriminant } from "../rustc_data_structures/stable_hash.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { type DisambiguatedDefPathData, display_DefPathData } from "../rustc_hir_id/definitions.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { ConstInt, debug_ConstInt } from "../rustc_middle/ty/consts/int.ts";
import { Value } from "../rustc_middle/ty/consts/valtree.ts";
import { type GenericArg, GenericArg as GenericArgC, fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { type Instance, Instance as InstanceC } from "../rustc_middle/ty/instance.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { stable_hash_GenericArg, stable_hash_RawList } from "../rustc_middle/ty/impls_ty.ts";
import { stable_hash_Ty } from "../rustc_middle/stable_hash.gen.ts";
import { stable_hash_Binder, stable_hash_FnSig } from "../rustc_type_ir/ty_stable_hash.gen.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { type Print, type PrintResult, PRINT_OK, PrettyPrinter, print_Binder, print_ExistentialPredicate, print_GenericArg, print_ParamConst, print_Ty } from "../rustc_middle/ty/print/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { type CrateNum, DefId, debug_DefId } from "../rustc_span/def_id.ts";
import { stable_hash_DefPathHash, stable_hash_StableCrateId } from "../rustc_span/stable_hash.gen.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { ExistentialPredicate, PolyExistentialPredicate } from "../rustc_type_ir/decls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import {
  fold_with_ExistentialPredicate,
  fold_with_TraitRef,
  TraitRef,
  try_fold_with_ExistentialPredicate,
  try_fold_with_TraitRef,
  visit_with_ExistentialPredicate,
  visit_with_TraitRef,
} from "../rustc_type_ir/predicate.ts";
import type { Const, Region } from "../rustc_type_ir/sty/mod.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { debug_list, PLAIN, PRETTY } from "../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../std/panic.ts";
import { fold_GenericArg, debug_GenericArg } from "../rustc_middle/ty/generic_args.ts";

/** PORT: the `TypeFoldable` impl fns of `TraitRef` / `ExistentialPredicate` (generated) as D4 descriptors. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };
const d_ExistentialPredicate: TypeFoldable<ExistentialPredicate> = {
  visit_with: visit_with_ExistentialPredicate,
  try_fold_with: try_fold_with_ExistentialPredicate,
  fold_with: fold_with_ExistentialPredicate,
};

/** `mem::discriminant(&instance.def)` of `InstanceKind` (declaration order, `isize`). */
const InstanceKind__discriminant = { Item: 0, Intrinsic: 1, LlvmIntrinsic: 2, Virtual: 3, Shim: 4 } as const;

/** `Result<(), fmt::Error>::unwrap()` */
function unwrap_print(r: PrintResult): void {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
}

// rustc: compiler/rustc_symbol_mangling/src/legacy.rs:17 mangle
export function mangle(tcx: TyCtxt, instance: Instance, instantiating_crate: CrateNum | undefined): string {
  const def_id = InstanceC.def_id(instance);

  // We want to compute the "type" of this item. Unfortunately, some
  // kinds of items (e.g., synthetic static allocations from const eval)
  // don't have a proper implementation for the `type_of` query. So walk
  // back up the find the closest parent that DOES have a type.
  let ty_def_id = def_id;
  let instance_ty_: Ty;
  for (;;) {
    const key = tcx.def_key(ty_def_id);
    const data = key.disambiguated_data.data;
    if (data.$ === "TypeNs" || data.$ === "ValueNs" || data.$ === "Closure" || data.$ === "SyntheticCoroutineBody") {
      // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
      instance_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(ty_def_id) as EarlyBinder<Ty>));
      // debug!(?instance_ty);
      break;
    } else if (data.$ === "GlobalAsm") {
      // `global_asm!` doesn't have a type.
      instance_ty_ = tcx.types.unit;
      break;
    } else {
      // if we're making a symbol for something, there ought
      // to be a value or type-def or something in there
      // *somewhere*
      const parent = key.parent;
      if (parent === undefined) {
        return bug(`finding type for ${debug_DefId(def_id, PLAIN)}, encountered def-id ${debug_DefId(ty_def_id, PLAIN)} with no parent`);
      }
      ty_def_id = new DefId(parent, ty_def_id.krate);
    }
  }

  // Erase regions because they may not be deterministic when hashed
  // and should not matter anyhow.
  const instance_ty = tcx.erase_and_anonymize_regions(instance_ty_, fold_Ty);

  const hash = get_symbol_hash(tcx, instance, instance_ty, instantiating_crate);

  const p = new LegacySymbolMangler(tcx, SymbolPath.new(), false);
  const def = instance.def;
  let print_args: readonly GenericArg[];
  if (def.$ === "Shim" && (def._0.$ === "DropGlue" || def._0.$ === "AsyncDropGlueCtor" || def._0.$ === "FutureDropPoll")) {
    // Add the name of the dropped type to the symbol name
    print_args = instance.args;
  } else if (def.$ === "Shim" && def._0.$ === "AsyncDropGlue") {
    const ty = def._0._1;
    const k = ty.kind();
    if (k.$ !== "Coroutine") {
      return bug();
    }
    const cor_args = k._1;
    const drop_ty = GenericArgC.expect_ty(unwrap(cor_args[0]));
    print_args = tcx.mk_args([GenericArgC.from_Ty(drop_ty)]);
  } else {
    print_args = [];
  }
  unwrap_print(p.print_def_path(def_id, print_args));

  if (def.$ === "Shim") {
    const shim = def._0;
    switch (shim.$) {
      case "ThreadLocal":
        unwrap_print(p.write_str("{{tls-shim}}"));
        break;
      case "VTable":
        unwrap_print(p.write_str("{{vtable-shim}}"));
        break;
      case "Reify": {
        const reason = shim._1;
        unwrap_print(p.write_str("{{reify-shim"));
        if (reason === "FnPtr") {
          unwrap_print(p.write_str("-fnptr"));
        } else if (reason === "Vtable") {
          unwrap_print(p.write_str("-vtable"));
        }
        unwrap_print(p.write_str("}}"));
        break;
      }
      // FIXME(async_closures): This shouldn't be needed when we fix
      // `Instance::ty`/`Instance::def_id`.
      case "ConstructCoroutineInClosure": {
        const receiver_by_ref = shim.receiver_by_ref;
        unwrap_print(p.write_str(receiver_by_ref ? "{{by-move-shim}}" : "{{by-ref-shim}}"));
        break;
      }
      default:
        break;
    }
  }

  if (def.$ === "Shim" && def._0.$ === "FutureDropPoll") {
    p.write_str("{{drop-shim}}");
  }

  return p.path.finish(hash);
}

// rustc: compiler/rustc_symbol_mangling/src/legacy.rs:124 get_symbol_hash
function get_symbol_hash(
  tcx: TyCtxt,

  // instance this name will be for
  instance: Instance,

  // type of the item, without any generic
  // parameters instantiated; this is
  // included in the hash as a kind of
  // safeguard.
  item_type: Ty,

  instantiating_crate: CrateNum | undefined,
): Hash64 {
  const def_id = InstanceC.def_id(instance);
  const args = instance.args;
  // debug!("get_symbol_hash(def_id={:?}, parameters={:?})", def_id, args);

  return tcx.with_stable_hashing_context((hcx) => {
    const hasher = StableHasher.new();

    // the main symbol name is not necessarily unique; hash in the
    // compiler's internal def-path, guaranteeing each symbol has a
    // truly unique path
    stable_hash_DefPathHash(tcx.def_path_hash(def_id), hcx, hasher);

    // Include the main item-type. Note that, in this case, the
    // assertions about `has_param` may not hold, but this item-type
    // ought to be the same for every reference anyway.
    assert(!TypeVisitableExt.has_erasable_regions(item_type, fold_Ty), "assertion failed: !item_type.has_erasable_regions()");
    hcx.while_hashing_spans(false, (hcx) => {
      stable_hash_Ty(item_type, hcx, hasher);

      // If this is a function, we hash the signature as well.
      // This is not *strictly* needed, but it may help in some
      // situations, see the `run-make/a-b-a-linker-guard` test.
      if (item_type.kind().$ === "FnDef") {
        stable_hash_Binder(item_type.fn_sig(tcx), hcx, hasher, stable_hash_FnSig);
      }

      // also include any type parameters (for generic items)
      stable_hash_RawList(args, hcx, hasher, stable_hash_GenericArg);

      if (instantiating_crate !== undefined) {
        stable_hash_StableCrateId(tcx.stable_crate_id(instantiating_crate), hcx, hasher);
      }

      // We want to avoid accidental collision between different types of instances.
      // Especially, `VTableShim`s and `ReifyShim`s may overlap with their original
      // instances without this.
      stable_hash_Discriminant(InstanceKind__discriminant[instance.def.$], hcx, hasher);
    });

    // 64 bits should be enough to avoid collisions.
    return hasher.finish(Hash64);
  });
}

// Follow C++ namespace-mangling style, see
// https://en.wikipedia.org/wiki/Name_mangling for more info.
//
// It turns out that on macOS you can actually have arbitrary symbols in
// function names (at least when given to LLVM), but this is not possible
// when using unix's linker. Perhaps one day when we just use a linker from LLVM
// we won't need to do this name mangling. The problem with name mangling is
// that it seriously limits the available characters. For example we can't
// have things like &T in symbol names when one would theoretically
// want them for things like impls of traits on that type.
//
// To be able to work on all platforms and get *some* reasonable output, we
// use C++ name-mangling.
// #[derive(Debug)]
class SymbolPath {
  constructor(
    public result: string,
    public temp_buf: string,
  ) {}

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:202 new
  static new(): SymbolPath {
    const result = new SymbolPath("", "");
    result.result += "_ZN"; // _Z == Begin name-sequence, N == nested
    return result;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:209 finalize_pending_component
  finalize_pending_component(): void {
    if (this.temp_buf.length !== 0) {
      this.result += `${this.temp_buf.length}${this.temp_buf}`;
      this.temp_buf = "";
    }
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:216 finish
  finish(hash: Hash64): string {
    this.finalize_pending_component();
    // E = end name-sequence
    this.result += `17h${Hash64.as_u64(hash).toString(16).padStart(16, "0")}E`;
    return this.result;
  }
}

// HACK(eddyb) this relies on using the `fmt` interface to get
// `PrettyPrinter` aka pretty printing of e.g. types in paths,
// symbol names should have their own printing machinery.

class LegacySymbolMangler extends PrettyPrinter {
  constructor(
    public tcx_: TyCtxt,
    public path: SymbolPath,

    // When `true`, `finalize_pending_component` isn't used.
    // This is needed when recursing into `print_path_with_qualified`,
    // or `print_path_with_generic_args`, as any nested paths are
    // logically within one component.
    public keep_within_component: boolean,
  ) {
    super();
  }

  // ---- impl Printer for LegacySymbolMangler ----

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:240 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:244 print_region
  print_region(_region: Region): PrintResult {
    // This might be reachable (via `pretty_print_dyn_existential`) even though
    // `<Self As PrettyPrinter>::should_print_optional_region` returns false and
    // `print_path_with_generic_args` filters out lifetimes. See #144994.
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:251 print_type
  print_type(ty: Ty): PrintResult {
    let r: PrintResult;
    const kind = ty.kind();
    switch (kind.$) {
      // Print all nominal types as paths (unlike `pretty_print_type`).
      case "Alias": {
        const k = kind._1.kind;
        if (k.$ === "Projection" || k.$ === "Opaque") {
          return this.print_def_path(k.def_id, kind._1.args);
        }
        if (k.$ === "Inherent") {
          return panic("unexpected inherent projection");
        }
        return this.pretty_print_type(ty);
      }
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine":
        return this.print_def_path(kind._0, kind._1);

      case "FnDef":
        return this.print_def_path(kind._0, unwrap(Binder.no_bound_vars(kind._1, fold_GenericArgs)));

      // The `pretty_print_type` formatting of array size depends on
      // -Zverbose-internals flag, so we cannot reuse it here.
      case "Array": {
        const [ty, size] = [kind._0, kind._1];
        if ((r = this.write_str("[")).$ === "Err") return r;
        if ((r = this.print_type(ty)).$ === "Err") return r;
        if ((r = this.write_str("; ")).$ === "Err") return r;
        const size_ = size.try_to_target_usize(this.tcx());
        const sk = size.kind();
        if (size_ !== undefined) {
          if ((r = this.write_str(`${size_}`)).$ === "Err") return r;
        } else if (sk.$ === "Param") {
          const param = sk._0;
          if ((r = print_ParamConst(param, this)).$ === "Err") return r;
        } else {
          if ((r = this.write_str("_")).$ === "Err") return r;
        }
        if ((r = this.write_str("]")).$ === "Err") return r;
        return PRINT_OK;
      }

      default:
        return this.pretty_print_type(ty);
    }
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:291 print_dyn_existential
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    let r: PrintResult;
    let first = true;
    for (const p of predicates) {
      if (!first) {
        if ((r = this.write_str("+")).$ === "Err") return r;
      }
      first = false;
      if ((r = print_Binder(p, this, print_ExistentialPredicate as Print<ExistentialPredicate, this>, d_ExistentialPredicate)).$ === "Err") return r;
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:306 print_const
  print_const(ct: Const): PrintResult {
    let r: PrintResult;
    // only print integers
    const k = ct.kind();
    if (k.$ === "Value" && k._0.ty.is_integral()) {
      const cv = k._0;
      // The `pretty_print_const` formatting depends on -Zverbose-internals
      // flag, so we cannot reuse it here.
      const scalar = Value.to_leaf(cv);
      const signed = cv.ty.kind().$ === "Int";
      if ((r = this.write_str(debug_ConstInt(ConstInt.new(scalar, signed, cv.ty.is_ptr_sized_integral()), PRETTY))).$ === "Err") return r;
    } else {
      if ((r = this.write_str("_")).$ === "Err") return r;
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:325 print_crate_name
  print_crate_name(cnum: CrateNum): PrintResult {
    const r = this.write_str(Symbol.as_str(this.tcx_.crate_name(cnum)));
    if (r.$ === "Err") return r;
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:330 print_path_with_qualified
  print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    // Similar to `pretty_print_path_with_qualified`, but for the other
    // types that are printed as paths (see `print_type` above).
    const k = self_ty.kind().$;
    if ((k === "FnDef" || k === "Alias" || k === "Closure" || k === "CoroutineClosure" || k === "Coroutine") && trait_ref === undefined) {
      return this.print_type(self_ty);
    }

    return this.pretty_print_path_with_qualified(self_ty, trait_ref);
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:352 print_path_with_impl
  print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult {
    return this.pretty_print_path_with_impl(
      (cx) => {
        let r: PrintResult;
        if ((r = print_prefix(cx)).$ === "Err") return r;

        if (cx.keep_within_component) {
          // HACK(eddyb) print the path similarly to how `FmtPrinter` prints it.
          if ((r = cx.write_str("::")).$ === "Err") return r;
        } else {
          cx.path.finalize_pending_component();
        }

        return PRINT_OK;
      },
      self_ty,
      trait_ref,
    );
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:376 print_path_with_simple
  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    let r: PrintResult;
    if ((r = print_prefix(this)).$ === "Err") return r;

    // Skip `::{{extern}}` blocks and `::{{constructor}}` on tuple/unit structs.
    if (disambiguated_data.data.$ === "ForeignMod" || disambiguated_data.data.$ === "Ctor") {
      return PRINT_OK;
    }

    if (this.keep_within_component) {
      // HACK(eddyb) print the path similarly to how `FmtPrinter` prints it.
      if ((r = this.write_str("::")).$ === "Err") return r;
    } else {
      this.path.finalize_pending_component();
    }

    if ((r = this.write_str(display_DefPathData(disambiguated_data.data))).$ === "Err") return r;

    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:400 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args_: readonly GenericArg[]): PrintResult {
    const r = print_prefix(this);
    if (r.$ === "Err") return r;

    const args = args_.filter((arg) => GenericArgC.kind(arg).$ !== "Lifetime");
    if (args.length !== 0) {
      return this.generic_delimiters((cx) => cx.comma_sep(args, print_GenericArg as Print<GenericArg, this>));
    } else {
      return PRINT_OK;
    }
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:416 print_impl_path
  override print_impl_path(impl_def_id: DefId, args: readonly GenericArg[]): PrintResult {
    // PORT: the `type_of` / `generics_of` query values are `unknown` in queries.gen.ts.
    const self_ty_ = this.tcx_.type_of(impl_def_id) as EarlyBinder<Ty>;
    const impl_trait_ref_ = this.tcx_.impl_opt_trait_ref(impl_def_id);
    const generics = this.tcx_.generics_of(impl_def_id) as Generics;
    // We have two cases to worry about here:
    // 1. We're printing a nested item inside of an impl item, like an inner
    // function inside of a method. Due to the way that def path printing works,
    // we'll render this something like `<Ty as Trait>::method::inner_fn`
    // but we have no substs for this impl since it's not really inheriting
    // generics from the outer item. We need to use the identity substs, and
    // to normalize we need to use the correct param-env too.
    // 2. We're mangling an item with identity substs. This seems to only happen
    // when generating coverage, since we try to generate coverage for unused
    // items too, and if something isn't monomorphized then we necessarily don't
    // have anything to substitute the instance with.
    // NOTE: We don't support mangling partially substituted but still polymorphic
    // instances, like `impl<A> Tr<A> for ()` where `A` is substituted w/ `(T,)`.
    let typing_env: TypingEnv;
    let self_ty: Ty;
    let impl_trait_ref: TraitRef | undefined;
    if (
      generics.count() > args.length ||
      slice_eq(args.slice(0, generics.count()), this.tcx_.erase_and_anonymize_regions(RawList.identity_for_item(this.tcx_, impl_def_id), fold_GenericArgs))
    ) {
      [typing_env, self_ty, impl_trait_ref] = [
        TypingEnv.post_analysis(this.tcx_, impl_def_id),
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(self_ty_)),
        impl_trait_ref_ === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_trait_ref_)),
      ];
    } else {
      // PORT: `[GenericArg]: TypeVisitable` visits every element, so the flag check is `any` over the elements.
      assert(
        !args.some((a) => TypeVisitableExt.has_non_region_param(a, fold_GenericArg)),
        () => `should not be mangling partially substituted polymorphic instance: ${debug_DefId(impl_def_id, PLAIN)} ${debug_list(PLAIN, args.map((a) => debug_GenericArg(a, PLAIN)))}`,
      );
      [typing_env, self_ty, impl_trait_ref] = [
        TypingEnv.fully_monomorphized(),
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate(self_ty_, this.tcx_, args, fold_Ty)),
        impl_trait_ref_ === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_trait_ref_, this.tcx_, args, d_TraitRef)),
      ];
    }

    if (impl_trait_ref !== undefined) {
      assert_eq(TraitRef.self_ty(impl_trait_ref), self_ty, (t) => display_Ty(t));
      const normalized: TraitRef = this.tcx_.normalize_erasing_regions(typing_env, Unnormalized.new_wip<TraitRef>(impl_trait_ref), d_TraitRef);
      impl_trait_ref = normalized;
      self_ty = TraitRef.self_ty(normalized);
    } else {
      self_ty = this.tcx_.normalize_erasing_regions(typing_env, Unnormalized.new_wip(self_ty), fold_Ty);
    }

    return this.default_print_impl_path(impl_def_id, self_ty, impl_trait_ref);
  }

  // ---- impl PrettyPrinter for LegacySymbolMangler ----

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:487 should_print_optional_region
  should_print_optional_region(_region: Region): boolean {
    return false;
  }

  // Identical to `PrettyPrinter::comma_sep` except there is no space after each comma.
  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:492 comma_sep
  override comma_sep<T>(elems_: Iterable<T>, print_T: Print<T, this>): PrintResult {
    let r: PrintResult;
    const elems = elems_[globalThis.Symbol.iterator]();
    const first = elems.next();
    if (!first.done) {
      if ((r = print_T(first.value, this)).$ === "Err") return r;
      for (let elem = elems.next(); !elem.done; elem = elems.next()) {
        if ((r = this.write_str(",")).$ === "Err") return r;
        if ((r = print_T(elem.value, this)).$ === "Err") return r;
      }
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:506 generic_delimiters
  generic_delimiters(f: (p: this) => PrintResult): PrintResult {
    let r: PrintResult;
    if ((r = this.write_str("<")).$ === "Err") return r;

    const kept_within_component = this.keep_within_component;
    this.keep_within_component = true;
    if ((r = f(this)).$ === "Err") return r;
    this.keep_within_component = kept_within_component;

    if ((r = this.write_str(">")).$ === "Err") return r;

    return PRINT_OK;
  }

  // ---- impl fmt::Write for LegacySymbolMangler ----

  // rustc: compiler/rustc_symbol_mangling/src/legacy.rs:523 write_str
  write_str(s: string): PrintResult {
    // Name sanitation. LLVM will happily accept identifiers with weird names, but
    // gas doesn't!
    // gas accepts the following characters in symbols: a-z, A-Z, 0-9, ., _, $
    // NVPTX assembly has more strict naming rules than gas, so additionally, dots
    // are replaced with '$' there.

    for (const c of s) {
      if (this.path.temp_buf.length === 0) {
        if (is_ascii_alpha(c) || c === "_") {
          // nothing
        } else {
          // Underscore-qualify anything that didn't start as an ident.
          this.path.temp_buf += "_";
        }
      }
      switch (c) {
        // Escape these with $ sequences
        case "@":
          this.path.temp_buf += "$SP$";
          continue;
        case "*":
          this.path.temp_buf += "$BP$";
          continue;
        case "&":
          this.path.temp_buf += "$RF$";
          continue;
        case "<":
          this.path.temp_buf += "$LT$";
          continue;
        case ">":
          this.path.temp_buf += "$GT$";
          continue;
        case "(":
          this.path.temp_buf += "$LP$";
          continue;
        case ")":
          this.path.temp_buf += "$RP$";
          continue;
        case ",":
          this.path.temp_buf += "$C$";
          continue;
      }

      if ((c === "-" || c === ":" || c === ".") && this.tcx_.has_strict_asm_symbol_naming()) {
        // NVPTX doesn't support these characters in symbol names.
        this.path.temp_buf += "$";
      } else if (c === "-" || c === ":") {
        // '.' doesn't occur in types and functions, so reuse it
        // for ':' and '-'
        this.path.temp_buf += ".";
      } else if (c === "m" && this.path.temp_buf.endsWith(".llv")) {
        // Avoid crashing LLVM in certain (LTO-related) situations, see #60925.
        this.path.temp_buf += "$u6d$";
      } else if (is_ascii_alpha(c) || (c >= "0" && c <= "9") || c === "_" || c === "." || c === "$") {
        // These are legal symbols
        this.path.temp_buf += c;
      } else {
        this.path.temp_buf += "$";
        // `c.escape_unicode().skip(1)` is `u{XXXX}` (lowercase hex); `{` is dropped and `}` becomes `$`.
        this.path.temp_buf += `u${unwrap(c.codePointAt(0)).toString(16)}$`;
      }
    }

    return PRINT_OK;
  }
}

/** `'a'..='z' | 'A'..='Z'` */
function is_ascii_alpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

/** `&args[..n] == other.as_slice()`: slices of interned args compare element-wise by identity. */
function slice_eq(a: readonly GenericArg[], b: readonly GenericArg[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

