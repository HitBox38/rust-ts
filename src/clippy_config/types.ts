// rust-ts port of src/tools/clippy/clippy_config/src/types.rs.
//
// PORT: trait impls are tables named as in de.ts (`Deserialize_for_<Type>`, `FromDefault_for_<Type>` when the trait's
// parameter is the type itself, `FromDefault_unit_for_<Type>` / `DeserializeOrDefault_unit_for_<Type>` for `()`).

import {
  Deserialize_for_bool,
  DeValue,
  type Deserialize,
  Deserialize_for_Spanned,
  Deserialize_for_String,
  Deserialize_for_Vec,
  type DeserializeOrDefault,
  type DiagCtxt,
  type FromDefault,
  FromDefault_str_for_String,
  type TomlValue,
  create_value_list_msg,
  deserialize_table,
  find_closest_match,
} from "./de.ts";
import { Applicability, type Diag } from "../rustc_errors/lib.ts";
import { type PrimTy, PrimTy as PrimTy_ } from "../rustc_hir/hir.ts";
import { type DefKind } from "../rustc_hir/def.ts";
import { type TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Session } from "../rustc_session/session.ts";
import { type DefId, DefIdMap } from "../rustc_span/def_id.ts";
import { type Span, type Spanned, debug_Spanned } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { type Debug, type Fmt, debug_list, debug_str, debug_tuple } from "../std/fmt.ts";
import { unported } from "../std/panic.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { intern_key } from "../rust_ts/intern_key.ts";

// PORT: `clippy_utils::paths::{PathNS, find_crates, lookup_path}` belong to clippy-utils-a, which has not landed.
// `PathNS` is upstream's fieldless enum (clippy_utils/src/paths.rs:25) as PORTING's string union, and the two fns stop
// (`unported`); with clippy-utils-a this block becomes `import { PathNS, find_crates, lookup_path } from
// "../clippy_utils/paths.ts"`.
export type PathNS = "Type" | "Value" | "Macro" | "Field" | "Arbitrary";
function lookup_path(_tcx: TyCtxt, _ns: PathNS, _path: readonly Symbol[]): DefId[] {
  return unported("clippy_utils::paths::lookup_path (clippy-utils-a)");
}
function find_crates(_tcx: TyCtxt, _name: Symbol): readonly DefId[] {
  return unported("clippy_utils::paths::find_crates (clippy-utils-a)");
}

// PORT: `macro_rules! concat_expr` and `macro_rules! name_or_lit` are folded into `conf_enum` below.
//
// PORT: `macro_rules! conf_enum` (types.rs:32) → `conf_enum(rows)`, one call per invocation, over the rows
// `[$var_name, name_or_lit!($var_name $($var_lit)?)]` in order. The enum is PORTING's string union with a companion
// const; the inherent impl's `NAMES`, `COUNT`, `name` and `from_str` are spread into that companion, and the
// `FromDefault<$name>` and `Deserialize` impls are exported as `FromDefault_for_<$name>` and `Deserialize_for_<$name>`.
// The fns' markers sit on the macro's fn lines. `self as usize` is the row index.
function conf_enum<V extends string>(rows: readonly (readonly [V, string])[]) {
  const NAMES: readonly string[] = rows.map(([, lit]) => lit);
  // #[allow(dead_code)]
  const COUNT: number = rows.length;
  const index = new Map<V, number>(rows.map(([v], i) => [v, i]));
  const inherent = {
    NAMES,
    COUNT,
    // rustc: src/tools/clippy/clippy_config/src/types.rs:54 name
    name(self: V): string {
      return NAMES[index.get(self)!]!;
    },
    // #[allow(clippy::should_implement_trait)]
    // rustc: src/tools/clippy/clippy_config/src/types.rs:58 from_str
    from_str(s: string): V | undefined {
      for (const [v, lit] of rows) {
        if (s === lit) return v;
      }
      return undefined;
    },
  };
  const from_default: FromDefault<V, V> = {
    // rustc: src/tools/clippy/clippy_config/src/types.rs:66 from_default
    from_default(default_: V): V {
      return default_;
    },
    // rustc: src/tools/clippy/clippy_config/src/types.rs:69 display_default
    display_default(default_: V): string {
      return FromDefault_str_for_String.display_default(inherent.name(default_));
    },
  };
  const deserialize: Deserialize<V> = {
    // rustc: src/tools/clippy/clippy_config/src/types.rs:74 deserialize
    deserialize(dcx: DiagCtxt, value: TomlValue): V | undefined {
      const s = DeValue.as_str(value.get_ref());
      if (s === undefined) {
        dcx.span_err(value.span(), "expected a string");
        return undefined;
      }
      const x = inherent.from_str(s);
      if (x === undefined) {
        const sp = dcx.make_sp(value.span());
        const diag = dcx.inner.struct_span_err(
          sp,
          // concat_expr!("expected one of: " $("`" name_or_lit!(..) "`")", "*)
          "expected one of: " + NAMES.map((n) => "`" + n + "`").join(", "),
        );
        const sugg = find_closest_match(s, NAMES);
        if (sugg !== undefined) {
          diag.span_suggestion(sp, "did you mean", sugg, Applicability.MaybeIncorrect);
        }
        diag.note(create_value_list_msg(dcx, NAMES));
        diag.emit();
      }
      return x;
    },
  };
  return { inherent, from_default, deserialize };
}

export interface Rename {
  path: string;
  rename: string;
}

export const Deserialize_for_Rename: Deserialize<Rename> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:103 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): Rename | undefined {
    const table = DeValue.as_table(value.as_ref());
    if (table !== undefined) {
      const { path, rename } = deserialize_table<{ path: string; rename: string }>(dcx, table, {
        path: ["path", Deserialize_for_String],
        rename: ["rename", Deserialize_for_String],
      });
      if (path === undefined) {
        dcx.span_err(value.span(), "missing required field `path`");
        return undefined;
      }
      if (rename === undefined) {
        dcx.span_err(value.span(), "missing required field `rename`");
        return undefined;
      }
      return { path, rename };
    } else {
      dcx.span_err(value.span(), "expected a table");
      return undefined;
    }
  },
};

