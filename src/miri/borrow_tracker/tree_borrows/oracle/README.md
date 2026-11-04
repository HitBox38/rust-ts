# Tree Borrows oracle fixtures (lane miri-tb-b)

Small Rust programs and what the oracle Miri prints for them. `<name>.stderr` is the exact stderr of the isolated Miri at
the pin (`UPSTREAM.json`), `<name>.exit` its exit code. They check `tree_borrows/diagnostics.ts` byte for byte:
`diagnostics.test.ts` compares the tree printing with `print_state.stderr` now. The error texts on real trees need lane
miri-tb-a's code: `tree_scenarios.test.ts`.

Regenerate from the repo root (a path in the output is the path given here, so keep it relative):

```sh
D=$RUST_TS_DATA
M=$D/rustup-miri/toolchains/nightly-2026-10-11-aarch64-apple-darwin/bin/miri
for f in src/miri/borrow_tracker/tree_borrows/oracle/*.rs; do
  env -i HOME=$HOME PATH=$PATH RUSTUP_HOME=$D/rustup-miri CARGO_HOME=$D/cargo-miri \
    "$M" "$f" --sysroot "$D/miri-sysroot" --target x86_64-unknown-linux-gnu --edition 2021 \
    -Zmiri-tree-borrows -Zmiri-provenance-gc=0 2> "${f%.rs}.stderr"
  echo $? > "${f%.rs}.exit"
done
```

No backtrace in these reaches into std, so no fixture holds an absolute path.
