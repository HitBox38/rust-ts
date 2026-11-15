# di_oracle: fixtures of debuginfo/mod.test.ts (lanes cg-di-a, cg-di-b)

- `names.rs`: a `no_core` lib. Its `#[no_mangle]` fns cover the value names `set_var_name` gives without `-g` (with
  rustc_codegen_ssa's `debug_introduce_local`): scalar arguments (`%x`, `%_unused`), a `ScalarPair` argument (`%p.0`/`%p.1`),
  an indirect argument (`%b`), `&self`/`&dyn` arguments (`%self`, `%t.0`/`%t.1`), an argument moved to an alloca because it
  is borrowed (`%0` + `%x = alloca`), named allocas (`%arr`, `%acc`), named temporaries (`%first`, `%last`, `%_0`), a
  method, a generic instance, a `static` (`build_global_var_di_node`) and a vtable (`apply_vcall_visibility_metadata`,
  `create_vtable_debuginfo`).
- `gdb.rs`: a `no_core` executable (a `start` lang item and `main`), for the `.debug_gdb_scripts` helpers (gdb.rs) and the
  debuginfo module flags (`CodegenUnitDebugContext::new`).
- `x86_64-unknown-linux-gnu.ll` (names.rs, `-Cdebuginfo=0`), `x86_64-unknown-linux-gnu.gdb.ll` (gdb.rs, `-Cdebuginfo=0`) and
  `x86_64-unknown-linux-gnu.gdb-g.ll` (gdb.rs, `-Cdebuginfo=2`): the pinned nightly's IR, unmodified. Made from inside this
  directory (so the IR holds no absolute path; `--remap-path-prefix` makes the debuginfo's `directory:` `.`):

```
C=(--target x86_64-unknown-linux-gnu --edition=2021 -Copt-level=0 -Cno-prepopulate-passes -Ccodegen-units=1 --emit=llvm-ir "--remap-path-prefix=$PWD=.")
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --crate-type lib -Cdebuginfo=0 -o x86_64-unknown-linux-gnu.ll names.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --crate-type bin -Cdebuginfo=0 -o x86_64-unknown-linux-gnu.gdb.ll gdb.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --crate-type bin -Cdebuginfo=2 -o x86_64-unknown-linux-gnu.gdb-g.ll gdb.rs
```

Lane cg-di-b added:

- `types.rs`: a `no_core` lib whose `#[no_mangle]` fns take one of each kind of type that metadata.rs and metadata/* describe:
  structs (field visibility in the root and in a nested module, a tuple struct, a unit struct, a generic struct, a recursive
  struct), enums (C-like, tagged, niche with an untagged range, single-variant, empty, generic `Option`, a `#[repr(u128)]` tag,
  an expanding recursive `Rec<T>`), a union, an extern type, slices, `str`, `&dyn`, raw and fn pointers, an array, `!`, `()`,
  every basic type (f16/f128 included), a closure, a static, a vtable, and a fn returning `impl Copy` that is itself (the
  `<recur_type>` marker). No coroutine: `no_core` coroutines need `ManuallyDrop`/`MaybeUninit` lang items this file could not
  get past the union field check; the gate's `-g` coroutine cases cover them.
- `x86_64-unknown-linux-gnu.types-g2.ll`, `x86_64-unknown-linux-gnu.types-g1.ll` (types.rs, `-Cdebuginfo=2` / `=1`) and
  `x86_64-pc-windows-msvc.types-g2.ll` (types.rs, `-Cdebuginfo=2`, CPP-like debuginfo), made the same way:

```
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target x86_64-unknown-linux-gnu --crate-type lib -Cdebuginfo=2 -o x86_64-unknown-linux-gnu.types-g2.ll types.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target x86_64-unknown-linux-gnu --crate-type lib -Cdebuginfo=1 -o x86_64-unknown-linux-gnu.types-g1.ll types.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target x86_64-pc-windows-msvc --crate-type lib -Cdebuginfo=2 -o x86_64-pc-windows-msvc.types-g2.ll types.rs
```

Lane fixers-60 (review cg-di-b N5) added to types.rs `no_principal`, a vtable for `&dyn Sync` (a `dyn` with no principal trait:
`UniqueTypeId::VTableTy(_, None)`, named `<u32 as _>::{vtable_type}`), re-made the three files above, and added
`x86_64-unknown-linux-gnu.types-g2-lines.ll` (types.rs, `-Cdebuginfo=2 -Zdebug-info-type-line-numbers`: the types' `line:`):

```
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target x86_64-unknown-linux-gnu --crate-type lib -Cdebuginfo=2 -Zdebug-info-type-line-numbers -o x86_64-unknown-linux-gnu.types-g2-lines.ll types.rs
```

(here `C` without its `--target`, which each command gives.) (zsh; in bash expand the array as `"${C[@]}"`.) With the pinned
toolchain present, the test re-makes all seven the same way (into a scratch directory) and requires them unchanged.