/** PORT: `DisallowedPath<false>`; the const parameter is erased (it only selects the `Deserialize` impl). */
export type DisallowedPathWithoutReplacement = DisallowedPath;

/** PORT: `DisallowedPath<const REPLACEMENT_ALLOWED: bool = true>`, the const parameter erased. The field `path` is
 *  `path_`: a JS class cannot have a field and a method (`path()`) of one name (as `SourceFile.lines_`). */
export class DisallowedPath {
  constructor(
    public path_: Spanned<string>,
    public reason: string | undefined,
    public replacement: string | undefined,
    /// Setting `allow_invalid` to true suppresses a warning if `path` does not refer to an existing
    /// definition.
    ///
    /// This could be useful when conditional compilation is used, or when a clippy.toml file is
    /// shared among multiple projects.
    public allow_invalid: boolean,
  ) {}

  // rustc: src/tools/clippy/clippy_config/src/types.rs:140 path
  path(): string {
    return this.path_.node;
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:144 diag_amendment
  diag_amendment(span: Span): (diag: Diag) => void {
    return (diag) => {
      if (this.replacement !== undefined) {
        diag.span_suggestion(span, this.reason ?? "use", this.replacement, Applicability.MachineApplicable);
      } else if (this.reason !== undefined) {
        diag.note(this.reason);
      }
    };
  }
}

/** `impl Deserialize for DisallowedPath<false>` */
export const Deserialize_for_DisallowedPath_false: Deserialize<DisallowedPath> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:161 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): DisallowedPath | undefined {
    const s = DeValue.as_str(value.as_ref());
    if (s !== undefined) {
      return new DisallowedPath({ node: s, span: dcx.make_sp(value.span()) }, undefined, undefined, false);
    }
    const table = DeValue.as_table(value.as_ref());
    if (table !== undefined) {
      const { path, reason, allow_invalid } = deserialize_table<{ path: Spanned<string>; reason: string; allow_invalid: boolean }>(
        dcx,
        table,
        {
          path: ["path", Deserialize_for_Spanned(Deserialize_for_String)],
          reason: ["reason", Deserialize_for_String],
          allow_invalid: ["allow-invalid", Deserialize_for_bool],
        },
      );
      if (path === undefined) {
        dcx.span_err(value.span(), "missing required field `path`");
        return undefined;
      }
      return new DisallowedPath(path, reason, undefined, allow_invalid ?? false);
    } else {
      dcx.span_err(value.span(), "expected either a string or an inline table");
      return undefined;
    }
  },
};

/** `impl Deserialize for DisallowedPath<true>` */
export const Deserialize_for_DisallowedPath_true: Deserialize<DisallowedPath> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:196 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): DisallowedPath | undefined {
    const s = DeValue.as_str(value.as_ref());
    if (s !== undefined) {
      return new DisallowedPath({ node: s, span: dcx.make_sp(value.span()) }, undefined, undefined, false);
    }
    const table = DeValue.as_table(value.as_ref());
    if (table !== undefined) {
      const { path, reason, replacement, allow_invalid } = deserialize_table<{
        path: Spanned<string>;
        reason: string;
        replacement: string;
        allow_invalid: boolean;
      }>(dcx, table, {
        path: ["path", Deserialize_for_Spanned(Deserialize_for_String)],
        reason: ["reason", Deserialize_for_String],
        replacement: ["replacement", Deserialize_for_String],
        allow_invalid: ["allow-invalid", Deserialize_for_bool],
      });
      if (path === undefined) {
        dcx.span_err(value.span(), "missing required field `path`");
        return undefined;
      }
      return new DisallowedPath(path, reason, replacement, allow_invalid ?? false);
    } else {
      dcx.span_err(value.span(), "expected either a string or an inline table");
      return undefined;
    }
  },
};

/// Creates a map of disallowed items to the reason they were disallowed.
// #[expect(clippy::type_complexity)]
// rustc: src/tools/clippy/clippy_config/src/types.rs:233 create_disallowed_map
export function create_disallowed_map(
  tcx: TyCtxt,
  disallowed_paths: readonly DisallowedPath[],
  ns: PathNS,
  def_kind_predicate: (kind: DefKind) => boolean,
  predicate_description: string,
  allow_prim_tys: boolean,
): [DefIdMap<[string, DisallowedPath]>, KeyedMap<PrimTy, [string, DisallowedPath]>] {
  const def_ids = new DefIdMap<[string, DisallowedPath]>();
  const prim_tys = new KeyedMap<PrimTy, [string, DisallowedPath]>(intern_key);
  for (const disallowed_path of disallowed_paths) {
    const path = disallowed_path.path_.node;
    const sym_path: Symbol[] = path.split("::").map((s) => Symbol.intern(s));
    let resolutions = lookup_path(tcx, ns, sym_path);
    resolutions = resolutions.filter((def_id) => def_kind_predicate(tcx.def_kind(def_id)));

    let prim_ty: PrimTy | undefined;
    let found_prim_ty: boolean;
    const prim = sym_path.length === 1 ? PrimTy_.from_name(sym_path[0]!) : undefined;
    if (prim !== undefined) {
      [prim_ty, found_prim_ty] = [allow_prim_tys ? prim : undefined, true];
    } else {
      [prim_ty, found_prim_ty] = [undefined, false];
    }

    if (
      resolutions.length === 0 &&
      prim_ty === undefined &&
      !disallowed_path.allow_invalid &&
      // Don't warn about unloaded crates:
      // https://github.com/rust-lang/rust-clippy/pull/14397#issuecomment-2848328221
      (sym_path.length < 2 || find_crates(tcx, sym_path[0]!).length !== 0)
    ) {
      // Relookup the path in an arbitrary namespace to get a good `expected, found` message
      const found_def_ids = lookup_path(tcx, "Arbitrary", sym_path);
      let message: string;
      const def_id = found_def_ids[0];
      if (def_id !== undefined) {
        const [article, description] = tcx.article_and_description(def_id);
        message = `expected a ${predicate_description}, found ${article} ${description}`;
      } else if (found_prim_ty) {
        message = `expected a ${predicate_description}, found a primitive type`;
      } else {
        message = `\`${path}\` does not refer to a reachable ${predicate_description}`;
      }
      tcx.sess
        .dcx()
        .struct_span_warn(disallowed_path.path_.span, message)
        .with_help("add `allow-invalid = true` to the entry to suppress this warning")
        .emit();
    }

    for (const def_id of resolutions) {
      def_ids.set(def_id, [path, disallowed_path]);
    }
    if (prim_ty !== undefined) {
      prim_tys.set(prim_ty, [path, disallowed_path]);
    }
  }

  return [def_ids, prim_tys];
}

