; ModuleID = 'names.a9eff189a1f628e-cgu.0'
source_filename = "names.a9eff189a1f628e-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCsUxdssLNMuw_5names6GLOBAL = constant [4 x i8] c"\07\00\00\00", align 4, !guid !0
@vtable.0 = private unnamed_addr constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00", ptr @_RNvXs8_CsUxdssLNMuw_5namesmNtB5_2Tr1m }>, align 8, !guid !1

; names::ident::<u64>
; Function Attrs: noinline nonlazybind uwtable
define i64 @_RINvCsUxdssLNMuw_5names5identyEB2_(i64 %t) unnamed_addr #0 !guid !6 {
start:
  ret i64 %t
}

; <names::S>::get
; Function Attrs: noinline nonlazybind uwtable
define i32 @_RNvMs7_CsUxdssLNMuw_5namesNtB5_1S3get(ptr align 4 %self) unnamed_addr #0 !guid !7 {
start:
  %_0 = load i32, ptr %self, align 4
  ret i32 %_0
}

; <u32 as names::Tr>::m
; Function Attrs: nonlazybind uwtable
define i32 @_RNvXs8_CsUxdssLNMuw_5namesmNtB5_2Tr1m(ptr align 4 %self) unnamed_addr #1 !guid !8 {
start:
  %_0 = load i32, ptr %self, align 4
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @borrowed(i32 %0) unnamed_addr #1 !guid !9 {
start:
  %x = alloca [4 x i8], align 4
  store i32 %0, ptr %x, align 4
  %_0 = load i32, ptr %x, align 4
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @call_dyn(ptr %t.0, ptr align 8 %t.1) unnamed_addr #1 !guid !10 {
start:
  %0 = getelementptr inbounds i8, ptr %t.1, i64 24
  %1 = load ptr, ptr %0, align 8, !invariant.load !11, !nonnull !11
  %_0 = call i32 %1(ptr %t.0)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define i64 @generic_caller(i64 %v) unnamed_addr #1 !guid !12 {
start:
; call names::ident::<u64>
  %_0 = call i64 @_RINvCsUxdssLNMuw_5names5identyEB2_(i64 %v)
  ret i64 %_0
}

; Function Attrs: nonlazybind uwtable
define align 4 ptr @global() unnamed_addr #1 !guid !13 {
start:
  ret ptr @_RNvCsUxdssLNMuw_5names6GLOBAL
}

; Function Attrs: nonlazybind uwtable
define i64 @indirect(ptr align 8 %b) unnamed_addr #1 !guid !14 {
start:
  %0 = getelementptr inbounds i8, ptr %b, i64 16
  %_0 = load i64, ptr %0, align 8
  ret i64 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @locals(i1 zeroext %flag) unnamed_addr #1 !guid !15 {
start:
  %acc = alloca [4 x i8], align 4
  %arr = alloca [12 x i8], align 4
  %0 = getelementptr inbounds nuw i32, ptr %arr, i64 0
  store i32 1, ptr %0, align 4
  %1 = getelementptr inbounds nuw i32, ptr %arr, i64 1
  store i32 2, ptr %1, align 4
  %2 = getelementptr inbounds nuw i32, ptr %arr, i64 2
  store i32 3, ptr %2, align 4
  %3 = getelementptr inbounds nuw i32, ptr %arr, i64 0
  %first = load i32, ptr %3, align 4
  %4 = getelementptr inbounds nuw i32, ptr %arr, i64 2
  %last = load i32, ptr %4, align 4
  store i32 %first, ptr %acc, align 4
  br i1 %flag, label %bb1, label %bb2

bb2:                                              ; preds = %bb1, %start
  %_0 = load i32, ptr %acc, align 4
  ret i32 %_0

bb1:                                              ; preds = %start
  store i32 %last, ptr %acc, align 4
  br label %bb2
}

; Function Attrs: nonlazybind uwtable
define i32 @method(ptr align 4 %s) unnamed_addr #1 !guid !16 {
start:
; call <names::S>::get
  %_0 = call i32 @_RNvMs7_CsUxdssLNMuw_5namesNtB5_1S3get(ptr align 4 %s)
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @pair(i32 %p.0, i32 %p.1) unnamed_addr #1 !guid !17 {
start:
  ret i32 %p.1
}

; Function Attrs: nonlazybind uwtable
define i32 @scalar(i32 %x, i32 %_unused) unnamed_addr #1 !guid !18 {
start:
  ret i32 %x
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @vtable(ptr align 4 %x) unnamed_addr #1 !guid !19 {
start:
  %0 = insertvalue { ptr, ptr } poison, ptr %x, 0
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1
  ret { ptr, ptr } %1
}

attributes #0 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }

!llvm.module.flags = !{!2, !3, !4}
!llvm.ident = !{!5}

!0 = !{i64 2089927795007952112}
!1 = !{i64 -2363721103470864143}
!2 = !{i32 8, !"PIC Level", i32 2}
!3 = !{i32 2, !"RtLibUseGOT", i32 1}
!4 = !{i32 7, !"uwtable", i32 2}
!5 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!6 = !{i64 6280247476723532812}
!7 = !{i64 -8172743910699121134}
!8 = !{i64 -6820081858885067152}
!9 = !{i64 -8233072348051919563}
!10 = !{i64 623834522068042468}
!11 = !{}
!12 = !{i64 1311025923315293226}
!13 = !{i64 7866218443099566236}
!14 = !{i64 7559747487108064505}
!15 = !{i64 5053764491818238053}
!16 = !{i64 -4235475849456214038}
!17 = !{i64 4859215404959254835}
!18 = !{i64 -4572029188287661406}
!19 = !{i64 3405836996193402751}
