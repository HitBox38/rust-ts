//! cfg and check-cfg configuration
//!
//! This module contains the definition of [`Cfg`] and [`CheckCfg`]
//! as well as the logic for creating the default configuration for a
//! given [`Session`].
//!
//! It also contains the filling of the well known configs, which should
//! ALWAYS be in sync with the default_configuration.
//!
//! ## Adding a new cfg
//!
//! Adding a new feature requires two new symbols one for the cfg itself
//! and the second one for the unstable feature gate, those are defined in
//! `rustc_span::symbol`.
//!
//! As well as the following points,
//!  - Add the activation logic in [`default_configuration`]
//!  - Add the cfg to [`CheckCfg::fill_well_known`] (and related files),
//!    so that the compiler can know the cfg is expected
//!  - Add the cfg in [`disallow_cfgs`] to disallow users from setting it via `--cfg`
//!  - Add the feature gating in `compiler/rustc_feature/src/builtin_attrs.rs`
import { EXPLICIT_BUILTIN_CFGS_IN_FLAGS } from "../../rustc_lint_defs/builtin.ts";
import { Symbol, sym } from "../../rustc_span/symbol.ts";
import { type Align, Endian, TargetDataLayoutError_into_diag } from "../../rustc_abi/lib.ts";
import { spec, target_features } from "../../rustc_target/lib.ts";
import type { Target } from "../../rustc_target/spec/mod.ts";
import { BUILTIN_TARGET_CFG_VALUES } from "../../rust_ts/target_config.gen.ts";
import { panic, unported } from "../../std/panic.ts";
import { CrateType, SanitizerSet } from "../stand_ins.ts";
import { FmtDebug } from "../config.ts";
import { UnexpectedBuiltinCfg_diagnostic } from "../diagnostics.ts";
import type { Session } from "../session.ts";

/// The parsed `--cfg` options that define the compilation environment of the
/// crate, used to drive conditional compilation.
///
/// An `FxIndexSet` is used to ensure deterministic ordering of error messages
/// relating to `--cfg`.
// pub type Cfg = FxIndexSet<(Symbol, Option<Symbol>)>;
// PORT: an insertion-ordered set of `(name, value)` pairs, keyed by the two symbol indices.
export class Cfg {
  private readonly map = new Map<string, readonly [Symbol, Symbol | undefined]>();

  /** `Cfg::default()` */
  static default(): Cfg {
    return new Cfg();
  }

  private static key([name, value]: readonly [Symbol, Symbol | undefined]): string {
    return value === undefined ? `${name}` : `${name}=${value}`;
  }

  /** `IndexSet::insert`: returns whether the pair was new. */
  insert(cfg: readonly [Symbol, Symbol | undefined]): boolean {
    const k = Cfg.key(cfg);
    if (this.map.has(k)) return false;
    this.map.set(k, [cfg[0], cfg[1]]);
    return true;
  }

  /** `IndexSet::contains` */
  contains(cfg: readonly [Symbol, Symbol | undefined]): boolean {
    return this.map.has(Cfg.key(cfg));
  }

  /** `Extend` */
  extend(iter: Iterable<readonly [Symbol, Symbol | undefined]>): void {
    for (const cfg of iter) this.insert(cfg);
  }

  /** `IndexSet::len` */
  len(): number {
    return this.map.size;
  }

  /** `IndexSet::iter` (insertion order) */
  iter(): (readonly [Symbol, Symbol | undefined])[] {
    return [...this.map.values()];
  }

  [globalThis.Symbol.iterator](): Iterator<readonly [Symbol, Symbol | undefined]> {
    return this.map.values();
  }
}

/// The parsed `--check-cfg` options.
// #[derive(Default)]
export class CheckCfg {
  constructor(
    /// Is well known names activated
    public exhaustive_names: boolean,
    /// Is well known values activated
    public exhaustive_values: boolean,
    /// All the expected values for a config name
    public expecteds: Map<Symbol, ExpectedValues>,
    /// Well known names (only used for diagnostics purposes)
    public well_known_names: Set<Symbol>,
  ) {}