// conf_enum! { #[derive(PartialEq, Eq)] pub MatchLintBehaviour { AllTypes, WellKnownTypes, Never, } }
export type MatchLintBehaviour = "AllTypes" | "WellKnownTypes" | "Never";
const MatchLintBehaviour_ = conf_enum<MatchLintBehaviour>([
  ["AllTypes", "AllTypes"],
  ["WellKnownTypes", "WellKnownTypes"],
  ["Never", "Never"],
]);
export const MatchLintBehaviour = {
  AllTypes: "AllTypes",
  WellKnownTypes: "WellKnownTypes",
  Never: "Never",
  ...MatchLintBehaviour_.inherent,
} as const;
export const FromDefault_for_MatchLintBehaviour = MatchLintBehaviour_.from_default;
export const Deserialize_for_MatchLintBehaviour = MatchLintBehaviour_.deserialize;

type BraceKind = "Brace" | "Bracket" | "Paren";

const Deserialize_for_BraceKind: Deserialize<BraceKind> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:312 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): BraceKind | undefined {
    let msg: string;
    const s = DeValue.as_str(value.as_ref());
    if (s !== undefined) {
      switch (s) {
        case "{":
        case "{}":
          return "Brace";
        case "[":
        case "[]":
          return "Bracket";
        case "(":
        case "()":
          return "Paren";
        default:
          msg = "unknown value";
      }
    } else {
      msg = "expected a string";
    }
    const diag = dcx.inner.struct_span_err(dcx.make_sp(value.span()), msg);
    diag.note("possible values: `()`, `[]`, `{}`");
    diag.emit();
    return undefined;
  },
};

export interface MacroMatcher {
  name: string;
  /** `(char, char)`: Unicode scalars */
  braces: [number, number];
}

export const Deserialize_for_MacroMatcher: Deserialize<MacroMatcher> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:336 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): MacroMatcher | undefined {
    const table = DeValue.as_table(value.as_ref());
    if (table !== undefined) {
      const { name, brace } = deserialize_table<{ name: string; brace: BraceKind }>(dcx, table, {
        name: ["name", Deserialize_for_String],
        brace: ["brace", Deserialize_for_BraceKind],
      });
      if (name === undefined) {
        dcx.span_err(value.span(), "missing required field `name`");
        return undefined;
      }
      if (brace === undefined) {
        dcx.span_err(value.span(), "missing required field `brace`");
        return undefined;
      }
      let braces: [number, number];
      switch (brace) {
        case "Brace":
          braces = [0x7b /* { */, 0x7d /* } */];
          break;
        case "Bracket":
          braces = [0x5b /* [ */, 0x5d /* ] */];
          break;
        case "Paren":
          braces = [0x28 /* ( */, 0x29 /* ) */];
          break;
      }
      return { name, braces };
    } else {
      dcx.span_err(value.span(), "expected an inline table");
      return undefined;
    }
  },
};

// conf_enum! { pub PubUnderscoreFieldsBehaviour { PubliclyExported, AllPubFields, } }
export type PubUnderscoreFieldsBehaviour = "PubliclyExported" | "AllPubFields";
const PubUnderscoreFieldsBehaviour_ = conf_enum<PubUnderscoreFieldsBehaviour>([
  ["PubliclyExported", "PubliclyExported"],
  ["AllPubFields", "AllPubFields"],
]);
export const PubUnderscoreFieldsBehaviour = {
  PubliclyExported: "PubliclyExported",
  AllPubFields: "AllPubFields",
  ...PubUnderscoreFieldsBehaviour_.inherent,
} as const;
export const FromDefault_for_PubUnderscoreFieldsBehaviour = PubUnderscoreFieldsBehaviour_.from_default;
export const Deserialize_for_PubUnderscoreFieldsBehaviour = PubUnderscoreFieldsBehaviour_.deserialize;

/// Represents the item categories that can be ordered by the source ordering lint.
// conf_enum! { #[derive(Debug, PartialEq, Eq, Hash)] pub SourceItemOrderingCategory { .. } }
export type SourceItemOrderingCategory = "Enum" | "Impl" | "Module" | "Struct" | "Trait";
const SourceItemOrderingCategory_ = conf_enum<SourceItemOrderingCategory>([
  ["Enum", "enum"],
  ["Impl", "impl"],
  ["Module", "module"],
  ["Struct", "struct"],
  ["Trait", "trait"],
]);
export const SourceItemOrderingCategory = {
  Enum: "Enum",
  Impl: "Impl",
  Module: "Module",
  Struct: "Struct",
  Trait: "Trait",
  ...SourceItemOrderingCategory_.inherent,
} as const;
export const FromDefault_for_SourceItemOrderingCategory = SourceItemOrderingCategory_.from_default;
export const Deserialize_for_SourceItemOrderingCategory = SourceItemOrderingCategory_.deserialize;
export const debug_SourceItemOrderingCategory: Debug<SourceItemOrderingCategory> = (v) => v;

