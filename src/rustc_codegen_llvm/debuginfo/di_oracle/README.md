# di_oracle: fixtures of debuginfo/mod.test.ts (lane cg-di-a)

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

(zsh; in bash expand the array as `"${C[@]}"`.) With the pinned toolchain present, the test re-makes all three the same way
(into a scratch directory) and requires them unchanged.
