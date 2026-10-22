// Port of the `#[cfg(test)] mod tests` of rustc-demangle =0.1.28 `src/legacy.rs` (they go through the crate
// root's `demangle` / `try_demangle`, as upstream's `::demangle`).
//
// PORT: `t!` / `t_err!` / `t_nohash!` are local helpers. `x.to_string()` / `format!("{:#}")` is
// `display_Demangle(x, alternate)`.
import { expect, test } from "bun:test";
import { demangle as demangle_, display_Demangle, try_demangle } from "./lib.ts";

function t(a: string, b: string): void {
  expect(ok(a, b)).toBe(true);
}
function t_err(a: string): void {
  expect(ok_err(a)).toBe(true);
}
function t_nohash(a: string, b: string): void {
  expect(display_Demangle(demangle_(a), true)).toBe(b);
}

// crate: rustc-demangle-0.1.28/src/legacy.rs:215 ok
function ok(sym: string, expected: string): boolean {
  const r = try_demangle(sym);
  if (r.$ === "Ok") {
    const s = r._0;
    if (display_Demangle(s, false) === expected) {
      return true;
    } else {
      console.log(`\n${display_Demangle(s, false)}\n!=\n${expected}\n`);
      return false;
    }
  } else {
    console.log("error demangling");
    return false;
  }
}

// crate: rustc-demangle-0.1.28/src/legacy.rs:232 ok_err
function ok_err(sym: string): boolean {
  const r = try_demangle(sym);
  if (r.$ === "Ok") {
    console.log("succeeded in demangling");
    return false;
  } else {
    return display_Demangle(demangle_(sym), false) === sym;
  }
}

