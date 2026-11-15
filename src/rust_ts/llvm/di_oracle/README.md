# di_oracle: fixtures of di_builder.oracle.test.ts (lane llir-di)

- `gdb.rs`: a copy of `src/rustc_codegen_llvm/debuginfo/di_oracle/gdb.rs` (cg-di-a's `no_core` executable: a `start` lang item,
  generic over its return type, and `main`).
- `aarch64-apple-darwin.gdb-g.ll` (`-Cdebuginfo=2` on the host) and `x86_64-unknown-linux-gnu.gdb-g1.ll` (`-Cdebuginfo=1`): the
  pinned nightly's IR, unmodified. cg-di-a's `x86_64-unknown-linux-gnu.gdb-g.ll` is the third case the test reads. Made from
  inside this directory, so the IR holds no absolute path:

```
C=(--edition=2021 -Copt-level=0 -Cno-prepopulate-passes -Ccodegen-units=1 --emit=llvm-ir "--remap-path-prefix=$PWD=." --crate-type bin)
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target aarch64-apple-darwin -Cdebuginfo=2 -o aarch64-apple-darwin.gdb-g.ll gdb.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 $C --target x86_64-unknown-linux-gnu -Cdebuginfo=1 -o x86_64-unknown-linux-gnu.gdb-g1.ll gdb.rs
```

(zsh; in bash expand the array as `"${C[@]}"`.) With the pinned toolchain present, the test re-makes both the same way and requires
them unchanged.
