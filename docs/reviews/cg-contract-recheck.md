APPROVE WITH NITS

# Re-check: cg-contract review fixes (M7)

- **Reviewed:** `git diff b5c3e429..658e1a5b` on `t3/llvm-codegen-contract`: commits `277ebfa4` (`Session::fewer_names`),
  `a915f565` (F1, F2, N3, N4, tests) and `658e1a5b` (handoff). The first review was `docs/reviews/cg-contract.md` (`469d1ef9`).
- **Reviewer:** independent re-check, read-only on code. Pin `6f5da406b56`. Upstream read from `$RUST_TS_DATA/rust`.
- **Result:** F1 and F2 are fixed. Neither has a remaining blocking defect. `fewer_names` is faithful. Integration with `integ-w52`
  needs a two-line import fix, given in item 4. The six nits below are small, and root can fold them into the fill lanes' briefs.

## Evidence (run on `658e1a5b`, AC power, `RUSTC_ICE=0`, `RUST_TS_REQUIRE_PROBES=1`, `RUSTUP_AUTO_INSTALL=0`)
- `bunx tsc --noEmit -p .`: clean (exit 0).
- `bun scripts/coverage.ts --check`: `markers ok (25906, 32 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311; library 735; llvm 174)`.
- `bun test ./src/std/result.test.ts ./src/rustc_codegen_llvm/`: **41 pass, 0 fail** (741 expects, 5 files).
- `bun test ./src/rustc_session/`: **112 pass, 0 fail**.
- Sample difftests, `RUST_TS_AGENT=cg-recheck`, `--sample 200 --jobs 6`:
  - `mono-ui`: **200/200 MATCH**, run `20261111-221254-cg-recheck-tlmz`.
  - `mir-o2`: **199/200 MATCH, 1 DIFF**, run `20261111-221340-cg-recheck-cgk6`.
    - The DIFF is `tests/ui/simd/shuffle.rs#noopt`, and it is not in `harness/baseline/mir-o2.txt`.
    - First difference, at line 17: the oracle prints an ICE backtrace frame and the port prints `note: rust-ts prints the JS stack, not a Rust backtrace`.
    - This lane did not cause it: nothing outside `src/rustc_codegen_llvm/` imports the crate.

## 1. F1: inherent methods before trait methods. Fixed.
- **The list is complete.** I parsed every `impl` block of the crate at the pin and every trait in
  `rustc_codegen_ssa/src/traits/`. I then crossed each type's inherent names with all trait method names:
  - **`GenericBuilder` (18 inherent methods):** exactly 10 clash with `BuilderMethods`: `append_block` :101, `trunc` :112, `bitcast` :116,
    `ret_void` :120, `ret` :124, `build` :130, `inbounds_gep` :156, `store` :175, `load` :185 and `va_arg` :1875. This matches the
    lane's list.
  - **`Builder` (32 inherent methods, in builder.rs, intrinsic.rs:141 `black_box` and debuginfo/mod.rs:122 `get_dbg_loc`):** no clash.
  - **`SBuilder::call` (:62):** shares a name with `BuilderMethods::call`. `SBuilder` implements no `BuilderMethods`, so no
    resolution conflict exists. The TS `SBuilder` is a separate subclass, so there is no shadowing either.
  - **`GenericCx`:** `const_null` / `const_struct` (common.rs:168, :172) clash with `ConstCodegenMethods`. That trait is implemented
    only for `CodegenCx` (common.rs:265).
  - **`SimpleCx::val_ty` (context.rs:873, `impl<'ll> SimpleCx<'ll>`):** clashes with `BaseTypeCodegenMethods::val_ty`, which is
    implemented for all `GenericCx<CX>` (type_.rs:188). On a `CodegenCx`, the trait method is found at autoderef step 0, so it
    wins. The lane is right not to forward `val_ty_inherent` through `SimpleCxDeref`.
  - **`CodegenCx::get_static` (consts.rs:349):** shares a name with `StaticBuilderMethods::get_static`, which is implemented on
    `Builder`, not on the cx. `bx.get_static` therefore resolves to the trait method at step 0. In TS, `Builder` has its own
    `get_static`, so the deref forwarder does not shadow it.
