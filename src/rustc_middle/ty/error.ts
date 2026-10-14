// Port of compiler/rustc_middle/src/ty/error.rs (lane ty-results, sub-lane ty-results-b; contract stub by lane
// ty-contract).
//
// The `Ty` / `TyCtxt` methods are declared in ty/decls.ts (`// ty/error.rs:<line>`) and assigned to the prototypes
// here. Extension module (docs/handoff/ty-contract.md "Init order"): rustc_middle/lib.ts loads it after the classes;
// its top-level code touches only `Ty.prototype` / `TyCtxt.prototype`.
// PORT: `pub type TypeError<'tcx> = rustc_type_ir::error::TypeError<TyCtxt<'tcx>>` is rustc_type_ir's `TypeError`
// (`I` erased); `pub use rustc_type_ir::error::ExpectedFound` is the re-export below.
// PORT: `Cow<'static, str>` results are `string`.
// PORT: the extension trait `#[extension(pub trait TypeErrorToStringExt)]` is the free fn `TypeError_to_string`
// (lane ty-print-b decision 6: `<SelfType>_<method>`).
// PORT (D4): `T: Print<FmtPrinter>` is the `Print<T>` descriptor `d_T`, last (decls.ts signatures).
// PORT: print/pretty.ts is imported before print/mod.ts (print/mod.ts header: entering mod.ts first is a TDZ error).
// PORT: ./context.ts is imported first so that this module also loads as an entry point (init order).
import { TyCtxt } from "./context.ts";
import { display_List_PolyExistentialPredicate, display_ParamTy, FmtPrinter, with_forced_trimmed_paths } from "./print/pretty.ts";
import { type Print, type PrintError, print_Ty } from "./print/mod.ts";
import { display_ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { pluralize } from "../../rustc_errors/lib.ts";
import { Namespace } from "../../rustc_hir/def.ts";
import { type CoroutineKind, display_CoroutineKind, display_Safety } from "../../rustc_hir/hir.ts";
import { Limit } from "../../rustc_structures/limit.ts";
import type { TypeError } from "../../rustc_type_ir/error.ts";
import { display_Const } from "../../rustc_type_ir/ir_print.ts";
import { display_ClausePolarity, PolyExistentialTraitRef } from "../../rustc_type_ir/predicate.ts";
import type { AliasTermKind } from "../../rustc_type_ir/term_kind.ts";
import type { Debug } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { unported, unwrap } from "../../std/panic.ts";
import { expect_result } from "../../std/result.ts";
import { utf8_len } from "../../std/str.ts";
import type { AdtDef } from "./decls.ts";
import { Ty } from "./mod.ts";

export type { ExpectedFound } from "../../rustc_type_ir/error.ts";
export type { TypeError } from "../../rustc_type_ir/error.ts";

// A naive approach to making sure that we're not reporting silly errors such as:
// (expected closure, found closure).
// rustc: compiler/rustc_middle/src/ty/error.rs:27 report_maybe_different
function report_maybe_different(expected: string, found: string): string {
  if (expected === found) {
    return `expected ${expected}, found a different ${found}`;
  } else {
    return `expected ${expected}, found ${found}`;
  }
}

/// Explains the source of a type err in a short, human readable way.
/// This is meant to be placed in parentheses after some larger message.
/// You should also invoke `note_and_explain_type_err()` afterwards
/// to present additional details, particularly when it comes to lifetime-
/// related errors.
// rustc: compiler/rustc_middle/src/ty/error.rs:26 to_string
export function TypeError_to_string(self: TypeError, tcx: TyCtxt): string {
  switch (self.$) {
    case "CyclicTy":
      return "recursive type with infinite-size name";
    case "CyclicConst":
      return "encountered a self-referencing constant";
    case "Mismatch":
      return "types differ";
    case "PolarityMismatch": {
      const values = self._0;
      return `expected ${display_ClausePolarity(values.expected)} polarity, found ${display_ClausePolarity(values.found)} polarity`;
    }
    case "SafetyMismatch": {
      const values = self._0;
      return `expected ${display_Safety(values.expected)} fn, found ${display_Safety(values.found)} fn`;
    }
    case "AbiMismatch": {
      const values = self._0;
      return `expected ${display_ExternAbi(values.expected)} fn, found ${display_ExternAbi(values.found)} fn`;
    }
    case "ArgumentMutability":
    case "Mutability":
      return "types differ in mutability";
    case "TupleSize": {
      const values = self._0;
      return `expected a tuple with ${values.expected} element${pluralize(values.expected)}, found one with ${values.found} element${pluralize(values.found)}`;
    }
    case "ArraySize": {
      const values = self._0;
      return `expected an array with a size of ${display_Const(values.expected)}, found one with a size of ${display_Const(values.found)}`;
    }
    case "ArgCount":
      return "incorrect number of function parameters";
    case "RegionsDoesNotOutlive":
      return "lifetime mismatch";
    // Actually naming the region here is a bit confusing because context is lacking
    case "RegionsInsufficientlyPolymorphic":
      return "one type is more general than the other";
    case "RegionsPlaceholderMismatch":
      return "one type is more general than the other";
    case "ArgumentSorts":
    case "Sorts": {
      const values = self._0;
      const expected = values.expected.sort_string(tcx);
      const found = values.found.sort_string(tcx);
      return report_maybe_different(expected, found);
    }
    case "Traits": {
      const values = self._0;
      let [expected, found] = with_forced_trimmed_paths((): [string, string] => [
        tcx.def_path_str(values.expected),
        tcx.def_path_str(values.found),
      ]);
      if (expected === found) {
        expected = tcx.def_path_str(values.expected);
        found = tcx.def_path_str(values.found);
      }
      return report_maybe_different(`trait \`${expected}\``, `trait \`${found}\``);
    }
    case "VariadicMismatch": {
      const values = self._0;
      return `expected ${values.expected ? "variadic" : "non-variadic"} fn, found ${values.found ? "variadic" : "non-variadic"} function`;
    }
    case "SplatMismatch": {
      const values = self._0;
      const expected_index = values.expected;
      const found_index = values.found;
      return `expected fn with ${expected_index !== undefined ? `arg ${expected_index} splatted` : "no splatted arg"}, found fn with ${found_index !== undefined ? `arg ${found_index} splatted` : "no splatted arg"}`;
    }
    case "ProjectionMismatched": {
      const values = self._0;
      return `expected \`${tcx.alias_term_kind_def_path_str(values.expected)}\`, found \`${tcx.alias_term_kind_def_path_str(values.found)}\``;
    }
    case "ExistentialMismatch": {
      const values = self._0;
      return report_maybe_different(
        `trait \`${display_List_PolyExistentialPredicate(values.expected)}\``,
        `trait \`${display_List_PolyExistentialPredicate(values.found)}\``,
      );
    }
    case "ConstMismatch": {
      const values = self._0;
      return `expected \`${display_Const(values.expected)}\`, found \`${display_Const(values.found)}\``;
    }
    case "ForceInlineCast":
      return "cannot coerce functions which must be inlined to function pointers";
    case "IntrinsicCast":
      return "cannot coerce intrinsics to function pointers";
    case "TargetFeatureCast":
      return "cannot coerce functions with `#[target_feature(..)]` to safe function pointers";
  }
}

// rustc: compiler/rustc_middle/src/ty/error.rs:140 sort_string
Ty.prototype.sort_string = function (this: Ty, tcx: TyCtxt): string {
  const k = this.kind();
  switch (k.$) {
    case "Foreign":
      return `extern type \`${tcx.def_path_str(k._0)}\``;
    case "FnDef": {
      const def_kind = tcx.def_kind(k._0);
      if (def_kind.$ === "Ctor" && def_kind._0 === "Struct") {
        return "struct constructor";
      } else if (def_kind.$ === "Ctor" && def_kind._0 === "Variant") {
        return "enum constructor";
      } else {
        return "fn item";
      }
    }
    case "FnPtr":
      return "fn pointer";
    case "Dynamic": {
      const principal = k._0.principal();
      if (principal !== undefined) {
        return `\`dyn ${tcx.def_path_str(PolyExistentialTraitRef.def_id(principal))}\``;
      }
      return "trait object";
    }
    case "Closure":
      return "closure";
    case "Coroutine":
      // PORT: the `coroutine_kind` query's value is typed `unknown` in queries.gen.ts; it is `Option<hir::CoroutineKind>`.
      return display_CoroutineKind(unwrap(tcx.coroutine_kind(k._0) as CoroutineKind | undefined), true);
    case "CoroutineWitness":
      return "coroutine witness";
    case "Infer":
      switch (k._0.$) {
        case "TyVar":
          return "inferred type";
        case "IntVar":
          return "integer";
        case "FloatVar":
          return "floating-point number";
        case "FreshTy":
          return "fresh type";
        case "FreshIntTy":
          return "fresh integral type";
        case "FreshFloatTy":
          return "fresh floating-point type";
      }
    // falls through (unreachable: the inner `match` is exhaustive)
    case "Placeholder":
      return "placeholder type";
    case "Bound":
      return "bound type";
    case "Alias": {
      const kind = k._1.kind;
      if (kind.$ === "Projection" || kind.$ === "Inherent") {
        return "associated type";
      }
      if (kind.$ === "Opaque") {
        if (tcx.ty_is_opaque_future(this)) {
          return "future";
        } else {
          return "opaque type";
        }
      }
      break;
    }
    case "Param":
      return `type parameter \`${display_ParamTy(k._0)}\``;
    case "Error":
      return "type error";
    default:
      break;
  }
  const width = tcx.sess.diagnostic_width();
  const length_limit = Math.max(Math.floor(width / 4), 40);
  return `\`${tcx.string_with_limit(this, length_limit, Namespace.TypeNS, print_Ty)}\``;
};

// rustc: compiler/rustc_middle/src/ty/error.rs:186 prefix_string
Ty.prototype.prefix_string = function (this: Ty, tcx: TyCtxt): string {
  const k = this.kind();
  switch (k.$) {
    case "Infer":
    case "Error":
    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Float":
    case "Str":
    case "Never":
      return "type";
    case "Tuple":
      if (k._0.length === 0) {
        return "unit type";
      }
      return "tuple";
    case "Adt":
      return AdtDef_descr(k._0);
    case "Foreign":
      return "extern type";
    case "Array":
      return "array";
    case "Pat":
      return "pattern type";
    case "Slice":
      return "slice";
    case "RawPtr":
      return "raw pointer";
    case "Ref":
      switch (k._2) {
        case "Mut":
          return "mutable reference";
        default:
          return "reference";
      }
    case "FnDef": {
      const def_kind = tcx.def_kind(k._0);
      if (def_kind.$ === "Ctor" && def_kind._0 === "Struct") {
        return "struct constructor";
      } else if (def_kind.$ === "Ctor" && def_kind._0 === "Variant") {
        return "enum constructor";
      } else {
        return "fn item";
      }
    }
    case "FnPtr":
      return "fn pointer";
    case "UnsafeBinder":
      return "unsafe binder";
    case "Dynamic":
      return "trait object";
    case "Closure":
    case "CoroutineClosure":
      return "closure";
    case "Coroutine":
      // PORT: `coroutine_kind`'s value is typed `unknown` in queries.gen.ts (see `sort_string`).
      return display_CoroutineKind(unwrap(tcx.coroutine_kind(k._0) as CoroutineKind | undefined), true);
    case "CoroutineWitness":
      return "coroutine witness";
    case "Placeholder":
      return "higher-ranked type";
    case "Bound":
      return "bound type variable";
    case "Alias":
      switch (k._1.kind.$) {
        case "Projection":
        case "Inherent":
          return "associated type";
        case "Free":
          return "type alias";
        case "Opaque":
          return "opaque type";
      }
    // falls through (unreachable: the inner `match` is exhaustive)
    case "Param":
      return "type parameter";
  }
};

/** `derive(Debug)` of `std::fmt::Error` (a unit struct): `Error`. */
const debug_PrintError: Debug<PrintError> = () => "Error";

// rustc: compiler/rustc_middle/src/ty/error.rs:236 string_with_limit
TyCtxt.prototype.string_with_limit = function <T>(this: TyCtxt, t: T, length_limit: number, ns: Namespace, d_T: Print<T>): string {
  let type_limit = 50;
  const regular = expect_result(
    FmtPrinter.print_string(this, ns, (p) => d_T(t, p)),
    "could not write to `String`",
    debug_PrintError,
  );
  if (utf8_len(regular) <= length_limit) {
    return regular;
  }
  let short: string;
  for (;;) {
    // Look for the longest properly trimmed path that still fits in length_limit.
    short = with_forced_trimmed_paths(() => {
      const p = FmtPrinter.new_with_limit(this, ns, new Limit(type_limit));
      expect_result(d_T(t, p), "could not print type", debug_PrintError);
      return p.into_buffer();
    });
    if (utf8_len(short) <= length_limit || type_limit === 0) {
      break;
    }
    type_limit -= 1;
  }
  return short;
};

/// When calling this after a `Diag` is constructed, the preferred way of doing so is
/// `tcx.short_string(ty, diag.long_ty_path())`. The diagnostic itself is the one that keeps
/// the existence of a "long type" anywhere in the diagnostic, so the note telling the user
/// where we wrote the file to is only printed once. The path will use the type namespace.
// rustc: compiler/rustc_middle/src/ty/error.rs:266 short_string
TyCtxt.prototype.short_string = function <T>(this: TyCtxt, t: T, path: MutRef<string | undefined>, d_T: Print<T>): string {
  return this.short_string_namespace(t, path, Namespace.TypeNS, d_T);
};

/// When calling this after a `Diag` is constructed, the preferred way of doing so is
/// `tcx.short_string(ty, diag.long_ty_path())`. The diagnostic itself is the one that keeps
/// the existence of a "long type" anywhere in the diagnostic, so the note telling the user
/// where we wrote the file to is only printed once.
// rustc: compiler/rustc_middle/src/ty/error.rs:277 short_string_namespace
TyCtxt.prototype.short_string_namespace = function <T>(this: TyCtxt, t: T, path: MutRef<string | undefined>, namespace: Namespace, d_T: Print<T>): string {
  const regular = expect_result(
    FmtPrinter.print_string(this, namespace, (p) => d_T(t, p)),
    "could not write to `String`",
    debug_PrintError,
  );

  if (!this.sess.opts.unstable_opts.write_long_types_to_disk || this.sess.opts.verbose) {
    return regular;
  }

  const width = this.sess.diagnostic_width();
  const length_limit = Math.floor(width / 2);
  if (utf8_len(regular) <= Math.floor((width * 2) / 3)) {
    return regular;
  }
  const short = this.string_with_limit(t, length_limit, namespace, d_T);
  if (regular === short) {
    return regular;
  }
  // Ensure we create an unique file for the type passed in when we create a file.
  // PORT: the file name hashes `t` with `DefaultHasher` through its `Hash` impl, which for the interned type-system
  // values hashes their address (not reproducible), and the rest writes the type to that file (`File` I/O, not in
  // src/std). Upstream continues:
  //   let mut s = DefaultHasher::new(); t.hash(&mut s); let hash = s.finish();
  //   *path = Some(path.take().unwrap_or_else(|| {
  //       self.output_filenames(()).temp_path_for_diagnostic(&format!("long-type-{hash}.txt"))
  //   }));
  //   let Ok(mut file) = File::options().create(true).read(true).append(true).open(&path.as_ref().unwrap())
  //   else { return regular; };
  //   // Do not write the same type to the file multiple times.
  //   let mut contents = String::new(); let _ = file.read_to_string(&mut contents);
  //   if let Some(_) = contents.lines().find(|line| line == &regular) { return short; }
  //   match write!(file, "{regular}\n") { Ok(_) => short, Err(_) => regular }
  void path;
  return unported("rustc_middle::ty::error::TyCtxt::short_string_namespace: long-type file (`Hash` of `T` into `DefaultHasher`, `File` I/O)");
};

// rustc: compiler/rustc_middle/src/ty/error.rs:328 alias_term_kind_def_path_str
TyCtxt.prototype.alias_term_kind_def_path_str = function (this: TyCtxt, alias: AliasTermKind): string {
  switch (alias.$) {
    case "ProjectionTy":
    case "InherentTy":
    case "OpaqueTy":
    case "FreeTy":
    case "AnonConst":
    case "ProjectionConst":
    case "FreeConst":
    case "InherentConstSelf":
    case "InherentConstImpl":
      return this.def_path_str(alias.def_id);
  }
};

// ---- PORT(stand-in): upstream fns of files not ported yet that this file calls. ----

/** `AdtDef::descr` (ty/adt.rs; `AdtDef` is `Pending`). */
function AdtDef_descr(_self: AdtDef): string {
  return unported("rustc_middle::ty::adt::AdtDef::descr (ty/adt.rs)");
}
