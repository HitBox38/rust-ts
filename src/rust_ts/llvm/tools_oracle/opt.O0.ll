; ModuleID = 'opt.2c18e1863cf3b211-cgu.0'
source_filename = "opt.2c18e1863cf3b211-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@alloc_b4b9b4f62209b9d00aa12f47a5f19671 = private unnamed_addr constant [7 x i8] c"opt.rs\00", align 1, !guid !0
@alloc_27a134220ca847ba7b32d3e11c1d7e0e = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b4b9b4f62209b9d00aa12f47a5f19671, [16 x i8] c"\06\00\00\00\00\00\00\00\1E\00\00\00\18\00\00\00" }>, align 8, !guid !1
@alloc_403f5640aaa222aeb0951952dd051565 = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b4b9b4f62209b9d00aa12f47a5f19671, [16 x i8] c"\06\00\00\00\00\00\00\00\1E\00\00\00\05\00\00\00" }>, align 8, !guid !2
@alloc_9c7ef200e455749f0f557b0ab58227ae = private unnamed_addr constant <{ ptr, [16 x i8] }> <{ ptr @alloc_b4b9b4f62209b9d00aa12f47a5f19671, [16 x i8] c"\06\00\00\00\00\00\00\00\19\00\00\00\05\00\00\00" }>, align 8, !guid !3

; core::intrinsics::rotate_left::<u64>
; Function Attrs: nounwind nonlazybind uwtable
define i64 @_RINvNtCsajD8mEyjPew_4core10intrinsics11rotate_leftyECs3MJ9DESUAaP_3opt(i64 %x, i32 %shift) unnamed_addr #0 personality ptr @rust_eh_personality !guid !8 {
start:
  %_3 = urem i32 %shift, 64
  %0 = zext i32 %_3 to i64
  %_0 = call i64 @llvm.fshl.i64(i64 %x, i64 %x, i64 %0)
  ret i64 %_0
}

; opt::sum
; Function Attrs: noinline nonlazybind uwtable
define i32 @_RNvCs3MJ9DESUAaP_3opt3sum(ptr align 4 %xs.0, i64 %xs.1) unnamed_addr #1 !guid !9 {
start:
  %_5 = alloca [8 x i8], align 8
  %iter = alloca [16 x i8], align 8
  %s = alloca [4 x i8], align 4
  store i32 0, ptr %s, align 4
; call <&[u32] as core::iter::traits::collect::IntoIterator>::into_iter
  %0 = call { ptr, ptr } @_RNvXs_NtNtCsajD8mEyjPew_4core5slice4iterRSmNtNtNtNtB8_4iter6traits7collect12IntoIterator9into_iterCs3MJ9DESUAaP_3opt(ptr align 4 %xs.0, i64 %xs.1)
  %_3.0 = extractvalue { ptr, ptr } %0, 0
  %_3.1 = extractvalue { ptr, ptr } %0, 1
  store ptr %_3.0, ptr %iter, align 8
  %1 = getelementptr inbounds i8, ptr %iter, i64 8
  store ptr %_3.1, ptr %1, align 8
  br label %bb2

bb2:                                              ; preds = %bb5, %start
; call <core::slice::iter::Iter<u32> as core::iter::traits::iterator::Iterator>::next
  %2 = call align 4 ptr @_RNvXs2J_NtNtCsajD8mEyjPew_4core5slice4iterINtB6_4ItermENtNtNtNtBa_4iter6traits8iterator8Iterator4nextCs3MJ9DESUAaP_3opt(ptr align 8 %iter)
  store ptr %2, ptr %_5, align 8
  %3 = load ptr, ptr %_5, align 8
  %4 = ptrtoint ptr %3 to i64
  %5 = icmp eq i64 %4, 0
  %_7 = select i1 %5, i64 0, i64 1
  %6 = trunc nuw i64 %_7 to i1
  br i1 %6, label %bb5, label %bb6

bb5:                                              ; preds = %bb2
  %x = load ptr, ptr %_5, align 8
  %_10 = load i32, ptr %s, align 4
  %_12 = load i32, ptr %x, align 4
  %_0.i1 = mul i32 %_12, 3
  %_0.i = add i32 %_10, %_0.i1
  store i32 %_0.i, ptr %s, align 4
  br label %bb2

bb6:                                              ; preds = %bb2
  %_0 = load i32, ptr %s, align 4
  ret i32 %_0

