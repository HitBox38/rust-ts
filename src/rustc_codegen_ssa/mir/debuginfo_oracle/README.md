# debuginfo_oracle: fixtures of mir/debuginfo.test.ts (lane ssa-debuginfo)

- `debuginfo.rs`: a `no_core` crate. Its `#[no_mangle]` fns cover the naming paths of `debug_introduce_local` (a scalar
  argument, a `ScalarPair` argument by value (`%p.0`/`%p.1`), an indirect argument, `&self`, an unnamed argument (`%_1`),
  an argument moved to an alloca because it is borrowed (`%0` + `%x = alloca`), locals that copy propagation folds into
  the argument), closures inside a fn and inside an `impl` method, and one fn (`types`) whose arguments have the types
  `compute_debuginfo_type_name` is checked on (generics, references, raw pointers, `dyn` with an auto trait and with an
  associated type, C-like and data-carrying enums, a nested module, fn pointers, arrays, slices, `str`, `()`, const
  generics of `usize`, `i8` (negative) and `bool`).
- `gnu.ll`, `gnu-g.ll`, `msvc-g.ll`: the pinned nightly's IR for it, unmodified. Made from inside this directory (so the
  IR holds no absolute path; `--remap-path-prefix` makes the debuginfo's `directory:` `.`):

```
C=(--edition=2021 -Copt-level=0 -Cno-prepopulate-passes --emit=llvm-ir "--remap-path-prefix=$PWD=.")
RUSTC_ICE=0 rustc +nightly-2026-10-11 --target x86_64-unknown-linux-gnu $C -o gnu.ll debuginfo.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 --target x86_64-unknown-linux-gnu $C -Cdebuginfo=2 -o gnu-g.ll debuginfo.rs
RUSTC_ICE=0 rustc +nightly-2026-10-11 --target x86_64-pc-windows-msvc $C -Cdebuginfo=2 -o msvc-g.ll debuginfo.rs
```

(zsh; in bash expand the array as `"${C[@]}"`.)

The test reads, per fn, the parameter names of the `define` line, the named allocas, the `#dbg_declare` records with
their `!DILocalVariable` and `!DIExpression`, and all `name: "..."` fields; it compares them with what the port's
`codegen_mir` gives over a mock backend. The test itself runs no rustc and reads no environment variable. Regenerate all
three files with the commands above if the fixture changes.