  /** `#[derive(Default)]` */
  static default(): CheckCfg {
    return new CheckCfg(false, false, new Map(), new Set());
  }

  /// Fill the current [`CheckCfg`] with all the well known cfgs
  // rustc: compiler/rustc_session/src/config/cfg.rs:336 fill_well_known
  fill_well_known(current_target: Target): void {
    if (!this.exhaustive_values && !this.exhaustive_names) {
      return;
    }

    // for `#[cfg(foo)]` (i.e. cfg value is none)
    const no_values = (): ExpectedValues => {
      const values = new Set<Symbol | undefined>();
      values.add(undefined);
      return { $: "Some", _0: values };
    };

    // preparation for inserting some values
    const empty_values = (): ExpectedValues => {
      const values = new Set<Symbol | undefined>();
      return { $: "Some", _0: values };
    };

    // macro_rules! ins
    const ins = (name: Symbol, values: () => ExpectedValues): ExpectedValues => {
      this.well_known_names.add(name);
      let e = this.expecteds.get(name);
      if (e === undefined) {
        e = values();
        this.expecteds.set(name, e);
      }
      return e;
    };

    // Symbols are inserted in alphabetical order as much as possible.
    // The exceptions are where control flow forces things out of order.
    //
    // NOTE: This should be kept in sync with `default_configuration`.
    // Note that symbols inserted conditionally in `default_configuration`
    // are inserted unconditionally here.
    //
    // One exception is the `test` cfg which is consider to be a "user-space"
    // cfg, despite being also set by in `default_configuration` above.
    // It allows the build system to "deny" using the config by not marking it
    // as expected (e.g. `lib.test = false` for Cargo).
    //
    // When adding a new config here you should also update
    // `tests/ui/check-cfg/well-known-values.rs` (in order to test the
    // expected values of the new config) and bless the all directory.
    //
    // Don't forget to update `src/doc/rustc/src/check-cfg.md`
    // in the unstable book as well!

    ins(sym.debug_assertions, no_values);

    ExpectedValues.extend(ins(sym.fmt_debug, empty_values), FmtDebug.all());

    // These four are never set by rustc, but we set them anyway; they
    // should not trigger the lint because `cargo clippy`, `cargo doc`,
    // `cargo test`, `cargo miri run` and `cargo fmt` (respectively)
    // can set them.
    ins(sym.clippy, no_values);
    ins(sym.doc, no_values);
    ins(sym.doctest, no_values);
    ins(sym.miri, no_values);
    ins(sym.rust_analyzer, no_values);
    ins(sym.rustfmt, no_values);

    ins(sym.overflow_checks, no_values);

    ExpectedValues.extend(ins(sym.panic, empty_values), spec.PanicStrategy.ALL.map(spec.PanicStrategy.desc_symbol));

    ins(sym.proc_macro, no_values);

    ExpectedValues.extend(ins(sym.relocation_model, empty_values), spec.RelocModel.ALL.map(spec.RelocModel.desc_symbol));

    const sanitize_values = SanitizerSet.iter(SanitizerSet.all()).map((sanitizer) => {
      const s = SanitizerSet.as_str(sanitizer);
      if (s === undefined) return panic("called `Option::unwrap()` on a `None` value");
      return Symbol.intern(s);
    });
    ExpectedValues.extend(ins(sym.sanitize, empty_values), sanitize_values);

    ins(sym.sanitizer_cfi_generalize_pointers, no_values);
    ins(sym.sanitizer_cfi_normalize_integers, no_values);

    ExpectedValues.extend(
      ins(sym.target_feature, empty_values),
      [
        ...target_features
          .all_rust_features()
          .filter(([, s]) => target_features.Stability.in_cfg(s))
          .map(([f]) => f),
        ...target_features.RUSTC_SPECIFIC_FEATURES,
      ].map((f) => Symbol.intern(f)),
    );

    // sym::target_*
    {
      const VALUES: Symbol[] = [
        sym.target_abi,
        sym.target_arch,
        sym.target_endian,
        sym.target_env,
        sym.target_family,
        sym.target_object_format,
        sym.target_os,
        sym.target_pointer_width,
        sym.target_vendor,
      ];

      // Initialize (if not already initialized)
      for (const e of VALUES) {
        if (!this.exhaustive_values) {
          ins(e, () => ({ $: "Any" }));
        } else {
          ins(e, empty_values);
        }
      }

      if (this.exhaustive_values) {
        // Get all values map at once otherwise it would be costly.
        // (8 values * 220 targets ~= 1760 times, at the time of writing this comment).
        const [
          values_target_abi,
          values_target_arch,
          values_target_endian,
          values_target_env,
          values_target_family,
          values_target_object_format,
          values_target_os,
          values_target_pointer_width,
          values_target_vendor,
        ] = VALUES.map((v) => this.expecteds.get(v));
        if (
          values_target_abi === undefined ||
          values_target_arch === undefined ||
          values_target_endian === undefined ||
          values_target_env === undefined ||
          values_target_family === undefined ||
          values_target_object_format === undefined ||
          values_target_os === undefined ||
          values_target_pointer_width === undefined ||
          values_target_vendor === undefined
        ) {
          return panic("unable to get all the check-cfg values buckets");
        }

        // `for target in Target::builtins().chain(iter::once(current_target.clone()))`
        // PORT: only some built-in target specs are ported, so the built-ins' cfg values come from a table
        // generated from the oracle (`rustc --print cfg --target T` for every `TARGETS` entry,
        // tools/codegen/target-config.ts); the current target's come from its spec, as upstream.
        for (const t of BUILTIN_TARGET_CFG_VALUES) {
          ExpectedValues.insert(values_target_abi, Symbol.intern(t.target_abi));
          ExpectedValues.insert(values_target_arch, Symbol.intern(t.target_arch));
          ExpectedValues.insert(values_target_endian, Symbol.intern(t.target_endian));
          ExpectedValues.insert(values_target_env, Symbol.intern(t.target_env));
          ExpectedValues.extend(
            values_target_family,
            t.target_family.map((family) => Symbol.intern(family)),
          );
          ExpectedValues.insert(values_target_object_format, Symbol.intern(t.target_object_format));
          ExpectedValues.insert(values_target_os, Symbol.intern(t.target_os));
          ExpectedValues.insert(values_target_pointer_width, Symbol.intern(t.target_pointer_width));
          ExpectedValues.insert(values_target_vendor, Symbol.intern(t.target_vendor));
        }
        {
          const target = current_target.clone();
          ExpectedValues.insert(values_target_abi, spec.CfgAbi.desc_symbol(target.options.cfg_abi));
          ExpectedValues.insert(values_target_arch, spec.Arch.desc_symbol(target.arch));
          ExpectedValues.insert(values_target_endian, Endian.desc_symbol(target.options.endian));
          ExpectedValues.insert(values_target_env, spec.Env.desc_symbol(target.options.env));
          ExpectedValues.extend(
            values_target_family,
            target.options.families.map((family) => Symbol.intern(family)),
          );
          ExpectedValues.insert(values_target_object_format, spec.BinaryFormat.desc_symbol(target.options.binary_format));
          ExpectedValues.insert(values_target_os, spec.Os.desc_symbol(target.options.os));
          ExpectedValues.insert(values_target_pointer_width, sym.integer(target.pointer_width));
          ExpectedValues.insert(values_target_vendor, target.vendor_symbol());
        }
      }
    }

    const atomic_values = [sym.ptr, sym.integer(8), sym.integer(16), sym.integer(32), sym.integer(64), sym.integer(128)];
    for (const sym_ of [sym.target_has_atomic, sym.target_has_atomic_load_store]) {
      ExpectedValues.extend_ref(ins(sym_, no_values), atomic_values);
    }
    ExpectedValues.extend_ref(ins(sym.target_has_atomic_primitive_alignment, empty_values), atomic_values);

    ins(sym.target_thread_local, no_values);
    ins(sym.target_has_threads, no_values);

    ins(sym.ub_checks, no_values);
    ins(sym.contract_checks, no_values);

    ins(sym.unix, no_values);
    ins(sym.windows, no_values);
  }
}