bb4:                                              ; No predecessors!
  unreachable
}

; opt::caller
; Function Attrs: noinline nonlazybind uwtable
define i32 @_RNvCs3MJ9DESUAaP_3opt6caller(i32 %x) unnamed_addr #1 !guid !10 {
start:
; call opt::helper
  %_2 = call i32 @_RNvCs3MJ9DESUAaP_3opt6helper(i32 %x)
  %0 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %x, i32 1)
  %_5.0 = extractvalue { i32, i1 } %0, 0
  %_5.1 = extractvalue { i32, i1 } %0, 1
  br i1 %_5.1, label %panic, label %bb2

bb2:                                              ; preds = %start
; call opt::helper
  %_3 = call i32 @_RNvCs3MJ9DESUAaP_3opt6helper(i32 %_5.0)
  %1 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %_2, i32 %_3)
  %_6.0 = extractvalue { i32, i1 } %1, 0
  %_6.1 = extractvalue { i32, i1 } %1, 1
  br i1 %_6.1, label %panic1, label %bb4

panic:                                            ; preds = %start
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_27a134220ca847ba7b32d3e11c1d7e0e) #7
  unreachable

bb4:                                              ; preds = %bb2
  ret i32 %_6.0

panic1:                                           ; preds = %bb2
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_403f5640aaa222aeb0951952dd051565) #7
  unreachable
}

; opt::helper
; Function Attrs: nonlazybind uwtable
define internal i32 @_RNvCs3MJ9DESUAaP_3opt6helper(i32 %x) unnamed_addr #2 !guid !11 {
start:
  %0 = call { i32, i1 } @llvm.smul.with.overflow.i32(i32 %x, i32 2)
  %_3.0 = extractvalue { i32, i1 } %0, 0
  %_3.1 = extractvalue { i32, i1 } %0, 1
  br i1 %_3.1, label %panic, label %bb1

bb1:                                              ; preds = %start
  %1 = call { i32, i1 } @llvm.sadd.with.overflow.i32(i32 %_3.0, i32 1)
  %_4.0 = extractvalue { i32, i1 } %1, 0
  %_4.1 = extractvalue { i32, i1 } %1, 1
  br i1 %_4.1, label %panic1, label %bb2

panic:                                            ; preds = %start
; call core::panicking::panic_const::panic_const_mul_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_mul_overflow(ptr align 8 @alloc_9c7ef200e455749f0f557b0ab58227ae) #7
  unreachable

bb2:                                              ; preds = %bb1
  ret i32 %_4.0

panic1:                                           ; preds = %bb1
; call core::panicking::panic_const::panic_const_add_overflow
  call void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8 @alloc_9c7ef200e455749f0f557b0ab58227ae) #7
  unreachable
}

; opt::twin_a
; Function Attrs: noinline nonlazybind uwtable
define i64 @_RNvCs3MJ9DESUAaP_3opt6twin_a(i64 %a, i64 %b) unnamed_addr #1 !guid !12 {
start:
  %_0.i1 = mul i64 %a, %b
; call core::intrinsics::rotate_left::<u64>
  %_0.i = call i64 @_RINvNtCsajD8mEyjPew_4core10intrinsics11rotate_leftyECs3MJ9DESUAaP_3opt(i64 %_0.i1, i32 7) #8
  %_0 = xor i64 %_0.i, %b
  ret i64 %_0
}

; opt::twin_b
; Function Attrs: noinline nonlazybind uwtable
define i64 @_RNvCs3MJ9DESUAaP_3opt6twin_b(i64 %a, i64 %b) unnamed_addr #1 !guid !13 {
start:
  %_0.i1 = mul i64 %a, %b
; call core::intrinsics::rotate_left::<u64>
  %_0.i = call i64 @_RINvNtCsajD8mEyjPew_4core10intrinsics11rotate_leftyECs3MJ9DESUAaP_3opt(i64 %_0.i1, i32 7) #8
  %_0 = xor i64 %_0.i, %b
  ret i64 %_0
}

; <core::slice::iter::Iter<u32> as core::iter::traits::iterator::Iterator>::next
; Function Attrs: inlinehint nonlazybind uwtable
define align 4 ptr @_RNvXs2J_NtNtCsajD8mEyjPew_4core5slice4iterINtB6_4ItermENtNtNtNtBa_4iter6traits8iterator8Iterator4nextCs3MJ9DESUAaP_3opt(ptr align 8 %self) unnamed_addr #3 !guid !14 {
start:
  %_0 = alloca [8 x i8], align 8
  %ptr = load ptr, ptr %self, align 8
  %0 = getelementptr inbounds i8, ptr %self, i64 8
  %end_or_len = load ptr, ptr %0, align 8
  br label %bb4