// crate: rustc-demangle-0.1.28/src/legacy.rs:243 demangle
test("demangle", () => {
  t_err("test");
  t("_ZN4testE", "test");
  t_err("_ZN4test");
  t("_ZN4test1a2bcE", "test::a::bc");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:251 demangle_dollars
test("demangle_dollars", () => {
  t("_ZN4$RP$E", ")");
  t("_ZN8$RF$testE", "&test");
  t("_ZN8$BP$test4foobE", "*test::foob");
  t("_ZN9$u20$test4foobE", " test::foob");
  t("_ZN35Bar$LT$$u5b$u32$u3b$$u20$4$u5d$$GT$E", "Bar<[u32; 4]>");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:260 demangle_many_dollars
test("demangle_many_dollars", () => {
  t("_ZN13test$u20$test4foobE", "test test::foob");
  t("_ZN12test$BP$test4foobE", "test*test::foob");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:266 demangle_osx
test("demangle_osx", () => {
  t("__ZN5alloc9allocator6Layout9for_value17h02a996811f781011E", "alloc::allocator::Layout::for_value::h02a996811f781011");
  t("__ZN38_$LT$core..option..Option$LT$T$GT$$GT$6unwrap18_MSG_FILE_LINE_COL17haf7cb8d5824ee659E", "<core::option::Option<T>>::unwrap::_MSG_FILE_LINE_COL::haf7cb8d5824ee659");
  t(
    "__ZN4core5slice89_$LT$impl$u20$core..iter..traits..IntoIterator$u20$for$u20$$RF$$u27$a$u20$$u5b$T$u5d$$GT$9into_iter17h450e234d27262170E",
    "core::slice::<impl core::iter::traits::IntoIterator for &'a [T]>::into_iter::h450e234d27262170",
  );
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:276 demangle_windows
test("demangle_windows", () => {
  t("ZN4testE", "test");
  t("ZN13test$u20$test4foobE", "test test::foob");
  t("ZN12test$RF$test4foobE", "test&test::foob");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:283 demangle_elements_beginning_with_underscore
test("demangle_elements_beginning_with_underscore", () => {
  t("_ZN13_$LT$test$GT$E", "<test>");
  t("_ZN28_$u7b$$u7b$closure$u7d$$u7d$E", "{{closure}}");
  t("_ZN15__STATIC_FMTSTRE", "__STATIC_FMTSTR");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:290 demangle_trait_impls
test("demangle_trait_impls", () => {
  t("_ZN71_$LT$Test$u20$$u2b$$u20$$u27$static$u20$as$u20$foo..Bar$LT$Test$GT$$GT$3barE", "<Test + 'static as foo::Bar<Test>>::bar");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:298 demangle_without_hash
test("demangle_without_hash", () => {
  const s = "_ZN3foo17h05af221e174051e9E";
  t(s, "foo::h05af221e174051e9");
  t_nohash(s, "foo");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:305 demangle_without_hash_edgecases
test("demangle_without_hash_edgecases", () => {
  // One element, no hash.
  t_nohash("_ZN3fooE", "foo");
  // Two elements, no hash.
  t_nohash("_ZN3foo3barE", "foo::bar");
  // Longer-than-normal hash.
  t_nohash("_ZN3foo20h05af221e174051e9abcE", "foo");
  // Shorter-than-normal hash.
  t_nohash("_ZN3foo5h05afE", "foo");
  // Valid hash, but not at the end.
  t_nohash("_ZN17h05af221e174051e93fooE", "h05af221e174051e9::foo");
  // Not a valid hash, missing the 'h'.
  t_nohash("_ZN3foo16ffaf221e174051e9E", "foo::ffaf221e174051e9");
  // Not a valid hash, has a non-hex-digit.
  t_nohash("_ZN3foo17hg5af221e174051e9E", "foo::hg5af221e174051e9");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:323 demangle_thinlto
test("demangle_thinlto", () => {
  // One element, no hash.
  t("_ZN3fooE.llvm.9D1C9369", "foo");
  t("_ZN3fooE.llvm.9D1C9369@@16", "foo");
  t_nohash("_ZN9backtrace3foo17hbb467fcdaea5d79bE.llvm.A5310EB9", "backtrace::foo");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:334 demangle_llvm_ir_branch_labels
test("demangle_llvm_ir_branch_labels", () => {
  t(
    "_ZN4core5slice77_$LT$impl$u20$core..ops..index..IndexMut$LT$I$GT$$u20$for$u20$$u5b$T$u5d$$GT$9index_mut17haf9727c2edfbc47bE.exit.i.i",
    "core::slice::<impl core::ops::index::IndexMut<I> for [T]>::index_mut::haf9727c2edfbc47b.exit.i.i",
  );
  t_nohash(
    "_ZN4core5slice77_$LT$impl$u20$core..ops..index..IndexMut$LT$I$GT$$u20$for$u20$$u5b$T$u5d$$GT$9index_mut17haf9727c2edfbc47bE.exit.i.i",
    "core::slice::<impl core::ops::index::IndexMut<I> for [T]>::index_mut.exit.i.i",
  );
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:340 demangle_ignores_suffix_that_doesnt_look_like_a_symbol
test("demangle_ignores_suffix_that_doesnt_look_like_a_symbol", () => {
  t_err("_ZN3fooE.llvm moocow");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:345 dont_panic
test("dont_panic", () => {
  display_Demangle(demangle_("_ZN2222222222222222222222EE"), false);
  display_Demangle(demangle_("_ZN5*70527e27.ll34csaғE"), false);
  display_Demangle(demangle_("_ZN5*70527a54.ll34_$b.1E"), false);
  display_Demangle(demangle_("_ZN5~saäb4e\n2734cOsbE\n5usage20h)3\0\0\0\0\0\0\x007e2734cOsbE"), false);
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:360 invalid_no_chop
test("invalid_no_chop", () => {
  t_err("_ZNfooE");
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:365 handle_assoc_types
test("handle_assoc_types", () => {
  t(
    "_ZN151_$LT$alloc..boxed..Box$LT$alloc..boxed..FnBox$LT$A$C$$u20$Output$u3d$R$GT$$u20$$u2b$$u20$$u27$a$GT$$u20$as$u20$core..ops..function..FnOnce$LT$A$GT$$GT$9call_once17h69e8f44b3723e1caE",
    "<alloc::boxed::Box<alloc::boxed::FnBox<A, Output=R> + 'a> as core::ops::function::FnOnce<A>>::call_once::h69e8f44b3723e1ca",
  );
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:370 handle_bang
test("handle_bang", () => {
  t(
    "_ZN88_$LT$core..result..Result$LT$$u21$$C$$u20$E$GT$$u20$as$u20$std..process..Termination$GT$6report17hfc41d0da4a40b3e8E",
    "<core::result::Result<!, E> as std::process::Termination>::report::hfc41d0da4a40b3e8",
  );
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:378 demangle_utf8_idents
test("demangle_utf8_idents", () => {
  t_nohash(
    "_ZN11utf8_idents157_$u10e1$$u10d0$$u10ed$$u10db$$u10d4$$u10da$$u10d0$$u10d3$_$u10d2$$u10d4$$u10db$$u10e0$$u10d8$$u10d4$$u10da$$u10d8$_$u10e1$$u10d0$$u10d3$$u10d8$$u10da$$u10d8$17h21634fd5714000aaE",
    "utf8_idents::საჭმელად_გემრიელი_სადილი",
  );
});

// crate: rustc-demangle-0.1.28/src/legacy.rs:386 demangle_issue_60925
test("demangle_issue_60925", () => {
  t_nohash("_ZN11issue_609253foo37Foo$LT$issue_60925..llv$u6d$..Foo$GT$3foo17h059a991a004536adE", "issue_60925::foo::Foo<issue_60925::llvm::Foo>::foo");
});