/// Represents which item categories are enabled for ordering.
///
/// The [`Deserialize`] implementation checks that there are no duplicates in
/// the user configuration.
export class SourceItemOrdering {
  constructor(public _0: SourceItemOrderingCategory[]) {}

  // rustc: src/tools/clippy/clippy_config/src/types.rs:391 contains
  contains(category: SourceItemOrderingCategory): boolean {
    return this._0.includes(category);
  }
}

// rustc: src/tools/clippy/clippy_config/src/types.rs:397 fmt
export const debug_SourceItemOrdering: Debug<SourceItemOrdering> = (self, f) =>
  debug_list(
    f,
    self._0.map((x) => debug_SourceItemOrderingCategory(x, f)),
  );

export const Deserialize_for_SourceItemOrdering: Deserialize<SourceItemOrdering> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:403 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): SourceItemOrdering | undefined {
    const items = Deserialize_for_Vec(Deserialize_for_SourceItemOrderingCategory).deserialize(dcx, value);
    if (items === undefined) return undefined;
    const items_set = new Set<SourceItemOrderingCategory>();

    for (const item of items) {
      if (items_set.has(item)) {
        dcx.span_err(
          value.span(),
          `The category "${SourceItemOrderingCategory.name(item)}" was enabled more than once in the source ordering configuration.`,
        );
        return undefined;
      }
      items_set.add(item);
    }
    return new SourceItemOrdering(items);
  },
};
export const FromDefault_unit_for_SourceItemOrdering: FromDefault<SourceItemOrdering, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:424 from_default
  from_default(_: null): SourceItemOrdering {
    return new SourceItemOrdering([
      SourceItemOrderingCategory.Enum,
      SourceItemOrderingCategory.Impl,
      SourceItemOrderingCategory.Module,
      SourceItemOrderingCategory.Struct,
      SourceItemOrderingCategory.Trait,
    ]);
  },
  // rustc: src/tools/clippy/clippy_config/src/types.rs:433 display_default
  display_default(_: null): string {
    return `["enum", "impl", "module", "struct", "trait"]`;
  },
};
export const DeserializeOrDefault_unit_for_SourceItemOrdering: DeserializeOrDefault<SourceItemOrdering, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:438 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: null): SourceItemOrdering {
    return Deserialize_for_SourceItemOrdering.deserialize(dcx, value) ?? FromDefault_unit_for_SourceItemOrdering.from_default(default_);
  },
};

// conf_enum! { #[derive(Debug, PartialEq, Eq, Hash)] pub SourceItemOrderingModuleItemKind { .. } }
export type SourceItemOrderingModuleItemKind =
  | "ExternCrate"
  | "Mod"
  | "ForeignMod"
  | "Use"
  | "Macro"
  | "GlobalAsm"
  | "Static"
  | "Const"
  | "TyAlias"
  | "Enum"
  | "Struct"
  | "Union"
  | "Trait"
  | "TraitAlias"
  | "Impl"
  | "Fn"
  | "TestBinderConstraints";
const SourceItemOrderingModuleItemKind_ = conf_enum<SourceItemOrderingModuleItemKind>([
  ["ExternCrate", "extern_crate"],
  ["Mod", "mod"],
  ["ForeignMod", "foreign_mod"],
  ["Use", "use"],
  ["Macro", "macro"],
  ["GlobalAsm", "global_asm"],
  ["Static", "static"],
  ["Const", "const"],
  ["TyAlias", "ty_alias"],
  ["Enum", "enum"],
  ["Struct", "struct"],
  ["Union", "union"],
  ["Trait", "trait"],
  ["TraitAlias", "trait_alias"],
  ["Impl", "impl"],
  ["Fn", "fn"],
  ["TestBinderConstraints", "test_binder_constraints"],
]);
export const SourceItemOrderingModuleItemKind = {
  ExternCrate: "ExternCrate",
  Mod: "Mod",
  ForeignMod: "ForeignMod",
  Use: "Use",
  Macro: "Macro",
  GlobalAsm: "GlobalAsm",
  Static: "Static",
  Const: "Const",
  TyAlias: "TyAlias",
  Enum: "Enum",
  Struct: "Struct",
  Union: "Union",
  Trait: "Trait",
  TraitAlias: "TraitAlias",
  Impl: "Impl",
  Fn: "Fn",
  TestBinderConstraints: "TestBinderConstraints",
  ...SourceItemOrderingModuleItemKind_.inherent,

  // rustc: src/tools/clippy/clippy_config/src/types.rs:467 all_variants
  all_variants(): SourceItemOrderingModuleItemKind[] {
    // #[allow(clippy::enum_glob_use)] // Very local glob use for legibility.
    return [
      "ExternCrate",
      "Mod",
      "ForeignMod",
      "Use",
      "Macro",
      "GlobalAsm",
      "Static",
      "Const",
      "TyAlias",
      "Enum",
      "Struct",
      "Union",
      "Trait",
      "TraitAlias",
      "Impl",
      "Fn",
      "TestBinderConstraints",
    ];
  },
} as const;
export const FromDefault_for_SourceItemOrderingModuleItemKind = SourceItemOrderingModuleItemKind_.from_default;
export const Deserialize_for_SourceItemOrderingModuleItemKind = SourceItemOrderingModuleItemKind_.deserialize;
export const debug_SourceItemOrderingModuleItemKind: Debug<SourceItemOrderingModuleItemKind> = (v) => v;

// PORT: `struct SourceItemOrderingModuleItemGroupings` (types.rs:497) and its inherent impl (:509) are one class, so
// its `Debug` impl (:503), which upstream puts between them, comes just before the class.
const debug_vec_ModuleItemKind = (v: readonly SourceItemOrderingModuleItemKind[], f: Fmt): string =>
  debug_list(
    f,
    v.map((x) => debug_SourceItemOrderingModuleItemKind(x, f)),
  );

