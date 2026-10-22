// Port of compiler/rustc_symbol_mangling/src/v0.rs (lane symbol-mangling).
//
// PORT decisions:
// - `V0SymbolMangler` is a class extending the `Printer` abstract class (rustc_middle ty/print/mod.ts); `Result<(),
//   PrintError>` is `PrintResult`, `?` is an early return of the `Err`.
// - `out: String` is a JS string. Everything pushed is ASCII (identifiers go through punycode, `str` consts are
//   hex-encoded), so `out.len()` (bytes) is `out.length`; the backref positions are those offsets.
// - `paths: FxHashMap<(DefId, &[GenericArg]), usize>` is a `KeyedMap` on `intern_key` (the `DefId` by value, the
//   args element-wise by interned identity, as the slice's derived `Hash` + `Eq`); `types` / `consts` key on the
//   hash-consed `Ty` / `Const` objects (PORTING §5). Only lookups, never iteration.
// - `Either<u64, &str>` (`mangle_cgu`) is `{ $: "Left"; _0: bigint } | { $: "Right"; _0: string }`.
// - `u64` disambiguators / hashes are `bigint` (stable crate ids and hashes use all 64 bits).
import { type ExternAbi, ExternAbi as ExternAbiC } from "../rustc_abi/extern_abi.ts";
import { Integer } from "../rustc_abi/lib.ts";
import { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { to_base } from "../rustc_data_structures/base_n.ts";
import { StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { type DefPathData, DefPathData as DefPathDataC, type DisambiguatedDefPathData } from "../rustc_hir_id/definitions.ts";
import { type Generics } from "../rustc_middle/ty/generics.ts";
import { IntegerExt } from "../rustc_middle/ty/layout.ts";
import { type PrintResult, PRINT_OK, Printer, print_Const, print_Region, print_Ty } from "../rustc_middle/ty/print/mod.ts";
import { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Instance, Instance as InstanceC } from "../rustc_middle/ty/instance.ts";
import { type GenericArg, GenericArg as GenericArgC, fold_GenericArg, fold_GenericArgs, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Value } from "../rustc_middle/ty/consts/valtree.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import { type Pattern } from "../rustc_middle/ty/pattern.ts";
import { DefId, type CrateNum, CrateNum as CrateNumC, StableCrateId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import type { PolyExistentialPredicate } from "../rustc_type_ir/decls.ts";
import { as_interner, ExistentialTraitRef, TraitRef, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../rustc_type_ir/predicate.ts";
import { Const, type Region } from "../rustc_type_ir/sty/mod.ts";
import { fold_Const } from "../rustc_type_ir/sty/consts.ts";
import { FnHeader, FnSig, PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { Term } from "../rustc_middle/ty/mod.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { assert, assert_eq, panic, unreachable, unwrap } from "../std/panic.ts";
import { debug_list, PLAIN } from "../std/fmt.ts";
import { debug_DefId } from "../rustc_span/def_id.ts";
import { debug_GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { debug_Region } from "../rustc_type_ir/sty/mod.ts";
import { debug_Const } from "../rustc_type_ir/sty/mod.ts";
import { debug_ValTree } from "../rustc_middle/ty/consts/valtree.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { debug_DefPathData } from "../rustc_hir_id/definitions.gen.ts";
import { encode as punycode_encode } from "../vendor/punycode/lib.ts";
import { from_utf8 } from "../std/str.ts";

/** PORT: the `TypeFoldable` impl fns of `TraitRef` (generated) as a D4 descriptor. */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:26 mangle
export function mangle(tcx: TyCtxt, instance: Instance, instantiating_crate: CrateNum | undefined, is_exportable: boolean): string {
  const def_id = InstanceC.def_id(instance);
  // FIXME(eddyb) this should ideally not be needed.
  const args = tcx.normalize_erasing_regions(TypingEnv.fully_monomorphized(), Unnormalized.new_wip(instance.args), fold_GenericArgs);

  const prefix = "_R";
  const p = new V0SymbolMangler(tcx, [], prefix, is_exportable, prefix.length, new_paths(), new Map(), new Map());

  // Append `::{shim:...#0}` to shims that can coexist with a non-shim instance.
  let shim_kind: string | undefined;
  const def = instance.def;
  if (def.$ === "Shim") {
    const shim = def._0;
    switch (shim.$) {
      case "ThreadLocal":
        shim_kind = "tls";
        break;
      case "VTable":
        shim_kind = "vtable";
        break;
      case "Reify":
        if (shim._1 === undefined) {
          shim_kind = "reify";
        } else if (shim._1 === "FnPtr") {
          shim_kind = "reify_fnptr";
        } else {
          shim_kind = "reify_vtable";
        }
        break;

      // FIXME(async_closures): This shouldn't be needed when we fix
      // `Instance::ty`/`Instance::def_id`.
      case "ConstructCoroutineInClosure":
        shim_kind = shim.receiver_by_ref ? "by_move" : "by_ref";
        break;
      case "FutureDropPoll":
        shim_kind = "drop";
        break;
      default:
        shim_kind = undefined;
    }
  } else {
    shim_kind = undefined;
  }

  if (def.$ === "Shim" && def._0.$ === "AsyncDropGlue") {
    const ty = def._0._1;
    const k = ty.kind();
    if (k.$ !== "Coroutine") {
      return bug();
    }
    const cor_args = k._1;
    const drop_ty = GenericArgC.expect_ty(unwrap(cor_args[0]));
    unwrap_print(p.print_def_path(def_id, tcx.mk_args([GenericArgC.from_Ty(drop_ty)])));
  } else if (shim_kind !== undefined) {
    const shim_kind_ = shim_kind;
    unwrap_print(p.path_append_ns((p) => p.print_def_path(def_id, args), "S", 0n, shim_kind_));
  } else {
    unwrap_print(p.print_def_path(def_id, args));
  }
  if (instantiating_crate !== undefined) {
    unwrap_print(p.print_def_path(CrateNumC.as_def_id(instantiating_crate), []));
  }
  return p.take_out();
}

/** `FxHashMap::default()` of `V0SymbolMangler::paths` */
function new_paths(): KeyedMap<readonly [DefId, readonly GenericArg[]], number> {
  return new KeyedMap<readonly [DefId, readonly GenericArg[]], number>(intern_key);
}

/** `Result<(), fmt::Error>::unwrap()` */
function unwrap_print(r: PrintResult): void {
  if (r.$ === "Err") panic("called `Result::unwrap()` on an `Err` value: Error");
}

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:94 mangle_cgu
export function mangle_cgu(tcx: TyCtxt, krate: CrateNum, cgu_name: { $: "Left"; _0: bigint } | { $: "Right"; _0: string }): string {
  const prefix = "_R";
  const p = new V0SymbolMangler(tcx, [], prefix, false, prefix.length, new_paths(), new Map(), new Map());

  switch (cgu_name.$) {
    case "Left": {
      const cgu_index = cgu_name._0;
      // If we have a CGU index, we can easily encode this with the shim mechanism.
      unwrap_print(p.path_append_ns((p) => p.print_def_path(CrateNumC.as_def_id(krate), []), "S", cgu_index, "cgu"));
      break;
    }
    case "Right": {
      const name = cgu_name._0;
      // In incremental compilation we just have a name and no index. Encode this as a str-typed generic argument to cgu shim for now.
      p.out += "I";
      unwrap_print(p.path_append_ns((p) => p.print_def_path(CrateNumC.as_def_id(krate), []), "S", 0n, "cgu"));
      p.push("KRe");

      for (const byte of new TextEncoder().encode(name)) {
        p.out += byte.toString(16).padStart(2, "0");
      }

      p.push("_E");
      break;
    }
  }

  return p.take_out();
}

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:130 mangle_internal_symbol
export function mangle_internal_symbol(tcx: TyCtxt, item_name: string): string {
  switch (item_name) {
    // rust_eh_personality must not be renamed as LLVM hard-codes the name
    case "rust_eh_personality":
      return item_name;
    // Apple availability symbols need to not be mangled to be usable by
    // C/Objective-C code.
    case "__isPlatformVersionAtLeast":
    case "__isOSVersionAtLeast":
      return item_name;
    default:
      break;
  }

  const prefix = "_R";
  const p = new V0SymbolMangler(tcx, [], prefix, false, prefix.length, new_paths(), new Map(), new Map());

  unwrap_print(
    p.path_append_ns(
      (p) => {
        p.push("C");
        p.push_disambiguator(
          (() => {
            const hasher = StableHasher.new();
            // Incorporate the rustc version to ensure #[rustc_std_internal_symbol] functions
            // get a different symbol name depending on the rustc version.
            //
            // RUSTC_FORCE_RUSTC_VERSION is ignored here as otherwise different we would get an
            // abi incompatibility with the standard library.
            hasher.write(new TextEncoder().encode(tcx.sess.cfg_version));

            const hash: Hash64 = hasher.finish(Hash64);
            return Hash64.as_u64(hash);
          })(),
        );
        p.push_ident("__rustc");
        return PRINT_OK;
      },
      "v",
      0n,
      item_name,
    ),
  );

  return p.take_out();
}

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:179 mangle_typeid_for_trait_ref
export function mangle_typeid_for_trait_ref(tcx: TyCtxt, trait_ref: ExistentialTraitRef): string {
  // FIXME(flip1995): See comment in `mangle_typeid_for_fnabi`.
  const p = new V0SymbolMangler(tcx, [], "", false, 0, new_paths(), new Map(), new Map());
  unwrap_print(p.print_def_path(trait_ref.def_id, []));
  return p.take_out();
}

/** `Range<u32>` */
interface Range {
  start: number;
  end: number;
}

interface BinderLevel {
  /// The range of distances from the root of what's
  /// being printed, to the lifetimes in a binder.
  /// Specifically, a `BrAnon` lifetime has depth
  /// `lifetime_depths.start + index`, going away from the
  /// the root and towards its use site, as the var index increases.
  /// This is used to flatten rustc's pairing of `BrAnon`
  /// (intra-binder disambiguation) with a `DebruijnIndex`
  /// (binder addressing), to "true" de Bruijn indices,
  /// by subtracting the depth of a certain lifetime, from
  /// the innermost depth at its use site.
  lifetime_depths: Range;
}

class V0SymbolMangler extends Printer {
  constructor(
    public tcx_: TyCtxt,
    public binders: BinderLevel[],
    public out: string,
    public is_exportable: boolean,

    /// The length of the prefix in `out` (e.g. 2 for `_R`).
    public start_offset: number,
    /// The values are start positions in `out`, in bytes.
    public paths: KeyedMap<readonly [DefId, readonly GenericArg[]], number>,
    public types: Map<Ty, number>,
    public consts: Map<Const, number>,
  ) {
    super();
  }

  /** `std::mem::take(&mut p.out)` */
  take_out(): string {
    const out = this.out;
    this.out = "";
    return out;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:227 push
  push(s: string): void {
    this.out += s;
  }

  /// Push a `_`-terminated base 62 integer, using the format
  /// specified in the RFC as `<base-62-number>`, that is:
  /// * `x = 0` is encoded as just the `"_"` terminator
  /// * `x > 0` is encoded as `x - 1` in base 62, followed by `"_"`,
  ///   e.g. `1` becomes `"0_"`, `62` becomes `"Z_"`, etc.
  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:236 push_integer_62
  push_integer_62(x: bigint): void {
    const output = { value: this.out };
    push_integer_62(x, output);
    this.out = output.value;
  }

  /// Push a `tag`-prefixed base 62 integer, when larger than `0`, that is:
  /// * `x = 0` is encoded as `""` (nothing)
  /// * `x > 0` is encoded as the `tag` followed by `push_integer_62(x - 1)`
  ///   e.g. `1` becomes `tag + "_"`, `2` becomes `tag + "0_"`, etc.
  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:244 push_opt_integer_62
  push_opt_integer_62(tag: string, x: bigint): void {
    // `x.checked_sub(1)`
    if (x >= 1n) {
      const x_ = x - 1n;
      this.push(tag);
      this.push_integer_62(x_);
    }
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:251 push_disambiguator
  push_disambiguator(dis: bigint): void {
    this.push_opt_integer_62("s", dis);
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:255 push_ident
  push_ident(ident: string): void {
    const output = { value: this.out };
    push_ident(ident, output);
    this.out = output.value;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:259 path_append_ns
  path_append_ns(print_prefix: (p: this) => PrintResult, ns: string, disambiguator: bigint, name: string): PrintResult {
    this.push("N");
    this.out += ns;
    const r = print_prefix(this);
    if (r.$ === "Err") return r;
    this.push_disambiguator(disambiguator);
    this.push_ident(name);
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:274 print_backref
  print_backref(i: number): PrintResult {
    this.push("B");
    this.push_integer_62(BigInt(i - this.start_offset));
    return PRINT_OK;
  }

  // PORT: `T: TypeVisitable` is unused by the body (only `bound_vars` / `skip_binder`); no descriptor.
  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:280 wrap_binder
  wrap_binder<T>(value: Binder<T>, print_value: (p: this, value: T) => PrintResult): PrintResult {
    const last = this.binders[this.binders.length - 1];
    const i = last === undefined ? undefined : last.lifetime_depths.end;
    const lifetime_depths: Range = i === undefined ? { start: 0, end: 0 } : { start: i, end: i };

    // FIXME(non-lifetime-binders): What to do here?
    let lifetimes = 0;
    for (const var_ of Binder.bound_vars(value)) {
      if (var_.$ === "Region") lifetimes += 1;
    }

    this.push_opt_integer_62("G", BigInt(lifetimes));
    lifetime_depths.end += lifetimes;

    this.binders.push({ lifetime_depths });
    const r = print_value(this, Binder.skip_binder(Binder.as_ref(value)));
    if (r.$ === "Err") return r;
    this.binders.pop();

    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:308 print_pat
  print_pat(pat: Pattern): PrintResult {
    let r: PrintResult;
    const k = pat.kind();
    switch (k.$) {
      case "Range": {
        const { start, end } = k;
        this.push("R");
        if ((r = this.print_const(start)).$ === "Err") return r;
        if ((r = this.print_const(end)).$ === "Err") return r;
        break;
      }
      case "NotNull": {
        if ((r = print_Ty(this.tcx_.types.unit, this)).$ === "Err") return r;
        break;
      }
      case "Or": {
        const patterns = k._0;
        this.push("O");
        for (const pat of patterns) {
          if ((r = this.print_pat(pat)).$ === "Err") return r;
        }
        this.push("E");
        break;
      }
    }
    return PRINT_OK;
  }

  // ---- impl Printer for V0SymbolMangler ----

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:330 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:334 print_def_path
  override print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    const i = this.paths.get([def_id, args]);
    if (i !== undefined) {
      return this.print_backref(i);
    }
    const start = this.out.length;

    const r = this.default_print_def_path(def_id, args);
    if (r.$ === "Err") return r;

    // Only cache paths that do not refer to an enclosing
    // binder (which would change depending on context).
    if (!args.some((k) => TypeVisitableExt.has_escaping_bound_vars(k, fold_GenericArg))) {
      this.paths.set([def_id, args], start);
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:354 print_impl_path
  override print_impl_path(impl_def_id: DefId, args: readonly GenericArg[]): PrintResult {
    let r: PrintResult;
    const key = this.tcx_.def_key(impl_def_id);
    const parent_def_id = new DefId(unwrap(key.parent), impl_def_id.krate);

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
      // PORT: `[GenericArg]: TypeVisitable` visits every element, so the flag checks are `any` over the elements.
      assert(
        !args.some((a) => TypeVisitableExt.has_non_region_param(a, fold_GenericArg)) && !args.some((a) => TypeVisitableExt.has_free_regions(a, fold_GenericArg)),
        `should not be mangling partially substituted polymorphic instance: ${debug_DefId(impl_def_id, PLAIN)} ${debug_list(PLAIN, args.map((a) => debug_GenericArg(a, PLAIN)))}`,
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

    this.push(impl_trait_ref !== undefined ? "X" : "M");

    // Encode impl generic params if the generic parameters contain non-region parameters
    // and this isn't an inherent impl.
    if (impl_trait_ref !== undefined && args.some((a) => TypeVisitableExt.has_non_region_param(a, fold_GenericArg))) {
      if (
        (r = this.print_path_with_generic_args(
          (this_) => this_.path_append_ns((p) => p.print_def_path(parent_def_id, []), "I", BigInt(key.disambiguated_data.disambiguator), ""),
          args,
        )).$ === "Err"
      )
        return r;
    } else {
      const exported_impl_order = this.tcx_.stable_order_of_exportable_impls(impl_def_id.krate);
      let disambiguator: bigint;
      switch (this.is_exportable) {
        case true:
          disambiguator = BigInt(unwrap(exported_impl_order.get(impl_def_id)));
          break;
        case false:
          disambiguator = BigInt(exported_impl_order.size) + BigInt(key.disambiguated_data.disambiguator);
          break;
      }
      this.push_disambiguator(disambiguator);
      if ((r = this.print_def_path(parent_def_id, [])).$ === "Err") return r;
    }

    if ((r = print_Ty(self_ty, this)).$ === "Err") return r;

    if (impl_trait_ref !== undefined) {
      const trait_ref = impl_trait_ref;
      if ((r = this.print_def_path(trait_ref.def_id, trait_ref.args)).$ === "Err") return r;
    }

    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:463 print_region
  print_region(region: Region): PrintResult {
    let i: number;
    const k = region.kind();
    if (k.$ === "ReErased") {
      // Erased lifetimes use the index 0, for a
      // shorter mangling of `L_`.
      i = 0;
    } else if (k.$ === "ReBound" && k._0.$ === "Bound" && k._1.kind.$ === "Anon") {
      // Bound lifetimes use indices starting at 1,
      // see `BinderLevel` for more details.
      const debruijn = k._0._0;
      const var_ = k._1.var;
      const binder = unwrap(this.binders[this.binders.length - 1 - debruijn]);
      const depth = binder.lifetime_depths.start + var_;

      i = 1 + (unwrap(this.binders[this.binders.length - 1]).lifetime_depths.end - 1 - depth);
    } else {
      return bug(`symbol_names: non-erased region \`${debug_Region(region, PLAIN)}\``);
    }
    this.push("L");
    this.push_integer_62(BigInt(i));
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:488 print_type
  print_type(ty: Ty): PrintResult {
    let r: PrintResult;
    // Basic types, never cached (single-character).
    const k0 = ty.kind();
    let basic_type: string;
    switch (k0.$) {
      case "Bool":
        basic_type = "b";
        break;
      case "Char":
        basic_type = "c";
        break;
      case "Str":
        basic_type = "e";
        break;
      case "Int":
        switch (k0._0) {
          case IntTy.I8:
            basic_type = "a";
            break;
          case IntTy.I16:
            basic_type = "s";
            break;
          case IntTy.I32:
            basic_type = "l";
            break;
          case IntTy.I64:
            basic_type = "x";
            break;
          case IntTy.I128:
            basic_type = "n";
            break;
          case IntTy.Isize:
            basic_type = "i";
            break;
        }
        break;
      case "Uint":
        switch (k0._0) {
          case UintTy.U8:
            basic_type = "h";
            break;
          case UintTy.U16:
            basic_type = "t";
            break;
          case UintTy.U32:
            basic_type = "m";
            break;
          case UintTy.U64:
            basic_type = "y";
            break;
          case UintTy.U128:
            basic_type = "o";
            break;
          case UintTy.Usize:
            basic_type = "j";
            break;
        }
        break;
      case "Float":
        switch (k0._0) {
          case FloatTy.F16:
            basic_type = "C3f16";
            break;
          case FloatTy.F32:
            basic_type = "f";
            break;
          case FloatTy.F64:
            basic_type = "d";
            break;
          case FloatTy.F128:
            basic_type = "C4f128";
            break;
        }
        break;
      case "Never":
        basic_type = "z";
        break;

      // Should only be encountered within the identity-substituted
      // impl header of an item nested within an impl item.
      case "Param":
        basic_type = "p";
        break;

      default:
        basic_type = k0.$ === "Tuple" && ty.is_unit() ? "u" : "";
    }
    if (basic_type !== "") {
      this.push(basic_type);
      return PRINT_OK;
    }

    const i = this.types.get(ty);
    if (i !== undefined) {
      return this.print_backref(i);
    }
    const start = this.out.length;

    const kind = ty.kind();
    switch (kind.$) {
      // Basic types, handled above.
      case "Bool":
      case "Char":
      case "Str":
      case "Int":
      case "Uint":
      case "Float":
      case "Never":
        return unreachable();
      case "Param":
        return unreachable();

      case "Bound":
      case "Placeholder":
      case "Infer":
      case "Error":
        return bug();

      case "Ref": {
        const [rg, ty, mutbl] = [kind._0, kind._1, kind._2];
        this.push(mutbl === "Not" ? "R" : "Q");
        if (!rg.is_erased()) {
          if ((r = print_Region(rg, this)).$ === "Err") return r;
        }
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        break;
      }

      case "RawPtr": {
        const [ty, mutbl] = [kind._0, kind._1];
        this.push(mutbl === "Not" ? "P" : "O");
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        break;
      }

      case "Pat": {
        const [ty, pat] = [kind._0, kind._1];
        this.push("W");
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        if ((r = this.print_pat(pat)).$ === "Err") return r;
        break;
      }

      case "Array": {
        const [ty, len] = [kind._0, kind._1];
        this.push("A");
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        if ((r = this.print_const(len)).$ === "Err") return r;
        break;
      }
      case "Slice": {
        const ty = kind._0;
        this.push("S");
        if ((r = print_Ty(ty, this)).$ === "Err") return r;
        break;
      }

      case "Tuple": {
        if (ty.is_unit()) return unreachable();
        const tys = kind._0;
        this.push("T");
        for (const ty of tys) {
          if ((r = print_Ty(ty, this)).$ === "Err") return r;
        }
        this.push("E");
        break;
      }

      // Mangle all nominal types as paths.
      case "Adt": {
        const def_id = kind._0.did();
        const args = kind._1;
        if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
        break;
      }
      case "Closure":
      case "CoroutineClosure":
      case "Coroutine": {
        const [def_id, args] = [kind._0, kind._1];
        if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
        break;
      }

      case "FnDef": {
        const [def_id, args] = [kind._0, kind._1];
        if ((r = this.print_def_path(def_id, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)))).$ === "Err") return r;
        break;
      }

      // We may still encounter projections here due to the printing
      // logic sometimes passing identity-substituted impl headers.
      case "Alias": {
        const data = kind._1;
        if (data.kind.$ === "Projection") {
          const def_id = data.kind.def_id;
          const args = data.args;
          if ((r = this.print_def_path(def_id, args)).$ === "Err") return r;
          break;
        }
        return bug("symbol_names: unexpected alias");
      }

      case "Foreign": {
        const def_id = kind._0;
        if ((r = this.print_def_path(def_id, [])).$ === "Err") return r;
        break;
      }

      case "FnPtr": {
        const [sig_tys, hdr] = [kind._0, kind._1];
        const splatted_arg_index = FnHeader.splatted(hdr);
        const sig = PolyFnSigTys.with(sig_tys, hdr);
        this.push("F");
        if (
          (r = this.wrap_binder(sig, (p, sig) => {
            let r: PrintResult;
            if (FnSig.safety(sig) === "Unsafe") {
              p.push("U");
            }
            const abi: ExternAbi = FnSig.abi(sig);
            if (abi.$ === "Rust") {
              // nothing
            } else if (abi.$ === "C" && abi.unwind === false) {
              p.push("KC");
            } else {
              p.push("K");
              const name = ExternAbiC.as_str(abi);
              if (name.includes("-")) {
                p.push_ident(name.replaceAll("-", "_"));
              } else {
                p.push_ident(name);
              }
            }
            const inputs = FnSig.inputs(sig);
            for (let i = 0; i < inputs.length; i++) {
              const ty = inputs[i]!;
              if (splatted_arg_index === i) {
                // The splat feature is unstable and its mangling is subject to change
                // FIXME(splat):
                // - for efficiency we might want to use a letter that can't occur in any type, rather than
                //   taking an unused letter
                // - splat isn't implemented for legacy mangling
                p.push("w");
              }
              if ((r = print_Ty(ty, p)).$ === "Err") return r;
            }
            if (FnSig.c_variadic(sig)) {
              p.push("v");
            }
            p.push("E");
            return print_Ty(FnSig.output(sig), p);
          })).$ === "Err"
        )
          return r;
        break;
      }

      // FIXME(unsafe_binder):
      case "UnsafeBinder":
        return panic("not implemented");

      case "Dynamic": {
        const [predicates, rg] = [kind._0, kind._1];
        this.push("D");
        if ((r = this.print_dyn_existential(predicates)).$ === "Err") return r;
        if ((r = print_Region(rg, this)).$ === "Err") return r;
        break;
      }

      case "CoroutineWitness":
        return bug("symbol_names: unexpected `CoroutineWitness`");
    }

    // Only cache types that do not refer to an enclosing
    // binder (which would change depending on context).
    if (!TypeVisitableExt.has_escaping_bound_vars(ty, fold_Ty)) {
      this.types.set(ty, start);
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:666 print_dyn_existential
  print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult {
    let r: PrintResult;
    // Okay, so this is a bit tricky. Imagine we have a trait object like
    // `dyn for<'a> Foo<'a, Bar = &'a ()>`. When we mangle this, the
    // output looks really close to the syntax, where the `Bar = &'a ()` bit
    // is under the same binders (`['a]`) as the `Foo<'a>` bit. However, we
    // actually desugar these into two separate `ExistentialPredicate`s. We
    // can't enter/exit the "binder scope" twice though, because then we
    // would mangle the binders twice. (Also, side note, we merging these
    // two is kind of difficult, because of potential HRTBs in the Projection
    // predicate.)
    //
    // Also worth mentioning: imagine that we instead had
    // `dyn for<'a> Foo<'a, Bar = &'a ()> + Send`. In this case, `Send` is
    // under the same binders as `Foo`. Currently, this doesn't matter,
    // because only *auto traits* are allowed other than the principal trait
    // and all auto traits don't have any generics. Two things could
    // make this not an "okay" mangling:
    // 1) Instead of mangling only *used*
    // bound vars, we want to mangle *all* bound vars (`for<'b> Send` is a
    // valid trait predicate);
    // 2) We allow multiple "principal" traits in the future, or at least
    // allow in any form another trait predicate that can take generics.
    //
    // Here we assume that predicates have the following structure:
    // [<Trait> [{<Projection>}]] [{<Auto>}]
    // Since any predicates after the first one shouldn't change the binders,
    // just put them all in the binders of the first.
    const first = predicates[0] ?? panic(`index out of bounds: the len is 0 but the index is 0`);
    if (
      (r = this.wrap_binder(first, (p, _) => {
        let r: PrintResult;
        for (const predicate of predicates) {
          // It would be nice to be able to validate bound vars here, but
          // projections can actually include bound vars from super traits
          // because of HRTBs (only in the `Self` type). Also, auto traits
          // could have different bound vars *anyways*.
          const pred = Binder.skip_binder(Binder.as_ref(predicate));
          switch (pred.$) {
            case "Trait": {
              const trait_ref_ = pred._0;
              // Dummy Self is safe to use as it can't appear in generic param defaults
              // which is important later on for correctly eliding generic args that
              // coincide with their default.
              const trait_ref = ExistentialTraitRef.with_self_ty(trait_ref_, as_interner(p.tcx_), p.tcx_.types.trait_object_dummy_self);
              if ((r = p.print_def_path(trait_ref.def_id, trait_ref.args)).$ === "Err") return r;
              break;
            }
            case "Projection": {
              const projection = pred._0;
              // PORT: the `associated_item` query value is `unknown` in queries.gen.ts.
              const name = AssocItem.name(p.tcx_.associated_item(projection.def_id) as AssocItem);
              p.push("p");
              p.push_ident(Symbol.as_str(name));
              const tk = Term.kind(projection.term);
              switch (tk.$) {
                case "Ty":
                  r = print_Ty(tk._0, p);
                  break;
                case "Const":
                  p.push("K");
                  r = print_Const(tk._0, p);
                  break;
              }
              if (r.$ === "Err") return r;
              break;
            }
            case "AutoTrait": {
              const def_id = pred._0;
              if ((r = p.print_def_path(def_id, [])).$ === "Err") return r;
              break;
            }
          }
        }
        return PRINT_OK;
      })).$ === "Err"
    )
      return r;

    this.push("E");
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:735 print_const
  print_const(ct: Const): PrintResult {
    let r: PrintResult;
    // We only mangle a typed value if the const can be evaluated.
    const kind = ct.kind();
    let cv: Value;
    switch (kind.$) {
      case "Value":
        cv = kind._0;
        break;

      // Should only be encountered within the identity-substituted
      // impl header of an item nested within an impl item.
      case "Param": {
        // Never cached (single-character).
        this.push("p");
        return PRINT_OK;
      }

      // We may still encounter alias consts due to the printing
      // logic sometimes passing identity-substituted impl headers.
      case "Alias": {
        const { kind: k, args } = kind._1;
        switch (k.$) {
          case "Projection":
          case "InherentSelf":
          case "InherentImpl":
          case "Free":
          case "Anon": {
            const def_id = k.def_id;
            return this.print_def_path(def_id, args);
          }
        }
        return unreachable();
      }

      case "Expr":
      case "Infer":
      case "Bound":
      case "Placeholder":
      case "Error":
        return bug();
    }

    const i = this.consts.get(ct);
    if (i !== undefined) {
      if ((r = this.print_backref(i)).$ === "Err") return r;
      return PRINT_OK;
    }

    const { ty: ct_ty, valtree } = cv;
    const start = this.out.length;

    const ck = ct_ty.kind();
    switch (ck.$) {
      case "Uint":
      case "Int":
      case "Bool":
      case "Char": {
        if ((r = print_Ty(ct_ty, this)).$ === "Err") return r;

        let bits = Value.try_to_bits(cv, this.tcx_, TypingEnv.fully_monomorphized());
        if (bits === undefined) return panic("expected const to be monomorphic");

        // Negative integer values are mangled using `n` as a "sign prefix".
        if (ck.$ === "Int") {
          const ity = ck._0;
          // `sign_extend(bits) as i128`: the sign-extended u128 reinterpreted as i128.
          const val = BigInt.asIntN(128, Integer.size(IntegerExt.from_int_ty(this.tcx_, ity)).sign_extend(bits));
          if (val < 0n) {
            this.push("n");
          }
          // `val.unsigned_abs()`
          bits = val < 0n ? -val : val;
        }

        this.out += `${bits.toString(16)}_`;
        break;
      }

      // Handle `str` as partial support for unsized constants
      case "Str": {
        const tcx = this.tcx();
        // HACK(jaic1): hide the `str` type behind a reference
        // for the following transformation from valtree to raw bytes
        const ref_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_static, ct_ty);
        const cv: Value = { ty: ref_ty, valtree };
        const slice =
          Value.try_to_raw_bytes(cv, tcx) ?? bug(`expected to get raw bytes from valtree ${debug_ValTree(valtree, PLAIN)} for type ${display_Ty(ct_ty)}`);
        const s = from_utf8(slice);
        if (s.$ === "Err") return panic("non utf8 str from MIR interpreter");

        // "e" for str as a basic type
        this.push("e");

        // FIXME(eddyb) use a specialized hex-encoding loop.
        for (const byte of slice) {
          this.out += byte.toString(16).padStart(2, "0");
        }

        this.push("_");
        break;
      }

      // FIXME(valtrees): Remove the special case for `str`
      // here and fully support unsized constants.
      case "Ref": {
        const mutbl = ck._2;
        this.push(mutbl === "Not" ? "R" : "Q");

        const pointee_ty = ct_ty.builtin_deref(true) ?? panic("tried to dereference on non-ptr type");
        const dereferenced_const = Const.new_value(this.tcx_, valtree, pointee_ty);
        if ((r = print_Const(dereferenced_const, this)).$ === "Err") return r;
        break;
      }

      case "Array":
      case "Tuple":
      case "Slice": {
        const fields = Value.to_branch(cv);

        const print_field_list = (this_: this): PrintResult => {
          let r: PrintResult;
          for (const field of fields) {
            if ((r = print_Const(field, this_)).$ === "Err") return r;
          }
          this_.push("E");
          return PRINT_OK;
        };

        switch (ck.$) {
          case "Array":
          case "Slice":
            this.push("A");
            if ((r = print_field_list(this)).$ === "Err") return r;
            break;
          case "Tuple":
            this.push("T");
            if ((r = print_field_list(this)).$ === "Err") return r;
            break;
        }
        break;
      }
      case "Adt": {
        const [def, args] = [ck._0, ck._1];
        const contents = Value.destructure_adt_const(cv);
        const fields = contents.fields;

        const print_field_list = (this_: this): PrintResult => {
          let r: PrintResult;
          for (const field of fields) {
            if ((r = print_Const(field, this_)).$ === "Err") return r;
          }
          this_.push("E");
          return PRINT_OK;
        };

        const variant_idx = contents.variant;
        const variant_def = def.variant(variant_idx);

        this.push("V");
        if ((r = this.print_def_path(variant_def.def_id, args)).$ === "Err") return r;

        const ctor_kind = variant_def.ctor_kind();
        if (ctor_kind === "Const") {
          this.push("U");
        } else if (ctor_kind === "Fn") {
          this.push("T");
          if ((r = print_field_list(this)).$ === "Err") return r;
        } else {
          this.push("S");
          // `iter::zip(&variant_def.fields, fields)` stops at the shorter one.
          const n = Math.min(variant_def.fields.length, fields.length);
          for (let i = 0; i < n; i++) {
            const field_def = variant_def.fields[i]!;
            const field = fields[i]!;
            // HACK(eddyb) this mimics `print_path_with_simple`,
            // instead of simply using `field_def.ident`,
            // just to be able to handle disambiguators.
            const disambiguated_field = this.tcx_.def_key(field_def.did).disambiguated_data;
            const field_name = DefPathDataC.get_opt_name(disambiguated_field.data);
            this.push_disambiguator(BigInt(disambiguated_field.disambiguator));
            this.push_ident(Symbol.as_str(unwrap(field_name)));

            if ((r = print_Const(field, this)).$ === "Err") return r;
          }
          this.push("E");
        }
        break;
      }
      default:
        return bug(`symbol_names: unsupported constant of type \`${display_Ty(ct_ty)}\` (${debug_Const(ct, PLAIN)})`);
    }

    // Only cache consts that do not refer to an enclosing
    // binder (which would change depending on context).
    if (!TypeVisitableExt.has_escaping_bound_vars(ct, fold_Const)) {
      this.consts.set(ct, start);
    }
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:913 print_crate_name
  print_crate_name(cnum: CrateNum): PrintResult {
    this.push("C");
    if (!this.is_exportable) {
      const stable_crate_id = this.tcx_.stable_crate_id(cnum);
      this.push_disambiguator(StableCrateId.as_u64(stable_crate_id));
    }
    const name = this.tcx_.crate_name(cnum);
    this.push_ident(Symbol.as_str(name));
    return PRINT_OK;
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:924 print_path_with_qualified
  print_path_with_qualified(self_ty: Ty, trait_ref_: TraitRef | undefined): PrintResult {
    let r: PrintResult;
    assert(trait_ref_ !== undefined, "assertion failed: trait_ref.is_some()");
    const trait_ref = trait_ref_;

    this.push("Y");
    if ((r = print_Ty(self_ty, this)).$ === "Err") return r;
    return this.print_def_path(trait_ref.def_id, trait_ref.args);
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:937 print_path_with_impl
  print_path_with_impl(_print_prefix: (p: this) => PrintResult, _self_ty: Ty, _trait_ref: TraitRef | undefined): PrintResult {
    // Inlined into `print_impl_path`
    return unreachable();
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:947 print_path_with_simple
  print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult {
    const data: DefPathData = disambiguated_data.data;
    let ns: string;
    switch (data.$) {
      // Extern block segments can be skipped, names from extern blocks
      // are effectively living in their parent modules.
      case "ForeignMod":
        return print_prefix(this);

      // Uppercase categories are more stable than lowercase ones.
      case "TypeNs":
        ns = "t";
        break;
      case "ValueNs":
        ns = "v";
        break;
      case "Closure":
        ns = "C";
        break;
      case "Ctor":
        ns = "c";
        break;
      case "AnonConst":
        ns = "K";
        break;
      case "OpaqueTy":
        ns = "i";
        break;
      case "SyntheticCoroutineBody":
        ns = "s";
        break;
      case "NestedStatic":
        ns = "n";
        break;
      case "GlobalAsm":
        ns = "a";
        break;

      // These should never show up as `print_path_with_simple` arguments.
      case "CrateRoot":
      case "Use":
      case "Impl":
      case "MacroNs":
      case "LifetimeNs":
      case "OpaqueLifetime":
      case "AnonAssocTy":
      case "TestBinderConstraints":
        return bug(`symbol_names: unexpected DefPathData: ${debug_DefPathData(data, PLAIN)}`);
    }

    const name = DefPathDataC.get_opt_name(data);

    return this.path_append_ns(print_prefix, ns, BigInt(disambiguated_data.disambiguator), Symbol.as_str(name ?? sym.empty));
  }

  // rustc: compiler/rustc_symbol_mangling/src/v0.rs:991 print_path_with_generic_args
  print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args_: readonly GenericArg[]): PrintResult {
    let r: PrintResult;
    // Don't print any regions if they're all erased.
    const print_regions = args_.some((arg) => {
      const k = GenericArgC.kind(arg);
      return k.$ === "Lifetime" ? !k._0.is_erased() : false;
    });
    const args = args_.filter((arg) => (GenericArgC.kind(arg).$ === "Lifetime" ? print_regions : true));

    if (args.length === 0) {
      return print_prefix(this);
    }

    this.push("I");
    if ((r = print_prefix(this)).$ === "Err") return r;
    for (const arg of args) {
      const k = GenericArgC.kind(arg);
      switch (k.$) {
        case "Lifetime": {
          if ((r = print_Region(k._0, this)).$ === "Err") return r;
          break;
        }
        case "Type": {
          if ((r = print_Ty(k._0, this)).$ === "Err") return r;
          break;
        }
        case "Const": {
          this.push("K");
          if ((r = print_Const(k._0, this)).$ === "Err") return r;
          break;
        }
      }
    }
    this.push("E");

    return PRINT_OK;
  }
}

/** `&args[..n] == other.as_slice()`: slices of interned args compare element-wise by identity. */
function slice_eq(a: readonly GenericArg[], b: readonly GenericArg[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/// Push a `_`-terminated base 62 integer, using the format
/// specified in the RFC as `<base-62-number>`, that is:
/// * `x = 0` is encoded as just the `"_"` terminator
/// * `x > 0` is encoded as `x - 1` in base 62, followed by `"_"`,
///   e.g. `1` becomes `"0_"`, `62` becomes `"Z_"`, etc.
// rustc: compiler/rustc_symbol_mangling/src/v0.rs:1036 push_integer_62
export function push_integer_62(x: bigint, output: { value: string }): void {
  // `x.checked_sub(1)`
  if (x >= 1n) {
    output.value += to_base(x - 1n, 62).as_str();
  }
  output.value += "_";
}

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:1043 encode_integer_62
export function encode_integer_62(x: bigint): string {
  const output = { value: "" };
  push_integer_62(x, output);
  return output.value;
}

// rustc: compiler/rustc_symbol_mangling/src/v0.rs:1049 push_ident
export function push_ident(ident_: string, output: { value: string }): void {
  let use_punycode = false;
  const bytes = new TextEncoder().encode(ident_);
  for (const b of bytes) {
    if (b === 0x5f /* _ */ || (b >= 0x61 && b <= 0x7a) || (b >= 0x41 && b <= 0x5a) || (b >= 0x30 && b <= 0x39)) {
      // ok
    } else if (b >= 0x80) {
      use_punycode = true;
    } else {
      return bug(`symbol_names: bad byte ${b} in ident ${JSON.stringify(ident_)}`);
    }
  }

  let ident: string;
  if (use_punycode) {
    output.value += "u";

    // FIXME(eddyb) we should probably roll our own punycode implementation.
    const enc = punycode_encode(ident_);
    if (enc.$ === "Err") {
      return bug(`symbol_names: punycode encoding failed for ident ${JSON.stringify(ident_)}`);
    }
    let punycode_string = enc._0;

    // Replace `-` with `_`.
    const idx = punycode_string.lastIndexOf("-");
    if (idx !== -1) {
      punycode_string = punycode_string.slice(0, idx) + "_" + punycode_string.slice(idx + 1);
    }

    // FIXME(eddyb) avoid rechecking UTF-8 validity.
    ident = punycode_string;
  } else {
    ident = ident_;
  }

  // PORT: `ident` is ASCII here (checked above / punycode output), so `len()` is `.length`.
  output.value += `${ident.length}`;

  // Write a separating `_` if necessary (leading digit or `_`).
  const c = ident.charCodeAt(0);
  if (c === 0x5f || (c >= 0x30 && c <= 0x39)) {
    output.value += "_";
  }

  output.value += ident;
}