bb4:                                              ; preds = %start
  %_6 = icmp eq ptr %ptr, %end_or_len
  br i1 %_6, label %bb5, label %bb6

bb6:                                              ; preds = %bb4
  %_16 = getelementptr inbounds nuw i32, ptr %ptr, i64 1
  store ptr %_16, ptr %self, align 8
  br label %bb7

bb5:                                              ; preds = %bb4
  store ptr null, ptr %_0, align 8
  br label %bb8

bb7:                                              ; preds = %bb6
  store ptr %ptr, ptr %_0, align 8
  br label %bb9

bb9:                                              ; preds = %bb8, %bb7
  %1 = load ptr, ptr %_0, align 8
  ret ptr %1

bb8:                                              ; preds = %bb5
  br label %bb9

bb1:                                              ; No predecessors!
  unreachable

bb2:                                              ; No predecessors!
  unreachable

bb3:                                              ; No predecessors!
  unreachable

bb10:                                             ; No predecessors!
  unreachable

bb11:                                             ; No predecessors!
  unreachable
}

; <&[u32] as core::iter::traits::collect::IntoIterator>::into_iter
; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @_RNvXs_NtNtCsajD8mEyjPew_4core5slice4iterRSmNtNtNtNtB8_4iter6traits7collect12IntoIterator9into_iterCs3MJ9DESUAaP_3opt(ptr align 4 %self.0, i64 %self.1) unnamed_addr #2 !guid !15 {
start:
  %end_or_len = alloca [8 x i8], align 8
  br label %bb2

bb2:                                              ; preds = %start
  %_6 = getelementptr inbounds nuw i32, ptr %self.0, i64 %self.1
  store ptr %_6, ptr %end_or_len, align 8
  br label %bb3

bb3:                                              ; preds = %bb2
  %_0.1 = load ptr, ptr %end_or_len, align 8
  %0 = insertvalue { ptr, ptr } poison, ptr %self.0, 0
  %1 = insertvalue { ptr, ptr } %0, ptr %_0.1, 1
  ret { ptr, ptr } %1

bb1:                                              ; No predecessors!
  unreachable
}

; Function Attrs: nonlazybind
declare i32 @rust_eh_personality(...) unnamed_addr #4

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.fshl.i64(i64, i64, i64) #5

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i32, i1 } @llvm.sadd.with.overflow.i32(i32, i32) #5

; core::panicking::panic_const::panic_const_add_overflow
; Function Attrs: cold noinline noreturn nonlazybind uwtable
declare void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_add_overflow(ptr align 8) unnamed_addr #6

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i32, i1 } @llvm.smul.with.overflow.i32(i32, i32) #5

; core::panicking::panic_const::panic_const_mul_overflow
; Function Attrs: cold noinline noreturn nonlazybind uwtable
declare void @_RNvNtNtCsajD8mEyjPew_4core9panicking11panic_const24panic_const_mul_overflow(ptr align 8) unnamed_addr #6

attributes #0 = { nounwind nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { inlinehint nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #4 = { nonlazybind "target-cpu"="x86-64" }
attributes #5 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #6 = { cold noinline noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #7 = { noreturn }
attributes #8 = { nounwind }

!llvm.module.flags = !{!4, !5, !6}
!llvm.ident = !{!7}

!0 = !{i64 -8180857003435518407}
!1 = !{i64 8400866915150658700}
!2 = !{i64 -7985891087002636718}
!3 = !{i64 -5536810756169196440}
!4 = !{i32 8, !"PIC Level", i32 2}
!5 = !{i32 2, !"RtLibUseGOT", i32 1}
!6 = !{i32 7, !"uwtable", i32 2}
!7 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!8 = !{i64 23818654098695853}
!9 = !{i64 2214553141500644640}
!10 = !{i64 -7132310722193279290}
!11 = !{i64 7091170889161946988}
!12 = !{i64 -6519570378415343707}
!13 = !{i64 -6361512731815395944}
!14 = !{i64 -8266062296777753059}
!15 = !{i64 2456578803893155905}