// rustc: src/tools/clippy/clippy_config/src/types.rs:504 fmt
export const debug_SourceItemOrderingModuleItemGroupings: Debug<SourceItemOrderingModuleItemGroupings> = (self, f) =>
  debug_list(
    f,
    self.groups.map(([name, items]) => debug_tuple(f, "", [debug_str(name), debug_vec_ModuleItemKind(items, f)])),
  );

/// Represents the configured ordering of items within a module.
///
/// The [`Deserialize`] implementation checks that no item kinds have been
/// omitted and that there are no duplicates in the user configuration.
// #[derive(Clone)]
export class SourceItemOrderingModuleItemGroupings {
  constructor(
    public groups: [string, SourceItemOrderingModuleItemKind[]][],
    public lut: Map<SourceItemOrderingModuleItemKind, number>,
    public back_lut: Map<SourceItemOrderingModuleItemKind, string>,
  ) {}

  // rustc: src/tools/clippy/clippy_config/src/types.rs:510 build_lut
  static build_lut(groups: readonly (readonly [string, readonly SourceItemOrderingModuleItemKind[]])[]): Map<SourceItemOrderingModuleItemKind, number> {
    const lut = new Map<SourceItemOrderingModuleItemKind, number>();
    for (const [group_index, [, items]] of groups.entries()) {
      for (const item of items) {
        lut.set(item, group_index);
      }
    }
    return lut;
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:522 build_back_lut
  static build_back_lut(
    groups: readonly (readonly [string, readonly SourceItemOrderingModuleItemKind[]])[],
  ): Map<SourceItemOrderingModuleItemKind, string> {
    const lut = new Map<SourceItemOrderingModuleItemKind, string>();
    for (const [group_name, items] of groups) {
      for (const item of items) {
        lut.set(item, group_name);
      }
    }
    return lut;
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:534 grouping_name_of
  grouping_name_of(item: SourceItemOrderingModuleItemKind): string | undefined {
    return this.back_lut.get(item);
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:538 grouping_names
  grouping_names(): string[] {
    return this.groups.map(([name]) => name);
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:542 is_grouping
  is_grouping(grouping: string): boolean {
    return this.groups.some(([g]) => g === grouping);
  }

  // rustc: src/tools/clippy/clippy_config/src/types.rs:546 module_level_order_of
  module_level_order_of(item: SourceItemOrderingModuleItemKind): number | undefined {
    return this.lut.get(item);
  }
}

export const Deserialize_for_SourceItemOrderingModuleItemGroupings: Deserialize<SourceItemOrderingModuleItemGroupings> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:552 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): SourceItemOrderingModuleItemGroupings | undefined {
    const values = DeValue.as_array(value.as_ref());
    if (values === undefined) {
      dcx.span_err(value.span(), "expected an array");
      return undefined;
    }
    const groups: [string, SourceItemOrderingModuleItemKind[]][] = [];
    for (const value of values.items) {
      const values = DeValue.as_array(value.as_ref());
      if (values !== undefined && values.items.length === 2) {
        const [value1, value2] = values.items as [TomlValue, TomlValue];
        const a = Deserialize_for_String.deserialize(dcx, value1);
        if (a === undefined) return undefined;
        const b = Deserialize_for_Vec(Deserialize_for_SourceItemOrderingModuleItemKind).deserialize(dcx, value2);
        if (b === undefined) return undefined;
        groups.push([a, b]);
      } else {
        dcx.span_err(value.span(), "expected an array of length two");
        return undefined;
      }
    }

    const items_total = groups.reduce((acc, [, v]) => acc + v.length, 0);
    const lut = SourceItemOrderingModuleItemGroupings.build_lut(groups);
    const back_lut = SourceItemOrderingModuleItemGroupings.build_back_lut(groups);

    let expected_items = SourceItemOrderingModuleItemKind.all_variants();
    for (const item of lut.keys()) {
      expected_items = expected_items.filter((i) => i !== item);
    }

    const all_items = SourceItemOrderingModuleItemKind.all_variants();
    if (expected_items.length === 0 && items_total === all_items.length) {
      const use_group_index = lut.get(SourceItemOrderingModuleItemKind.Use);
      if (use_group_index === undefined) {
        dcx.span_err(value.span(), "Error in internal LUT.");
        return undefined;
      }
      const g = groups[use_group_index];
      if (g === undefined) {
        dcx.span_err(value.span(), "Error in internal LUT.");
        return undefined;
      }
      const [, use_group_items] = g;
      if (use_group_items.length > 1) {
        dcx.span_err(
          value.span(),
          'The group containing the "use" item kind may not contain any other item kinds. ' +
            'The "use" items will (generally) be sorted by rustfmt already. ' +
            "Therefore it makes no sense to implement linting rules that may conflict with rustfmt.",
        );
        return undefined;
      }
      return new SourceItemOrderingModuleItemGroupings(groups, lut, back_lut);
    } else if (items_total !== all_items.length) {
      dcx.span_err(
        value.span(),
        "Some module item kinds were configured more than once, or were missing, in the source ordering configuration. " +
          `The module item kinds are: ${debug_vec_ModuleItemKind(all_items, { alternate: false })}`,
      );
      return undefined;
    } else {
      dcx.span_err(
        value.span(),
        "Not all module item kinds were part of the configured source ordering rule. " +
          "All item kinds must be provided in the config, otherwise the required source ordering would remain ambiguous. " +
          `The module item kinds are: ${debug_vec_ModuleItemKind(all_items, { alternate: false })}`,
      );
      return undefined;
    }
  },
};
export const FromDefault_unit_for_SourceItemOrderingModuleItemGroupings: FromDefault<SourceItemOrderingModuleItemGroupings, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:622 from_default
  from_default(_: null): SourceItemOrderingModuleItemGroupings {
    return new SourceItemOrderingModuleItemGroupings(
      [
        ["modules", [SourceItemOrderingModuleItemKind.ExternCrate, SourceItemOrderingModuleItemKind.Mod, SourceItemOrderingModuleItemKind.ForeignMod]],
        ["use", [SourceItemOrderingModuleItemKind.Use]],
        ["macros", [SourceItemOrderingModuleItemKind.Macro]],
        ["global_asm", [SourceItemOrderingModuleItemKind.GlobalAsm]],
        ["UPPER_SNAKE_CASE", [SourceItemOrderingModuleItemKind.Static, SourceItemOrderingModuleItemKind.Const]],
        [
          "PascalCase",
          [
            SourceItemOrderingModuleItemKind.TyAlias,
            SourceItemOrderingModuleItemKind.Enum,
            SourceItemOrderingModuleItemKind.Struct,
            SourceItemOrderingModuleItemKind.Union,
            SourceItemOrderingModuleItemKind.Trait,
            SourceItemOrderingModuleItemKind.TraitAlias,
            SourceItemOrderingModuleItemKind.Impl,
            SourceItemOrderingModuleItemKind.TestBinderConstraints,
          ],
        ],
        ["lower_snake_case", [SourceItemOrderingModuleItemKind.Fn]],
      ],
      new Map<SourceItemOrderingModuleItemKind, number>([
        [SourceItemOrderingModuleItemKind.ExternCrate, 0],
        [SourceItemOrderingModuleItemKind.Mod, 0],
        [SourceItemOrderingModuleItemKind.ForeignMod, 0],
        [SourceItemOrderingModuleItemKind.Use, 1],
        [SourceItemOrderingModuleItemKind.Macro, 2],
        [SourceItemOrderingModuleItemKind.GlobalAsm, 3],
        [SourceItemOrderingModuleItemKind.Static, 4],
        [SourceItemOrderingModuleItemKind.Const, 4],
        [SourceItemOrderingModuleItemKind.TyAlias, 5],
        [SourceItemOrderingModuleItemKind.Enum, 5],
        [SourceItemOrderingModuleItemKind.Struct, 5],
        [SourceItemOrderingModuleItemKind.Union, 5],
        [SourceItemOrderingModuleItemKind.Trait, 5],
        [SourceItemOrderingModuleItemKind.TraitAlias, 5],
        [SourceItemOrderingModuleItemKind.Impl, 5],
        [SourceItemOrderingModuleItemKind.TestBinderConstraints, 5],
        [SourceItemOrderingModuleItemKind.Fn, 6],
      ]),
      new Map<SourceItemOrderingModuleItemKind, string>([
        [SourceItemOrderingModuleItemKind.ExternCrate, "modules"],
        [SourceItemOrderingModuleItemKind.Mod, "modules"],
        [SourceItemOrderingModuleItemKind.ForeignMod, "modules"],
        [SourceItemOrderingModuleItemKind.Use, "use"],
        [SourceItemOrderingModuleItemKind.Macro, "macros"],
        [SourceItemOrderingModuleItemKind.GlobalAsm, "global_asm"],
        [SourceItemOrderingModuleItemKind.Static, "UPPER_SNAKE_CASE"],
        [SourceItemOrderingModuleItemKind.Const, "UPPER_SNAKE_CASE"],
        [SourceItemOrderingModuleItemKind.TyAlias, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Enum, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Struct, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Union, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Trait, "PascalCase"],
        [SourceItemOrderingModuleItemKind.TraitAlias, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Impl, "PascalCase"],
        [SourceItemOrderingModuleItemKind.TestBinderConstraints, "PascalCase"],
        [SourceItemOrderingModuleItemKind.Fn, "lower_snake_case"],
      ]),
    );
  },
  // rustc: src/tools/clippy/clippy_config/src/types.rs:701 display_default
  display_default(_: null): string {
    return `[["modules", ["extern_crate", "mod", "foreign_mod"]], ["use", ["use"]], ["macros", ["macro"]], ["global_asm", ["global_asm"]], ["UPPER_SNAKE_CASE", ["static", "const"]], ["PascalCase", ["ty_alias", "enum", "struct", "union", "trait", "trait_alias", "impl", "test_binder_constraints"]], ["lower_snake_case", ["fn"]]]`;
  },
};
export const DeserializeOrDefault_unit_for_SourceItemOrderingModuleItemGroupings: DeserializeOrDefault<
  SourceItemOrderingModuleItemGroupings,
  null
> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:706 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: null): SourceItemOrderingModuleItemGroupings {
    return (
      Deserialize_for_SourceItemOrderingModuleItemGroupings.deserialize(dcx, value) ??
      FromDefault_unit_for_SourceItemOrderingModuleItemGroupings.from_default(default_)
    );
  },
};