- **Only `load` and `store` differ in body.** I diffed the bodies:
  - `load` :185 against :691: the trait method adds `align.min(...max_reliable_alignment())`.
  - `store` :175 against :872: the trait method calls `store_with_flags(.., MemFlags::empty())`, which clamps the same way at :887.
    With empty flags, its other branches do nothing.
  - The other eight bodies are identical:
    - `append_block` differs only in `cx.llcx()` against `cx.llcx`;
    - `build` differs only in `Self::with_cx` against `Builder::with_cx`;
    - `trunc` :1012, `bitcast` :1127, `inbounds_gep` :973, `va_arg` :1260, `ret_void` and `ret` are textually equal.
  - `const_null` and `const_struct` (`self.llcx()` against `self.llcx`) and `val_ty` are identical too.
- **Call sites.** No TS crate code calls these names yet, since all bodies are stubs. I checked the rule against upstream sites:
  - **va_arg.rs:55, :66, :182, :236, :251:** every fn there takes `bx: &mut Builder<'_, 'll, 'tcx>`, so these resolve to the inherent
    method (`_inherent` in TS).
  - **intrinsic.rs:389, :621, :622, :978:** these are inside `impl IntrinsicCallBuilderMethods for Builder`, on `self`, so they resolve
    to the inherent method.
  - **intrinsic.rs:1503:** inside `codegen_msvc_try(bx: &mut Builder ..)`, so inherent.
  - **intrinsic.rs:2482, :2484:** inside `generic_simd_intrinsic`, on a concrete `bx`, so inherent.
  - **abi.rs:255, :293, :312 and intrinsic.rs:278, :646, :2166, asm.rs:404:** these are `OperandValue::store`, generic ssa code,
    which calls the trait `store`.
  - **abi.rs:321, :342:** these are `ArgAbiExt::store`, a different method.
  - The rule as stated holds at every one of these sites.
  - The sketch's `bx.load_inherent(..)` and `Builder.build_inherent(cx, llbb)` (typed `Builder`) follow it.
- **`rustc_codegen_ssa` is unaffected.** No file outside `src/rustc_codegen_llvm/` uses an `_inherent` name. ssa's generic code
  reaches `Builder.prototype.load` / `store` (the trait stubs, builder.ts:618, :668).

## 2. F2: the cross-lane surface. Fixed. One gap within the scanner's scope (N1), and later waves rely on wave 41 landing first (N5).
- **I wrote my own scanner and did not reuse the lane's.**
  - It collects every fn definition of the crate except `llvm/` (whose FFI is already ported).
  - It collects every `name(` call in the five wave-41 lanes' files: context/common, type_/type_of/declare/attributes/callee/mono_item/base,
    builder/allocator, abi/consts and intrinsic.
  - It keeps callees that are defined only in another lane's file, leaving out names of `rustc_codegen_ssa` trait methods, which
    were already stubbed.
  - It checks that the owner's TS file declares the member, either by name or as `<name>_inherent`.
- **Result:** 123 callee names. 117 are present: all of them typed stubs or ported accessors in the owner's file, with the owner
  lane named in the message.
  - Three of the 6 misses are scanner noise:
    - `llvm::add_global` and `llvm::set_visibility` are in `llvm/mod.rs`, already ported;
    - `next()` at abi.rs:312 is a local closure.
  - The other three (`insert_element`, `const_get_elt`, `type_scalable_vector`) are all called from `generic_simd_intrinsic`
    (intrinsic.rs:2047-3473). That fn is cg-intrinsic-b's, so the lane's scope rightly leaves it out (see N5).
- **Hand check of 20 sites:**
  - `apply_to_llfn` (abi.rs:121 to attributes.rs:29);
  - `type_ix` (abi.rs:142);
  - `llfn` (abi.rs:305, ported, body `LLVMGetBasicBlockParent(self.llbb())` matches builder.rs:1586);
  - `declare_global` (consts.rs:222);
  - `get_declared_value` (consts.rs:388, returns `Value | undefined`, matching `Option<&Value>`);
  - `const_alloc_to_llvm` (common.rs:229);
  - `set_struct_body` (consts.rs:735);
  - `create_metadata` (builder.rs:2040, `Uint8Array` to `Metadata`);
  - `get_intrinsic` (builder.rs:1887, returns `[Type, Value]`);
  - `call_intrinsic` (intrinsic.rs:1027);
  - `get_dllimport` (callee.rs:41, `DllImport | undefined`);
  - `statics_to_rauw` (base.rs:205, ported, returns the `RefCell<Vec>` as the array);
  - `objc_abi_version` (base.rs:160);
  - `raw` (context.rs:209, ported);
  - `frame_pointer_type_attr` (context.rs:1047);
  - `immediate_llvm_type` (abi.rs:377);
  - `struct_element_types` (intrinsic.rs:1113);
  - `bundle` / `cleanuppad` (builder.rs:1488, :1334, ported, matching common.rs:119-125);
  - `md_node_in_context` (builder.rs:355);
  - `llcx` (builder.rs:108, ported as `this.deref().borrow().llcx`, matching type_.rs:152 `(**self).borrow().llcx`).

  Each has its stub or port in the owner's file. The parameter and return types match upstream under the ssa-contract number and
  bigint decisions.