// pub enum ExpectedValues<T> { Some(FxHashSet<Option<T>>), Any }
// PORT: `T` is always `Symbol` in rustc.
export type ExpectedValues = { readonly $: "Some"; readonly _0: Set<Symbol | undefined> } | { readonly $: "Any" };
export const ExpectedValues = {
  // rustc: compiler/rustc_session/src/config/cfg.rs:61 insert
  insert(self: ExpectedValues, value: Symbol): boolean {
    switch (self.$) {
      case "Some": {
        const had = self._0.has(value);
        self._0.add(value);
        return !had;
      }
      case "Any":
        return false;
    }
  },

  // rustc: compiler/rustc_session/src/config/cfg.rs:68 contains
  contains(self: ExpectedValues, value: Symbol | undefined): boolean {
    switch (self.$) {
      case "Some":
        return self._0.has(value);
      case "Any":
        return false;
    }
  },

  // impl<T: Eq + Hash> Extend<T> for ExpectedValues<T>
  // rustc: compiler/rustc_session/src/config/cfg.rs:77 extend
  extend(self: ExpectedValues, iter: Iterable<Symbol>): void {
    switch (self.$) {
      case "Some":
        for (const v of iter) self._0.add(v);
        break;
      case "Any":
        break;
    }
  },

  // impl<'a, T: Eq + Hash + Copy + 'a> Extend<&'a T> for ExpectedValues<T>
  // rustc: compiler/rustc_session/src/config/cfg.rs:86 extend
  extend_ref(self: ExpectedValues, iter: Iterable<Symbol>): void {
    switch (self.$) {
      case "Some":
        for (const a of iter) self._0.add(a);
        break;
      case "Any":
        break;
    }
  },
} as const;