// conf_enum! { #[derive(Debug, PartialEq)] pub SourceItemOrderingTraitAssocItemKind { .. } }
export type SourceItemOrderingTraitAssocItemKind = "Const" | "Fn" | "Type";
const SourceItemOrderingTraitAssocItemKind_ = conf_enum<SourceItemOrderingTraitAssocItemKind>([
  ["Const", "const"],
  ["Fn", "fn"],
  ["Type", "type"],
]);
export const SourceItemOrderingTraitAssocItemKind = {
  Const: "Const",
  Fn: "Fn",
  Type: "Type",
  ...SourceItemOrderingTraitAssocItemKind_.inherent,

  // rustc: src/tools/clippy/clippy_config/src/types.rs:721 all_variants
  all_variants(): SourceItemOrderingTraitAssocItemKind[] {
    // #[allow(clippy::enum_glob_use)] // Very local glob use for legibility.
    return ["Const", "Fn", "Type"];
  },
} as const;
export const FromDefault_for_SourceItemOrderingTraitAssocItemKind = SourceItemOrderingTraitAssocItemKind_.from_default;
export const Deserialize_for_SourceItemOrderingTraitAssocItemKind = SourceItemOrderingTraitAssocItemKind_.deserialize;
export const debug_SourceItemOrderingTraitAssocItemKind: Debug<SourceItemOrderingTraitAssocItemKind> = (v) => v;

