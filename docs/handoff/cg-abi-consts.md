# Handoff: cg-abi-consts (M7, plan-m7 wave 41, wave 40n, fill lane): rustc_codegen_llvm `abi.rs` and `consts.rs`

Branch `t3/12845cdc` (from `51dfe33c`; no merges). Commits: see the end.

## Summary
- **`abi.rs` is ported in full (26/26), and `consts.rs` too (21/21).** Both are in upstream order, with markers. All 20
  cg-abi-consts stubs cg-contract left are replaced, and the fns the skeleton lacked are added in their upstream places:
  - abi.rs: the `ArgAttributesExt` trait and impl, `get_attrs` with its three attribute tables, the `ArgAbiExt` trait and impl
    (`store`, `store_fn_arg`), the three trait declarations (`LlvmType`, `ArgAbiExt`, `FnAbiLlvmExt`);
  - consts.rs: `append_chunks_of_init_and_uninit_bytes` (nested in `const_alloc_to_llvm`, where upstream has it),
    `codegen_static_initializer`, `set_global_alignment`, `check_and_apply_linkage`, `get_static_inner`, `codegen_static_item`,
    `add_used_global`, `add_compiler_used_global`, and the four Objective-C helpers.
- **Checked against the oracle** (`abi_consts.test.ts`, below). The checks cover:
  - fn signatures for 26 ABI shapes at `-O0` (23 at `-O1`; 3 stop in the IR model, listed below);
  - the attributes `apply_attrs_callsite` puts on 7 call sites;
  - `store_fn_arg` for 3 spilled-argument shapes;
  - all 24 global lines of a statics fixture, byte for byte and in order.
- **Not registered.** Nothing outside `src/rustc_codegen_llvm/` imports the crate. Both samples are unchanged at 200/200.