- **The 9 removed candidates are real false positives.**
  - `ArgAbiExt::store`: the cross-lane sites are all `OperandValue::store`, as listed above.
  - `SBuilder::call`: the only `SBuilder` is allocator.rs:152, which is cg-builder's own file. The cross-lane `.call(` sites are on
    `Builder`.
  - `codegen`: intrinsic.rs:1756 calls a closure parameter.
  - `as_ref` / `insert`: these are `Option::as_ref`, `OperandBundleBox::as_ref` (ported) and map or vector inserts (type_of.rs:245,
    :278, builder.rs:370).
  - `TargetFeatureFoldStrength::as_str`: the attributes.rs sites are `Symbol::as_str`.
  - `SimpleCx::val_ty`: no cross-lane call is on a `SimpleCx`. allocator.rs, attributes.rs and declare.rs take `&SimpleCx` but
    never call `val_ty`.
- **The extension traits are faithful and pollute nothing.**
  - `LayoutLlvmExt` (type_of.ts), `LlvmType` for `Reg` / `CastTarget` and `FnAbiLlvmExt` (abi.ts) use the miri C2 form:
    `declare module` plus prototype assignments, as in `src/miri/helpers.ts:258`.
  - No other file in `src/` declares or uses `llvm_type`, `immediate_llvm_type`, `scalar_pair_element_llvm_type`, `ptr_to_llvm_type`,
    `llvm_cconv`, `apply_attrs_llfn` or `apply_attrs_callsite`.
  - No other module augments `rustc_abi` or `rustc_target` classes.
  - The prototypes are written only when `rustc_codegen_llvm` loads, and nothing loads it yet.
- **The fill-lane sketch** (`skeleton.test.ts:151`) typechecks under tsc, and its test passes. Every call stops in a stub that names
  its owner lane, but two steps stop in an argument's stub before reaching their target (N3).
- **`FullCx`** has 30 fields in upstream order, the same as context.rs. `type_vector(count: number)` agrees with its callers, because
  `Size::bytes()` and `simd_size_and_type` are `number` in the port.

## 3. `Session::fewer_names`: faithful
- `src/rustc_session/session.ts:861` (at `658e1a5b`) against session.rs:1060:
  - the `Some(fewer_names)` arm comes first;
  - the `else` arm checks `output_types.contains_key` for `LlvmAssembly`, then `Bitcode`, then
    `sanitizers().intersects(ADDRESS | MEMORY)`, written as a nonzero `&`, the same way as `emit_lifetime_markers` above it;
  - it returns `!more_names`.
- The upstream comment is kept. The method sits between `lto` and `unstable_options` (:1072), in upstream order.
- `unstable_opts.fewer_names` is `boolean | undefined`, as generated.

## 4. Trial merge with `integ-w52` (`a852aef2`): two errors
- **How I ran it:** in `.data/integ-w52`, `git merge --no-commit --no-ff 658e1a5b`.
  - The merge applied with no conflicts; `session.ts` auto-merged.
  - I aborted the merge afterwards. The worktree is back at `a852aef2`: clean, no `MERGE_HEAD`, nothing committed.
- **`bunx tsc --noEmit -p .` on the merge: 2 errors, both from fixers-52 moving the pointer-auth types:**
  ```
  src/rustc_codegen_llvm/common.ts(11,15): error TS2459: Module '"../rustc_codegen_ssa/traits/misc.ts"' declares 'PointerAuthSchema' locally, but it is not exported.
  src/rustc_codegen_llvm/context.ts(40,35): error TS2459: Module '"../rustc_codegen_ssa/traits/misc.ts"' declares 'PointerAuthSchema' locally, but it is not exported.
  ```