const debug_vec_TraitAssocItemKind = (v: readonly SourceItemOrderingTraitAssocItemKind[], f: Fmt): string =>
  debug_list(
    f,
    v.map((x) => debug_SourceItemOrderingTraitAssocItemKind(x, f)),
  );

// PORT: `struct SourceItemOrderingTraitAssocItemKinds` (types.rs:736) and its inherent impl (:744) are one class, so its
// `Debug` impl (:738), which upstream puts between them, comes just before the class.
// rustc: src/tools/clippy/clippy_config/src/types.rs:739 fmt
export const debug_SourceItemOrderingTraitAssocItemKinds: Debug<SourceItemOrderingTraitAssocItemKinds> = (self, f) =>
  debug_vec_TraitAssocItemKind(self._0, f);

/// Represents the order in which associated trait items should be ordered.
///
/// The reason to wrap a `Vec` in a newtype is to be able to implement
/// [`Deserialize`]. Implementing `Deserialize` allows for implementing checks
/// on configuration completeness at the time of loading the clippy config,
/// letting the user know if there's any issues with the config (e.g. not
/// listing all item kinds that should be sorted).
// #[derive(Clone)]
export class SourceItemOrderingTraitAssocItemKinds {
  constructor(public _0: SourceItemOrderingTraitAssocItemKind[]) {}

  // rustc: src/tools/clippy/clippy_config/src/types.rs:745 index_of
  index_of(item: SourceItemOrderingTraitAssocItemKind): number | undefined {
    const i = this._0.indexOf(item);
    return i < 0 ? undefined : i;
  }
}

export const Deserialize_for_SourceItemOrderingTraitAssocItemKinds: Deserialize<SourceItemOrderingTraitAssocItemKinds> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:751 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): SourceItemOrderingTraitAssocItemKinds | undefined {
    const items = Deserialize_for_Vec(Deserialize_for_SourceItemOrderingTraitAssocItemKind).deserialize(dcx, value);
    if (items === undefined) return undefined;

    let expected_items = SourceItemOrderingTraitAssocItemKind.all_variants();
    for (const item of items) {
      expected_items = expected_items.filter((i) => i !== item);
    }

    const all_items = SourceItemOrderingTraitAssocItemKind.all_variants();
    if (expected_items.length === 0 && items.length === all_items.length) {
      return new SourceItemOrderingTraitAssocItemKinds(items);
    } else if (items.length !== all_items.length) {
      dcx.span_err(
        value.span(),
        "Some trait associated item kinds were configured more than once, or were missing, in the source ordering configuration. " +
          `The trait associated item kinds are: ${debug_vec_TraitAssocItemKind(all_items, { alternate: false })}`,
      );
      return undefined;
    } else {
      dcx.span_err(
        value.span(),
        "Not all trait associated item kinds were part of the configured source ordering rule. " +
          "All item kinds must be provided in the config, otherwise the required source ordering would remain ambiguous. " +
          `The trait associated item kinds are: ${debug_vec_TraitAssocItemKind(all_items, { alternate: false })}`,
      );
      return undefined;
    }
  },
};
export const FromDefault_unit_for_SourceItemOrderingTraitAssocItemKinds: FromDefault<SourceItemOrderingTraitAssocItemKinds, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:785 from_default
  from_default(_: null): SourceItemOrderingTraitAssocItemKinds {
    return new SourceItemOrderingTraitAssocItemKinds([
      SourceItemOrderingTraitAssocItemKind.Const,
      SourceItemOrderingTraitAssocItemKind.Type,
      SourceItemOrderingTraitAssocItemKind.Fn,
    ]);
  },
  // rustc: src/tools/clippy/clippy_config/src/types.rs:792 display_default
  display_default(_: null): string {
    return `["const", "type", "fn"]`;
  },
};
export const DeserializeOrDefault_unit_for_SourceItemOrderingTraitAssocItemKinds: DeserializeOrDefault<
  SourceItemOrderingTraitAssocItemKinds,
  null
> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:797 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: null): SourceItemOrderingTraitAssocItemKinds {
    return (
      Deserialize_for_SourceItemOrderingTraitAssocItemKinds.deserialize(dcx, value) ??
      FromDefault_unit_for_SourceItemOrderingTraitAssocItemKinds.from_default(default_)
    );
  },
};

/// Describes which specific groupings should have their items ordered
/// alphabetically.
///
/// This is separate from defining and enforcing groupings. For example,
/// defining enums are grouped before structs still allows for an enum B to be
/// placed before an enum A. Only when enforcing ordering within the grouping,
/// will it be checked if A is placed before B.
// #[derive(Clone, Debug)]
export type SourceItemOrderingWithinModuleItemGroupings =
  /// All groupings should have their items ordered.
  | { readonly $: "All" }
  /// None of the groupings should have their order checked.
  | { readonly $: "None" }
  /// Only the specified groupings should have their order checked.
  | { readonly $: "Custom"; readonly _0: Spanned<string>[] };
export const SourceItemOrderingWithinModuleItemGroupings = {
  All: Object.freeze({ $: "All" as const }),
  None: Object.freeze({ $: "None" as const }),

  // rustc: src/tools/clippy/clippy_config/src/types.rs:822 ordered_within
  ordered_within(self: SourceItemOrderingWithinModuleItemGroupings, grouping_name: string): boolean {
    switch (self.$) {
      case "All":
        return true;
      case "None":
        return false;
      case "Custom":
        return self._0.some((x) => x.node === grouping_name);
    }
  },

  // rustc: src/tools/clippy/clippy_config/src/types.rs:832 check_groupings
  check_groupings(
    self: SourceItemOrderingWithinModuleItemGroupings,
    sess: Session,
    module_item_order_groupings: SourceItemOrderingModuleItemGroupings,
  ): void {
    if (self.$ === "Custom") {
      const groupings = self._0;
      for (const grouping of groupings) {
        if (!module_item_order_groupings.is_grouping(grouping.node)) {
          // Since this isn't fixable by rustfix, don't emit a `Suggestion`. This just adds some useful
          // info for the user instead.
          const names_ = module_item_order_groupings.groups.map(([x]) => x);
          const s = find_closest_match(grouping.node, names_);
          const suggestion = s === undefined ? "" : ` perhaps you meant \`${s}\`?`;
          const names = names_.map((s) => `\`${s}\``).join(", ");
          sess
            .dcx()
            .span_err(
              grouping.span,
              `unknown ordering group: \`${grouping.node}\` was not specified in \`module-items-ordered-within-groupings\`,${suggestion} expected one of: ${names}`,
            );
        }
      }
    }
  },
};