/// Disallow builtin cfgs from the CLI.
// rustc: compiler/rustc_session/src/config/cfg.rs:95 disallow_cfgs
export function disallow_cfgs(sess: Session, user_cfgs: Cfg): void {
  const disallow = (cfg: readonly [Symbol, Symbol | undefined], controlled_by: string): void => {
    const cfg_name = cfg[0];
    let cfg_: string;
    if (cfg[1] !== undefined) {
      const value = cfg[1];
      cfg_ = `${Symbol.as_str(cfg_name)}="${Symbol.as_str(value)}"`;
    } else {
      cfg_ = `${Symbol.as_str(cfg_name)}`;
    }
    sess.psess.buffer_crate_lint(
      EXPLICIT_BUILTIN_CFGS_IN_FLAGS,
      UnexpectedBuiltinCfg_diagnostic({ cfg: cfg_, cfg_name, controlled_by }),
    );
  };

  // We want to restrict setting builtin cfgs that will produce incoherent behavior
  // between the cfg and the rustc cli flag that sets it.
  //
  // The tests are in tests/ui/cfg/disallowed-cli-cfgs.rs.

  // By-default all builtin cfgs are disallowed, only those are allowed:
  //  - test: as it makes sense to the have the `test` cfg active without the builtin
  //          test harness. See Cargo `harness = false` config.
  //
  // Cargo `--cfg test`: https://github.com/rust-lang/cargo/blob/bc89bffa5987d4af8f71011c7557119b39e44a65/src/cargo/core/compiler/mod.rs#L1124

  for (const cfg of user_cfgs) {
    const [name, value] = cfg;
    const none = value === undefined;
    if (name === sym.overflow_checks && none) {
      disallow(cfg, "-C overflow-checks");
    } else if (name === sym.debug_assertions && none) {
      disallow(cfg, "-C debug-assertions");
    } else if (name === sym.ub_checks && none) {
      disallow(cfg, "-Z ub-checks");
    } else if (name === sym.contract_checks && none) {
      disallow(cfg, "-Z contract-checks");
    } else if (name === sym.sanitize) {
      disallow(cfg, "-Z sanitizer");
    } else if (name === sym.sanitizer_cfi_generalize_pointers || name === sym.sanitizer_cfi_normalize_integers) {
      disallow(cfg, "-Z sanitizer=cfi");
    } else if (name === sym.proc_macro && none) {
      disallow(cfg, "--crate-type proc-macro");
    } else if (name === sym.panic && (value === sym.abort || value === sym.unwind || value === sym.immediate_abort)) {
      disallow(cfg, "-C panic");
    } else if (name === sym.target_feature && !none) {
      disallow(cfg, "-C target-feature");
    } else if (
      (name === sym.unix && none) ||
      (name === sym.windows && none) ||
      (name === sym.relocation_model && !none) ||
      name === sym.target_abi ||
      (name === sym.target_arch && !none) ||
      (name === sym.target_endian && !none) ||
      name === sym.target_env ||
      (name === sym.target_family && !none) ||
      (name === sym.target_object_format && !none) ||
      (name === sym.target_os && !none) ||
      (name === sym.target_pointer_width && !none) ||
      name === sym.target_vendor ||
      (name === sym.target_has_atomic && !none) ||
      name === sym.target_has_threads ||
      (name === sym.target_has_atomic_primitive_alignment && !none) ||
      (name === sym.target_has_atomic_load_store && !none) ||
      name === sym.target_has_reliable_f16 ||
      name === sym.target_has_reliable_f16_math ||
      name === sym.target_has_reliable_f16b ||
      name === sym.target_has_reliable_f128 ||
      name === sym.target_has_reliable_f128_math ||
      (name === sym.target_thread_local && none)
    ) {
      disallow(cfg, "--target");
    } else if (name === sym.fmt_debug) {
      disallow(cfg, "-Z fmt-debug");
    }
  }
}