- **Minimal fix for root at integration** (it mirrors upstream's `use rustc_session::PointerAuthSchema` in common.rs:18 and
  context.rs:27):
  - `src/rustc_codegen_llvm/common.ts:11`: change
    `import type { PointerAuthSchema } from "../rustc_codegen_ssa/traits/misc.ts";` to
    `import type { PointerAuthSchema } from "../rustc_session/session.ts";`
  - `src/rustc_codegen_llvm/context.ts:40`: change
    `import type { MiscCodegenMethods, PointerAuthSchema } from "../rustc_codegen_ssa/traits/misc.ts";` to
    `import type { MiscCodegenMethods } from "../rustc_codegen_ssa/traits/misc.ts";`
  - Then add `PointerAuthSchema` to context.ts's existing `import type { Session } from "../rustc_session/session.ts";` (line 59
    after the merge), making it `import type { PointerAuthSchema, Session } from "../rustc_session/session.ts";`.
- **Verified on the uncommitted merge**, with the fix as a separate import line:
  - `bunx tsc` is clean;
  - `bun test ./src/std/result.test.ts ./src/rustc_codegen_llvm/` gives **41 pass, 0 fail**;
  - `coverage.ts --check --offline` gives `markers ok (25909, ...)`.
- No other file of the crate refers to the removed stand-in.

## Nits
- **N1 (F2, one missed callee). `CguCoverageContext::new` has no stub.**
  - Upstream context.rs:665, inside `CodegenCx::new` (cg-context), reads
    `tcx.sess.instrument_coverage().then(coverageinfo::CguCoverageContext::new)`.
  - The callee is passed as a fn item, not called with `(`, so a call-site scanner misses it.
  - `coverageinfo/mod.ts:3` and `:11` say that `FullCx.coverage_cx` "stays `None`" / "is always `None`". That invites cg-context to
    write `undefined` under `-Cinstrument-coverage`, which would be a guessed value.
  - **Fix:** add a typed stub in `coverageinfo/mod.ts`, for example
    `export function CguCoverageContext_new(): CguCoverageContext { return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/coverageinfo/mod.rs CguCoverageContext::new"); }`,
    and reword the comment. Otherwise, root tells cg-context in its brief to stop when `sess.instrument_coverage()`.
- **N2. The stubs of each inherent/trait pair stop with the same message.**
  - Pairs:
    - builder.ts:99 / :293 (`append_block`), :129 / :288 (`build`), :141 / :669 (`store`), :147 / :619 (`load`), :105 / :719
      (`trunc`), :163 / :864 (`va_arg`) and the rest of the 10;
    - common.ts:104 / :146 (`const_null`) and :110 / :236 (`const_struct`);
    - context.ts:303 / type_.ts:300 (`val_ty`).
  - Until the bodies are filled, a call that reaches the wrong member of a pair cannot be told apart in an UNPORTED message.
    `skeleton.test.ts:255-256` asserts the same regex for `load_inherent` and `load`.
  - `load` and `store` are the two pairs where this matters.
  - **Suggestion:** give each `_inherent` stub its own text, such as `builder.rs load (inherent, :185)`, so the test can tell
    the two apart.
- **N3. Two sketch steps never reach their target.**
  - `skeleton.test.ts:168` `cx.declare_global("g", cx.type_i8())` and `:173` `bx.load_inherent(cx.type_i8(), ..)` stop in
    `type_i8`, because the argument is evaluated first. The expectations at :233 and :238 encode `type_i8`.
  - No test reaches `declare_global`'s stub.
  - **Fix:** pass `undefined as never` for the type argument.
- **N4. The call sites given for inherent `store` are wrong.**
  - builder.ts:28's header lists abi.rs among the files with `bx.load(..)` sites. Handoff :111 says `store_inherent` is "called from
    cg-abi-consts".
  - Upstream abi.rs and consts.rs contain no `load` or `store` call on a `Builder`:
    - abi.rs:255, :293 and :312 are `OperandValue::store`, which reaches the trait `store` through ssa;
    - abi.rs:321 and :342 are `ArgAbiExt::store`.
  - A cg-abi-consts filler who trusts the text could write `store_inherent` where upstream reaches the trait method, which clamps the
    alignment.
  - **Fix:** drop abi.rs from the header's list and cg-abi-consts from the "called from" list. cg-intrinsic-a (intrinsic.rs:389) is
    the real caller.