export const debug_SourceItemOrderingWithinModuleItemGroupings: Debug<SourceItemOrderingWithinModuleItemGroupings> = (v, f) => {
  switch (v.$) {
    case "All":
      return "All";
    case "None":
      return "None";
    case "Custom":
      return debug_tuple(f, "Custom", [
        debug_list(
          f,
          v._0.map((x) => debug_Spanned(x, f, (s) => debug_str(s))),
        ),
      ]);
  }
};

export const Deserialize_for_SourceItemOrderingWithinModuleItemGroupings: Deserialize<SourceItemOrderingWithinModuleItemGroupings> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:857 deserialize
  deserialize(dcx: DiagCtxt, value: TomlValue): SourceItemOrderingWithinModuleItemGroupings | undefined {
    const v = value.as_ref();
    switch (v.$) {
      case "String":
        switch (v._0) {
          case "all":
            return SourceItemOrderingWithinModuleItemGroupings.All;
          case "none":
            return SourceItemOrderingWithinModuleItemGroupings.None;
          default:
            dcx.span_err(value.span(), "expected: `all`, `none` or a list of category names");
            return undefined;
        }
      case "Array": {
        const x = Deserialize_for_Vec(Deserialize_for_Spanned(Deserialize_for_String)).deserialize(dcx, value);
        return x === undefined ? undefined : { $: "Custom", _0: x };
      }
      default:
        dcx.span_err(value.span(), "expected a string or an array of strings");
        return undefined;
    }
  },
};
export const FromDefault_unit_for_SourceItemOrderingWithinModuleItemGroupings: FromDefault<SourceItemOrderingWithinModuleItemGroupings, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:876 from_default
  from_default(_: null): SourceItemOrderingWithinModuleItemGroupings {
    return SourceItemOrderingWithinModuleItemGroupings.None;
  },
  // rustc: src/tools/clippy/clippy_config/src/types.rs:879 display_default
  display_default(_: null): string {
    return `"none"`;
  },
};
export const DeserializeOrDefault_unit_for_SourceItemOrderingWithinModuleItemGroupings: DeserializeOrDefault<
  SourceItemOrderingWithinModuleItemGroupings,
  null
> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:884 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: null): SourceItemOrderingWithinModuleItemGroupings {
    return (
      Deserialize_for_SourceItemOrderingWithinModuleItemGroupings.deserialize(dcx, value) ??
      FromDefault_unit_for_SourceItemOrderingWithinModuleItemGroupings.from_default(default_)
    );
  },
};

// conf_enum! { #[derive(Debug, PartialEq, Eq, Hash)] pub InherentImplLintScope { .. } }
export type InherentImplLintScope = "Crate" | "File" | "Module";
const InherentImplLintScope_ = conf_enum<InherentImplLintScope>([
  ["Crate", "crate"],
  ["File", "file"],
  ["Module", "module"],
]);
export const InherentImplLintScope = {
  Crate: "Crate",
  File: "File",
  Module: "Module",
  ...InherentImplLintScope_.inherent,
} as const;
export const FromDefault_for_InherentImplLintScope = InherentImplLintScope_.from_default;
export const Deserialize_for_InherentImplLintScope = InherentImplLintScope_.deserialize;
export const debug_InherentImplLintScope: Debug<InherentImplLintScope> = (v) => v;

// conf_enum! { #[derive(Debug, PartialEq, Eq, Hash)] pub TraitImplItemOrder { .. } }
export type TraitImplItemOrder = "Alphabetical" | "TraitItemOrdering" | "AlphabeticalOrTraitItemOrdering";
const TraitImplItemOrder_ = conf_enum<TraitImplItemOrder>([
  ["Alphabetical", "alphabetical"],
  ["TraitItemOrdering", "trait_item_ordering"],
  ["AlphabeticalOrTraitItemOrdering", "alphabetical_or_trait_item_ordering"],
]);
export const TraitImplItemOrder = {
  Alphabetical: "Alphabetical",
  TraitItemOrdering: "TraitItemOrdering",
  AlphabeticalOrTraitItemOrdering: "AlphabeticalOrTraitItemOrdering",
  ...TraitImplItemOrder_.inherent,
} as const;
export const FromDefault_for_TraitImplItemOrder = TraitImplItemOrder_.from_default;
export const Deserialize_for_TraitImplItemOrder = TraitImplItemOrder_.deserialize;
export const debug_TraitImplItemOrder: Debug<TraitImplItemOrder> = (v) => v;
export const FromDefault_unit_for_TraitImplItemOrder: FromDefault<TraitImplItemOrder, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:907 from_default
  from_default(_: null): TraitImplItemOrder {
    return TraitImplItemOrder.Alphabetical;
  },
  // rustc: src/tools/clippy/clippy_config/src/types.rs:910 display_default
  display_default(_: null): string {
    return `"alphabetical"`;
  },
};
export const DeserializeOrDefault_unit_for_TraitImplItemOrder: DeserializeOrDefault<TraitImplItemOrder, null> = {
  // rustc: src/tools/clippy/clippy_config/src/types.rs:915 deserialize_or_default
  deserialize_or_default(dcx: DiagCtxt, value: TomlValue, default_: null): TraitImplItemOrder {
    return Deserialize_for_TraitImplItemOrder.deserialize(dcx, value) ?? FromDefault_unit_for_TraitImplItemOrder.from_default(default_);
  },
};
