; ModuleID = 'debuginfo.5788dedd18320a49-cgu.0'
source_filename = "debuginfo.5788dedd18320a49-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; <i8 as debuginfo::Neg>::neg
; Function Attrs: nonlazybind uwtable
define i8 @_RNvXsc_Cs7vWAa3jVger_9debuginfoaNtB5_3Neg3neg(i8 %self) unnamed_addr #0 !guid !4 {
start:
  br label %bb1

bb1:                                              ; preds = %bb1, %start
  br label %bb1
}

; Function Attrs: nonlazybind uwtable
define i64 @big(ptr align 8 %b) unnamed_addr #0 !guid !5 {
start:
  %0 = getelementptr inbounds i8, ptr %b, i64 16
  %_0 = load i64, ptr %0, align 8
  ret i64 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @borrowed(i32 %0) unnamed_addr #0 !guid !6 {
start:
  %x = alloca [4 x i8], align 4
  store i32 %0, ptr %x, align 4
  %_0 = load i32, ptr %x, align 4
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define void @closure(i32 %x) unnamed_addr #0 !guid !7 {
start:
  %_2 = alloca [0 x i8], align 1
  ret void
}

; Function Attrs: nonlazybind uwtable
define i32 @locals(i32 %x) unnamed_addr #0 !guid !8 {
start:
  ret i32 %x
}

; Function Attrs: nonlazybind uwtable
define i32 @pair(i32 %p.0, i32 %p.1) unnamed_addr #0 !guid !9 {
start:
  ret i32 %p.1
}

; Function Attrs: nonlazybind uwtable
define i32 @pair_by_value(i32 %self.0, i32 %self.1) unnamed_addr #0 !guid !10 {
start:
  ret i32 %self.1
}

; Function Attrs: nonlazybind uwtable
define void @pair_closure(ptr align 4 %self) unnamed_addr #0 !guid !11 {
start:
  %_2 = alloca [0 x i8], align 1
  ret void
}

; Function Attrs: nonlazybind uwtable
define i32 @pair_first(ptr align 4 %self) unnamed_addr #0 !guid !12 {
start:
  %_0 = load i32, ptr %self, align 4
  ret i32 %_0
}

; Function Attrs: nonlazybind uwtable
define i32 @scalar(i32 %x) unnamed_addr #0 !guid !13 {
start:
  ret i32 %x
}

; Function Attrs: nonlazybind uwtable
define void @types(i32 %w, ptr %ww, i32 %t.0, i1 zeroext %t.1, ptr align 8 %r, ptr %p, ptr %m, ptr %d.0, ptr align 8 %d.1, ptr %ds.0, ptr align 8 %ds.1, ptr %da.0, ptr align 8 %da.1, i1 zeroext %e, i32 %o.0, i32 %o.1, ptr %f, ptr %fu, i32 %0, ptr align 4 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1) unnamed_addr #0 !guid !14 {
start:
  %1 = alloca [4 x i8], align 4
  %arr = alloca [4 x i8], align 1
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 1 %arr, ptr align 4 %1, i64 4, i1 false)
  ret void
}

; Function Attrs: nonlazybind uwtable
define i32 @unnamed(i32 %_1, i32 %y) unnamed_addr #0 !guid !15 {
start:
  ret i32 %y
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 4870345733078936707}
!5 = !{i64 5515620527165104600}
!6 = !{i64 -8233072348051919563}
!7 = !{i64 -8001930764763462056}
!8 = !{i64 5053764491818238053}
!9 = !{i64 4859215404959254835}
!10 = !{i64 3613341350573506715}
!11 = !{i64 -4772090666375877613}
!12 = !{i64 -4966468779482704476}
!13 = !{i64 -4572029188287661406}
!14 = !{i64 -1154744837904250159}
!15 = !{i64 1291262018994763082}