- **N5 (for root's wave ordering). Later lanes' callers were not scanned.**
  - The scanner covers wave-41 callers only. Callees of the wave-42 to 44 lanes and of `generic_simd_intrinsic` that live in
    wave-41 files have no stubs. My name-based scan finds these; a few may be noise:
    - `insert_element` (builder.rs:1740), `vector_reduce_*` (builder.rs:1758-1810, reached through the `arith_red!` / `minmax_red!`
      macros), `const_get_elt` (common.rs:157) and `type_scalable_vector` (type_.rs:71), called from `generic_simd_intrinsic` and
      asm.rs;
    - `phi` (builder.rs:1909), from va_arg.rs;
    - `add_func`, `get_functions`, `bytes_in_context`, `llvm_type_ptr`, `has_string_attr`, `remove_string_attr_from_llfn`,
      `iter_globals` and `iter_global_aliases`, from back/write.rs;
    - `callbr`, `alloc_to_backend` and `add_compiler_used_global`, from asm.rs;
    - `size_and_align_of` and `spanned_size_and_align_of`, from debuginfo.
  - None of this blocks: the wave-41 lanes port those files whole, and that happens before the later waves.
  - If root starts a wave-42 to 44 lane before wave 41 lands, those callees need stubs first.
- **N6. Stale test count in the handoff.** docs/handoff/cg-contract.md:185 still says "38 pass ... (715 expects)". After the fixes it
  is 41 pass and 741 expects; :409 already says 41.

## PORT decisions root should record
1. **Inherent before trait (F1).**
   - Rule: an inherent method whose name is also a trait method of the same type is named `<name>_inherent`.
   - A rustc_codegen_llvm call site uses the `_inherent` name where upstream resolution picks the inherent method: a method call or
     a `Type::name` path on a concrete `Builder` / `SBuilder` / `GenericBuilder` / `GenericCx` / `SimpleCx`. That includes the bodies
     of `impl BuilderMethods for Builder`.
   - Generic code and `BuilderMethods::name(bx, ..)` keep the trait name.
   - The rule covers 13 names at the pin: the 10 `GenericBuilder` names, `GenericCx::const_null` / `const_struct` and
     `SimpleCx::val_ty`. Of these, only `load` and `store` differ in body: the trait methods clamp the alignment.
   - `build_inherent` is a static with a `this` constructor type, so it returns the subclass.
2. **Extension traits on foreign classes** use the miri C2 form: `declare module` augmentations of the foreign class plus prototype
   assignments.
   - `LayoutLlvmExt` goes on `TyAndLayout`, `LlvmType` on `Reg` / `CastTarget`, and `FnAbiLlvmExt` on `FnAbi`.
   - Each member is collision-checked across `src/`.
3. **The cross-lane surface.**
   - Each callee of another fill lane is a typed stub in its owner's file, with no marker, stopping with
     `"<lane>: compiler/rustc_codegen_llvm/src/<file> <fn>"`.
   - Out-of-M7 modules use `"excluded (plan-m7 D18): ..."`.
   - The new skeleton files are `type_of.ts`, `declare.ts`, `attributes.ts`, `callee.ts`, `va_arg.ts`, `debuginfo/metadata.ts`,
     `typetree.ts`, `builder/autodiff.ts` and `builder/gpu_offload.ts`.
4. **Deref coercion at calls.** A `&SimpleCx` parameter that upstream passes a `CodegenCx` (attributes.rs, `declare_simple_fn`)
   receives `cx.scx`. `SCx` fields are read through the type_.rs accessors (`cx.llcx()`), not forwarded.
5. **Number types.**
   - `type_ix(num_bits)` and `type_vector(count)` take `number`, which agrees with `Size::bytes()` and `simd_size_and_type`.
   - `get_const_i32(n: u64)` takes `bigint`, following ssa-contract decision 6.
6. **`Session::fewer_names`** is ported in `rustc_session/session.ts` (session.rs:1060), as root's exception to PORTING §1.
7. **Load order.** `rustc_codegen_llvm/abi.ts` imports `rustc_target` through `rustc_target/lib.ts` first. Entered from
   `callconv/mod.ts` instead, `spec/json.ts` reads `spec/mod.ts`'s bindings before they exist.
8. **Integration (item 4).** `PointerAuthSchema` is imported from `rustc_session/session.ts` (upstream `rustc_session::PointerAuthSchema`)
   in common.ts and context.ts, once fixers-52 is merged.
