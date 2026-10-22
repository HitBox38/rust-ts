// Port of compiler/rustc_symbol_mangling/src/export.rs (lane symbol-mangling).
//
// PORT: `trait AbiStableHash` is one function per implementing type, `abi_stable_hash_<T>(self, tcx, hasher)`;
// the generic `[T]` impl takes the element's function. `::std::hash::Hash::hash(self, hasher)` of the integer
// types is the hasher's `write_u8` / `write_u64` / `write_usize` (std's `Hash` impls of the primitives).
import { FloatTy, IntTy, UintTy } from "../rustc_ast_ir/lib.ts";
import { Integer } from "../rustc_abi/lib.ts";
import { StableHasher } from "../rustc_data_structures/stable_hash.ts";
import { Hash128 } from "../rustc_hashes/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Instance, Instance as InstanceC } from "../rustc_middle/ty/instance.ts";
import { type GenericArg, GenericArg as GenericArgC, type GenericArgKind } from "../rustc_middle/ty/generic_args.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { type Symbol, Symbol as SymbolC, sym } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { fold_Binder } from "../rustc_type_ir/binder.ts";
import { type FnSig, FnSig as FnSigC, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { panic, unreachable } from "../std/panic.ts";

// trait AbiStableHash<'tcx> {
//     fn abi_stable_hash(&self, tcx: TyCtxt<'tcx>, hasher: &mut StableHasher);
// }
// rustc: compiler/rustc_symbol_mangling/src/export.rs:11 abi_stable_hash
type AbiStableHash<T> = (self: T, tcx: TyCtxt, hasher: StableHasher) => void;

// macro_rules! default_hash_impl { ... }
// default_hash_impl! { u8, u64, usize, }
// rustc: compiler/rustc_symbol_mangling/src/export.rs:17 abi_stable_hash
/** `default_hash_impl!` for `u8`: `Hash::hash(self, hasher)`. */
function abi_stable_hash_u8(self: number, _tcx: TyCtxt, hasher: StableHasher): void {
  hasher.write_u8(self);
}
/** `default_hash_impl!` for `u64` (export.rs:17). */
function abi_stable_hash_u64(self: bigint, _tcx: TyCtxt, hasher: StableHasher): void {
  hasher.write_u64(self);
}
/** `default_hash_impl!` for `usize` (export.rs:17). */
function abi_stable_hash_usize(self: number, _tcx: TyCtxt, hasher: StableHasher): void {
  hasher.write_usize(self);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:28 abi_stable_hash
function abi_stable_hash_bool(self: boolean, tcx: TyCtxt, hasher: StableHasher): void {
  abi_stable_hash_u8(self ? 1 : 0, tcx, hasher);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:35 abi_stable_hash
function abi_stable_hash_str(self: string, tcx: TyCtxt, hasher: StableHasher): void {
  abi_stable_hash_slice(new TextEncoder().encode(self), tcx, hasher, abi_stable_hash_u8);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:42 abi_stable_hash
function abi_stable_hash_Symbol(self: Symbol, tcx: TyCtxt, hasher: StableHasher): void {
  abi_stable_hash_str(SymbolC.as_str(self), tcx, hasher);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:48 abi_stable_hash
function abi_stable_hash_slice<T>(self: ArrayLike<T> & Iterable<T>, tcx: TyCtxt, hasher: StableHasher, abi_stable_hash_T: AbiStableHash<T>): void {
  abi_stable_hash_usize(self.length, tcx, hasher);
  for (const item of self) {
    abi_stable_hash_T(item, tcx, hasher);
  }
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:57 abi_stable_hash
function abi_stable_hash_Ty(self: Ty, tcx: TyCtxt, hasher: StableHasher): void {
  const kind = self.kind();
  switch (kind.$) {
    case "Bool":
      abi_stable_hash_Symbol(sym.bool, tcx, hasher);
      break;
    case "Char":
      abi_stable_hash_Symbol(sym.char, tcx, hasher);
      break;
    case "Int":
      abi_stable_hash_str(IntTy.name_str(kind._0), tcx, hasher);
      break;
    case "Uint":
      abi_stable_hash_str(UintTy.name_str(kind._0), tcx, hasher);
      break;
    case "Float":
      abi_stable_hash_str(FloatTy.name_str(kind._0), tcx, hasher);
      break;

    case "Adt": {
      const [adt_def, args] = [kind._0, kind._1];
      abi_stable_hash_bool(adt_def.is_struct(), tcx, hasher);
      abi_stable_hash_bool(adt_def.is_enum(), tcx, hasher);
      abi_stable_hash_bool(adt_def.is_union(), tcx, hasher);

      const align = adt_def.repr().align;
      if (align !== undefined) {
        abi_stable_hash_u64(BigInt(align.bits()), tcx, hasher);
      }

      const integer = adt_def.repr().int;
      if (integer !== undefined) {
        switch (integer.$) {
          case "Pointer": {
            const sign = integer._0;
            abi_stable_hash_bool(sign, tcx, hasher);
            break;
          }
          case "Fixed": {
            const [integer_, sign] = [integer._0, integer._1];
            abi_stable_hash_str(Integer.int_ty_str(integer_), tcx, hasher);
            abi_stable_hash_bool(sign, tcx, hasher);
            break;
          }
        }
      }

      const pack = adt_def.repr().pack;
      if (pack !== undefined) {
        abi_stable_hash_u64(BigInt(pack.bits()), tcx, hasher);
      }

      abi_stable_hash_bool(adt_def.repr().c(), tcx, hasher);

      for (const variant of adt_def.variants()) {
        abi_stable_hash_Symbol(variant.name, tcx, hasher);
        for (const field of variant.fields) {
          abi_stable_hash_Symbol(field.name, tcx, hasher);
          // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
          const field_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(field.did) as EarlyBinder<Ty>));
          abi_stable_hash_Ty(field_ty, tcx, hasher);
        }
      }
      abi_stable_hash_slice(args, tcx, hasher, abi_stable_hash_GenericArg);
      break;
    }

    case "Tuple":
      if (kind._0.length === 0) {
        break;
      }
      return unreachable();

    // FIXME: Not yet supported.
    case "Foreign":
    case "Ref":
    case "Str":
    case "Array":
    case "Pat":
    case "Slice":
    case "RawPtr":
    case "FnDef":
    case "FnPtr":
    case "Dynamic":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Never":
    case "Alias":
    case "Param":
    case "Bound":
    case "Placeholder":
    case "Infer":
    case "UnsafeBinder":
      return unreachable();

    case "Error":
      break;
  }
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:134 abi_stable_hash
function abi_stable_hash_FnSig(self: FnSig, tcx: TyCtxt, hasher: StableHasher): void {
  for (const ty of self.inputs_and_output) {
    abi_stable_hash_Ty(ty, tcx, hasher);
  }
  abi_stable_hash_bool(FnSigC.safety(self) === "Safe", tcx, hasher);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:143 abi_stable_hash
function abi_stable_hash_GenericArg(self: GenericArg, tcx: TyCtxt, hasher: StableHasher): void {
  abi_stable_hash_GenericArgKind(GenericArgC.kind(self), tcx, hasher);
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:149 abi_stable_hash
function abi_stable_hash_GenericArgKind(self: GenericArgKind, tcx: TyCtxt, hasher: StableHasher): void {
  switch (self.$) {
    case "Type":
      abi_stable_hash_Ty(self._0, tcx, hasher);
      break;
    case "Lifetime":
    case "Const":
      return panic("not implemented");
  }
}

// rustc: compiler/rustc_symbol_mangling/src/export.rs:157 compute_hash_of_export_fn
export function compute_hash_of_export_fn(tcx: TyCtxt, instance: Instance): string {
  const def_id = InstanceC.def_id(instance);
  // debug_assert_matches!(tcx.def_kind(def_id), DefKind::Fn | DefKind::AssocFn);

  const args = instance.args;
  // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts.
  const sig_ty_ = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, args, fold_Binder(fold_FnSig)));
  const sig_ty = tcx.instantiate_bound_regions_with_erased(sig_ty_, fold_FnSig);

  const hasher = StableHasher.new();
  abi_stable_hash_FnSig(sig_ty, tcx, hasher);
  const hash = hasher.finish(Hash128);

  return Hash128.as_u128(hash).toString();
}