/// Generate the default configs for a given session
// rustc: compiler/rustc_session/src/config/cfg.rs:165 default_configuration
export function default_configuration(sess: Session): Cfg {
  const ret = Cfg.default();

  // macro_rules! ins_none / ins_str / ins_sym
  const ins_none = (key: Symbol): void => {
    ret.insert([key, undefined]);
  };
  const ins_str = (key: Symbol, val_str: string): void => {
    ret.insert([key, Symbol.intern(val_str)]);
  };
  const ins_sym = (key: Symbol, val_sym: Symbol): void => {
    ret.insert([key, val_sym]);
  };

  // Symbols are inserted in alphabetical order as much as possible.
  // The exceptions are where control flow forces things out of order.
  //
  // Run `rustc --print cfg` to see the configuration in practice.
  //
  // NOTE: These insertions should be kept in sync with
  // `CheckCfg::fill_well_known` below.

  if (sess.opts.debug_assertions) {
    ins_none(sym.debug_assertions);
  }

  if (sess.is_nightly_build()) {
    switch (sess.opts.unstable_opts.fmt_debug) {
      case "Full":
        ins_sym(sym.fmt_debug, sym.full);
        break;
      case "Shallow":
        ins_sym(sym.fmt_debug, sym.shallow);
        break;
      case "None":
        ins_sym(sym.fmt_debug, sym.none);
        break;
    }
  }

  if (sess.overflow_checks()) {
    ins_none(sym.overflow_checks);
  }

  // We insert a cfg for the name of session's panic strategy.
  // Since the ImmediateAbort strategy is new, it also sets cfg(panic="abort"), so that code
  // which is trying to detect whether unwinding is enabled by checking for cfg(panic="abort")
  // does not need to be updated.
  ins_sym(sym.panic, spec.PanicStrategy.desc_symbol(sess.panic_strategy()));
  if (sess.panic_strategy() === "ImmediateAbort") {
    ins_sym(sym.panic, spec.PanicStrategy.desc_symbol("Abort"));
  }

  // JUSTIFICATION: before wrapper fn is available
  // #[allow(rustc::bad_opt_access)]
  if (sess.opts.crate_types.includes(CrateType.ProcMacro)) {
    ins_none(sym.proc_macro);
  }

  if (sess.is_nightly_build()) {
    ins_sym(sym.relocation_model, spec.RelocModel.desc_symbol(sess.target.relocation_model));
  }

  for (let s of SanitizerSet.iter(sess.sanitizers())) {
    // KASAN is still ASAN under the hood, so it uses the same attribute.
    if (s === SanitizerSet.KERNELADDRESS) {
      s = SanitizerSet.ADDRESS;
    }
    // KHWASAN is still HWASAN under the hood, so it uses the same attribute.
    if (s === SanitizerSet.KERNELHWADDRESS) {
      s = SanitizerSet.HWADDRESS;
    }
    ins_str(sym.sanitize, SanitizerSet.display(s));
  }

  if (sess.is_sanitizer_cfi_generalize_pointers_enabled()) {
    ins_none(sym.sanitizer_cfi_generalize_pointers);
  }
  if (sess.is_sanitizer_cfi_normalize_integers_enabled()) {
    ins_none(sym.sanitizer_cfi_normalize_integers);
  }

  ins_sym(sym.target_abi, spec.CfgAbi.desc_symbol(sess.target.cfg_abi));
  ins_sym(sym.target_arch, spec.Arch.desc_symbol(sess.target.arch));
  ins_sym(sym.target_endian, Endian.desc_symbol(sess.target.endian));
  ins_sym(sym.target_env, spec.Env.desc_symbol(sess.target.env));
  ins_sym(sym.target_object_format, spec.BinaryFormat.desc_symbol(sess.target.options.binary_format));

  for (const family of sess.target.families) {
    ins_str(sym.target_family, family);
    if (family === "windows") {
      ins_none(sym.windows);
    } else if (family === "unix") {
      ins_none(sym.unix);
    }
  }

  // `target_has_atomic*`
  const layout_r = sess.target.parse_data_layout();
  if (layout_r.$ === "Err") {
    const err = layout_r._0;
    return sess.dcx().emit_fatal({ into_diag: (dcx, level) => TargetDataLayoutError_into_diag(err, dcx, level) });
  }
  const layout = layout_r._0;
  let has_atomic = false;
  for (const [i, align] of [
    [8, layout.i8_align],
    [16, layout.i16_align],
    [32, layout.i32_align],
    [64, layout.i64_align],
    [128, layout.i128_align],
  ] as [number, Align][]) {
    if (i >= sess.target.min_atomic_width_() && i <= sess.target.max_atomic_width_()) {
      if (!has_atomic) {
        has_atomic = true;
        if (sess.is_nightly_build()) {
          if (sess.target.atomic_cas) {
            ins_none(sym.target_has_atomic);
          }
          ins_none(sym.target_has_atomic_load_store);
        }
      }
      const insert_atomic = (sym_: Symbol, align: Align): void => {
        if (sess.target.atomic_cas) {
          ins_sym(sym.target_has_atomic, sym_);
        }
        if (align.bits() === i) {
          ins_sym(sym.target_has_atomic_primitive_alignment, sym_);
        }
        ins_sym(sym.target_has_atomic_load_store, sym_);
      };
      insert_atomic(sym.integer(i), align);
      if (sess.target.pointer_width === i) {
        insert_atomic(sym.ptr, layout.pointer_align().abi);
      }
    }
  }

  if (!sess.target.singlethread_(sess.internal_target_features)) {
    ins_none(sym.target_has_threads);
  }

  ins_sym(sym.target_os, spec.Os.desc_symbol(sess.target.os));
  ins_sym(sym.target_pointer_width, sym.integer(sess.target.pointer_width));

  if (sess.opts.unstable_opts.has_thread_local ?? sess.target.has_thread_local) {
    ins_none(sym.target_thread_local);
  }

  ins_sym(sym.target_vendor, sess.target.vendor_symbol());

  // If the user wants a test runner, then add the test cfg.
  if (sess.is_test_crate()) {
    ins_none(sym.test);
  }

  if (sess.ub_checks()) {
    ins_none(sym.ub_checks);
  }

  if (sess.contract_checks()) {
    ins_none(sym.contract_checks);
  }

  return ret;
}