## Files touched
| file | what |
|---|---|
| `src/rustc_codegen_llvm/abi.ts` | the port (was cg-contract's skeleton) |
| `src/rustc_codegen_llvm/consts.ts` | the port (was cg-contract's skeleton) |
| `src/rustc_codegen_llvm/abi_consts.test.ts` | new: oracle tests (Evidence) |
| `src/rustc_codegen_llvm/abi_consts_test/{sigs.rs, statics.rs}` | new: the fixtures |
| `src/rustc_codegen_llvm/skeleton.test.ts` | cg-contract's file; its handoff asks fill lanes to update their own lines. This lane changed only these: <br>- removed the `codegen_static` / `get_param` stops; <br>- removed `"cg-abi-consts": 20` from the count table and added `"ssa-block": 1` (below); <br>- set the sketch's `fn_abi.llvm_type(cx)` expectation to the `TypeError` the field-less marker `FnAbi` now gives (`this.ret.mode`). <br>**Merge note for root:** the other wave-40n lanes edit the same table. |

`.env.local` was copied for setup. It is gitignored.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/abi.rs`: **26/26 ported**.
- `bun scripts/coverage.ts --missing compiler/rustc_codegen_llvm/src/consts.rs`: **21/21 ported**.
- `bun scripts/coverage.ts --check --offline`: `markers ok (26406, 43 of them in compiler/rustc_llvm/llvm-wrapper; vendor 5311;
  library 744; llvm 390)`.

## Evidence
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test ./src/rustc_codegen_llvm/ ./src/std/result.test.ts`: **84 pass, 0 fail** (10 files).
- **`abi_consts.test.ts`** (6 tests).
  - **How it runs.** Each fixture is compiled twice:
    - by the pinned rustc: `--target x86_64-unknown-linux-gnu --emit=llvm-ir -Cno-prepopulate-passes -Ccodegen-units=1`;
    - in-process, by the port's front end with the same flags, on a real `TyCtxt` (context.test.ts's pattern).
  - The port builds the same items through this lane's code over the IR model. It prints them with `printModule` and compares
    them with the oracle's text.
  - **fn signatures** (`sigs.rs`, `-Copt-level=0` and `=1`). For each `#[no_mangle]` fn the test runs `fn_abi_of_instance`,
    then `llvm_type` / `llvm_cconv`, then a declaration, then `apply_attrs_llfn(cx, llfn, None)`. It compares, against the
    oracle's `define` line:
    - the calling convention;
    - the return type and its attributes;
    - each parameter's type and attributes.
  - Attributes compare as sets, because the IR model prints them in insertion order (cg-types-attrs's known gap). Shapes
    covered:
    - scalars with `zeroext` / `signext`, `i1`, `i128`, `f64` / `f32`;
    - `&T`, `&mut T` and `Option<&T>`, i.e. `align`, `noalias`, `nonnull`, `readonly`, `noundef`, `nofree`,
      `dereferenceable(_or_null)` and `captures(..)` at `-O1`;
    - raw pointers, `&[u8]` and `&str` pairs, a Rust struct pair, a `(u64, bool)` pair;
    - `[u64; 8]`: `sret` plus an indirect argument at `-O0`. At `-O1` it stops (`DeadOnReturn`, below);
    - at `-O1`, the extern "C" `sret` also carries `writable` and `dead_on_unwind`;
    - extern "C" `byval`, `sret`, and three cast targets (`i64`, `{ double, i64 }`, `i24`);
    - a ZST argument (`Ignore`);
    - `win64cc`, `x86_64_sysvcc`, `preserve_mostcc` (`extern "rust-cold"`), and `-> !`.
  - **call sites.** `apply_attrs_callsite` runs on calls built with the IR model, for 7 callees. Each call's attributes equal
    those on the oracle's `call` line in `call_all`: `sret`, `byval`, `align`, `zeroext` / `signext` and `win64cc`. Then each
    call stops in `llir: LLVMRustGetElementTypeArgIndex`, as expected (below).
  - **`store_fn_arg`** (`spill_*`). The test spills into an alloca named after the local, as ssa's `arg_local_refs` does. The
    result equals the first instructions of the oracle's entry block:
    - Pair: two stores and a GEP;
    - Direct: a store;
    - `bool`: a `zext i1` to `i8`, then a store.
  - **statics** (`statics.rs`, `-Zfewer-names=yes` on both sides). The test runs the CGU's items in
    `items_in_deterministic_order`. It calls `predefine_static` and then `codegen_static`, then builds `llvm.used` and does the
    static RAUW, as `base::module_codegen` does.
    - **All 24 global lines equal the oracle's, in order**, after dropping LLVM's `!guid` attachments and numbering the
      anonymous names (LLVM's `anon.<hash>.N` against the model's `@N`).
    - The fixture covers:
      - the rename path (`[4 x i8]` against the declared `i32`);
      - string literals as anonymous `private unnamed_addr constant` allocations;
      - init and uninit chunks (`[3 x i8] undef`);
      - relocations to a static, a private static, a fn, an `extern` static, and an `extern_weak` static through
        `_rust_extern_with_linkage_<crate hash>_WEAK`;
      - `static mut` and `AtomicU32` (no `constant`);
      - `#[used]` (`@llvm.used`), `#[link_section]`, `#[thread_local]`, and a ZST static.
  - **without `-Zfewer-names`.** The first anonymous allocation's name stops in
    `rustc_middle: ... StableHash for Allocation (alloc_to_backend's value name)` (cg-context's `alloc_to_backend`).
  - **I checked that the tests bite.** Each mutation below made the test fail, and I then reverted it:
    - dropping `SExt` in `get_attrs` fails the `c_i16` signature;
    - `alloc.mutability === "Mut"` in `codegen_static_item` fails every `constant` line;
    - swapping the two values of the Pair in `store_fn_arg` fails `spill_pair`.
  - **Test scaffolding** (the test's header lists it):
    - The cx is built over an IR-model module, with `FullCx`'s fields as `CodegenCx::new` sets them. `CodegenCx::new` itself
      needs a target machine from cg-write.
    - Three doubles, restored after each test:
      - a line-by-line copy of `llvm_util::get_version` (llvm_util.rs:469);
      - a line-by-line copy of `Session::direct_access_external_data` (session.rs:1092), spied on attributes.ts's
        `SESSION_STOPS`;
      - `debuginfo::build_global_var_di_node`'s first statement (`if cx.dbg_cx.is_none() { return; }`, metadata.rs:1478).
        Past it, the double stops as cg-di-a's stub does.
    - The CGU's fns are declared with `declare_simple_fn` and entered in `cx.instances`, as `predefine_fn` would. The real
      `predefine_fn` stops in `Session::needs_plt`.
- **Sample difftests** (`RUST_TS_AGENT=cg-abi-consts`, `--sample 200 --jobs 6`, AC power, load about 36):
  - `mono-ui`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140155-cg-abi-consts-sjhw`.
  - `mir-o2`: **200/200 MATCH** (DIFF 0, UNPORTED 0, CRASH 0, TIMEOUT 0), run `20261112-140457-cg-abi-consts-u221`.
- **Not tested against the oracle:**
  - the Objective-C helpers (`get_objc_classref` / `get_objc_selref` / `define_objc_module_info`, Apple targets with
    `#[rustc_objc_*]`);
  - the wasm custom-section branch;
  - the i686 dllimport branch of `check_and_apply_linkage`;
  - `ArgAbiExt::store`'s `Cast` arm, which stops in `store_cast` (below);
  - `static_addr_of`, which rustc_codegen_ssa's const operands reach.

## IR-model stops this lane's code reaches (left as is)
- **`LLVMRustGetElementTypeArgIndex`**: the last step of **every** `apply_attrs_callsite`, so every call that
  `BuilderMethods::call` / `invoke` makes with a `FnAbi` stops there, after its attributes are applied. This blocks wave 41's
  "IR for hello" target. **For the llir lanes**: the wrapper (RustWrapper.cpp:1668) is a switch on the call's intrinsic id. It
  returns `0` for `llvm.arm.ldrex`, `1` for `llvm.arm.strex`, and `-1` for everything else.
- **`LLVMRustCreateRangeAttribute`**: `apply_range_attr` at `-O1` and above. It is reached for a scalar argument or return
  whose valid range is not full and that is not a `bool`: `char`, enums, `NonZero`, and the computed length range of `&[T]`.
- **`LLVMRustCreateAttrNoValue(DeadOnReturn)`**: the model's stop for `AttributeKind::DeadOnReturn`, which `apply_attrs_llfn`
  puts on every `Indirect { mode: Pointer }` argument at `-O1` and above.
- **`LLVMRustConstPtrAuth`** (through `llvm::const_ptr_auth`): `check_and_apply_linkage` with pointer authentication.
- **`LLVMRustSetNoSanitizeAddress` / `LLVMRustSetNoSanitizeHWAddress`**: only under a sanitizer ignorelist. That is
  unreachable: a `SanitizerIgnoreList` is never constructed.
- I checked every other `llvm.*` call in both files against ffi.ts's stub list. All are implemented in the model:
  - `LLVMConstBitCast`, `LLVMConstPointerCast`, `LLVMGetAlignment`, `LLVMSetAlignment`, `LLVMGetInitializer`;
  - `LLVMSetGlobalConstant`, `LLVMSetUnnamedAddress`, `LLVMRustCreateElementTypeAttr`;
  - the `Create*Attr` helpers, and the `llvm/mod.ts` setters.

### For the llir lanes (model gaps, not stops)
- **Calling conventions print as `cc <N>`.** LLVM's printer uses keywords: `preserve_mostcc` (14), `x86_64_sysvcc` (78),
  `win64cc` (79), and so on (llvm/lib/IR/AsmWriter.cpp `PrintCallingConv`, :355 onwards). The gap shows on `define` / `declare`
  and on `call` lines. The test maps the keywords to numbers for now (`CC_KEYWORDS`).
- **Attribute order.** The model prints parameter and return attributes in insertion order. LLVM sorts them, as cg-types-attrs
  noted for function attributes. For example, `get_attrs` adds `align 4 dereferenceable(4) noalias readonly noundef
  captures(..)`, but the oracle prints `noalias nofree noundef readonly align 4 captures(..) dereferenceable(4)`.

## Cross-lane stubs this lane calls (as is)
- **ssa-block**: `rustc_codegen_ssa::mir::store_cast` (mir/block.rs:2587, re-exported by mir/mod.rs) has no TS home in this
  branch. It is a **local typed stub** in abi.ts:
  - its message is `"ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs store_cast"`;
  - it is reached by `ArgAbiExt::store`'s `PassMode::Cast` arm, i.e. a cast-target argument spilled to memory, or a call's
    cast return.
  - **Root:** when ssa-block lands, import `store_cast` from mir/block.ts (or mir/mod.ts's re-export), delete the local stub,
    and drop `"ssa-block": 1` from skeleton.test.ts.
- **cg-write**: `llvm_util::get_version`. `get_attrs` reads it when optimizing, for any pointer with a known pointee size.
- **cg-di-a**: `debuginfo::build_global_var_di_node`, called by **every** `codegen_static`. It stops before its own first
  line (`if cx.dbg_cx.is_none() { return; }`).
- **rustc_session** (attributes.ts's `SESSION_STOPS`, reached through ported cg-types-attrs code):
  - `direct_access_external_data`, through `assume_dso_local` for an external, default-visibility global that is not in an
    executable (`get_static_inner`, `check_and_apply_linkage`, and `predefine_static`);
  - `must_emit_unwind_tables`, through `apply_attrs_llfn(.., Some(instance))` → `llfn_attrs_from_instance`;
  - `needs_plt`, through `check_and_apply_linkage`'s `extern_weak` fn path → `declare_fn`.
- **rustc_middle**: `StableHash for Allocation`, through cg-context's `alloc_to_backend`. It is reached by a static whose
  initializer points to an anonymous allocation, unless `fewer_names` is set (it is not under `--emit=llvm-ir`).

## Every `unported(...)` in this lane's files
- abi.ts: `ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs store_cast` (above).
- consts.ts has four **rustc_sanitizers** stubs, because that crate is out of scope (harness/scope.json):
  - `ignorelist::Blame::NONE`, `ignorelist::Blame::max`, `ignorelist::SanitizerIgnoreList::in_section_blame` and
    `ignorelist::is_blame_ignored`;
  - they go through `sanitizers_stub(what)` (builder.ts's form, a template string, so skeleton.test.ts's literal-only count
    does not see them);
  - they are unreachable today, because they sit inside `if let Some(ignorelist) = &self.sanitizer_ignorelist`.
- Stub counts in skeleton.test.ts: `cg-abi-consts` goes from 20 to 0, and `ssa-block` is new at 1.

## `// PORT:` decisions (for root to record)
1. **Extension traits** (`ArgAttributesExt`, `LlvmType`, `ArgAbiExt`, `FnAbiLlvmExt`):
   - each is an exported TS interface whose members carry the declarations' markers;
   - the foreign class's `declare module` augmentation extends it (type_of.ts's `LayoutLlvmExt` form);
   - the impls are prototype assignments (cg-contract's C2 form).
2. **consts.ts reads `crate::base` and `crate::debuginfo` lazily** (`base()` / `debuginfo()`, context.ts's memoized `require`
   pattern), because of init order. builder.ts imports common.ts, which imports consts.ts eagerly. An eager base.ts import goes
   through back/llvm_backend.ts and reaches debuginfo/mod.ts, which reads `Builder` before it exists.
3. **`crate::debuginfo::build_global_var_di_node`** is debuginfo/mod.rs's re-export of `metadata::build_global_var_di_node`.
   debuginfo/mod.ts (cg-di's file) has no re-export, so consts.ts calls debuginfo/metadata.ts.
4. **Inherent before trait (review F1):** `cx.const_struct(..)` in `const_alloc_to_llvm` and `self.const_null(..)` in
   `define_objc_module_info` are called on a `CodegenCx`, where `GenericCx`'s inherent fns win. So they are
   `const_struct_inherent` / `const_null_inherent`.
5. **Field access:**
   - `self.statics_to_rauw` (a `FullCx` field named like a method) is `this._0.statics_to_rauw` (context.ts header);
   - `cx.llcx` / `self.llmod` are the `llcx()` / `llmod()` accessors;
   - `bx.cx` is `bx.cx_`;
   - `self.tcx.data_layout` is `tcx.data_layout()`;
   - `llvm_type(bx)` passes `bx.cx_`, and `llfn_attrs_from_instance(cx, ..)` passes `cx.scx` (deref coercion).
6. **`version_ge`** is `llvm_version >= (23, 0, 0)` on tuples, compared lexicographically.
7. **Bitflags and ranges:**
   - `regular -= ArgAttribute::NonNull` is `ArgAttribute.difference`;
   - `chunks.clone().take(max.saturating_add(1)).count()` is `clone_InitChunkIter` plus a bounded count. `max + 1` cannot
     overflow a JS number, so it is not saturated.
8. **Integer widths:**
   - allocation offsets and lengths are `number`;
   - the relocation offset (`read_target_uint(..) as u64`), sizes passed to `type_array` (`bytes_u64()`) and `CastTarget`'s
     `rest_count` are `bigint`;
   - `int.signed_max() as u64` is `BigInt.asUintN(64, ..)`;
   - `as c_uint` on an index is `>>> 0`.
9. **Panic texts:**
   - `assert_ne!` / `assert_eq!` with a message (`CastTarget::llvm_type`) are `panic(..)` with core's text;
   - `assert_eq!(self.objc_abi_version(), N)` is the local `assert_eq_u32`;
   - `self.args[i]` keeps the slice-index panic text.
10. **Small helpers:**
    - `String::from_utf8(get_value_name(g)).expect(..)` is `from_utf8` plus `FromUtf8Error` plus `expect_result`, as
      llvm/mod.ts's `build_string` does;
    - `format!("{:016x}", stable_crate_id)` is the `bigint`'s hex, padded to 16. Its `LowerHex` is the inner `u64`'s;
    - `let ty::FnPtr(sig, header) = args.type_at(0).kind()` is the local `fn_ptr_parts`, evaluated only after the `Adt` and
      `Option` checks, in upstream's `&&` order.
11. **Match forms:**
    - `get_objc_selref`'s three `match abi_version { 1 => .., 2 => .., _ => unreachable!() }` are the local `by_version(v1, v2)`.
      It is the same match, evaluated at each of the three sites;
    - the argument `match`es with `IndirectMode` patterns in `apply_attrs_llfn` / `apply_attrs_callsite` are if-chains, in the
      same arm order.
12. **`tracing` lines** (`debug!`, `trace!`, `#[instrument]`) are comments.

## Commits
- `09a4555c` cg-abi-consts: port rustc_codegen_llvm abi.rs and consts.rs.
- `9d7496ce` cg-abi-consts: oracle tests for fn signatures, call sites and statics.
- `b47819b4` cg-abi-consts: test store_fn_arg against the oracle's spilled-argument entry blocks.
- The commit of this handoff.
