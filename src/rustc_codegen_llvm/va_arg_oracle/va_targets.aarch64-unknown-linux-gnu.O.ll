; ModuleID = 'va_targets.62a5447847134272-cgu.0'
source_filename = "va_targets.62a5447847134272-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i8:8:32-i16:16:32-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "aarch64-unknown-linux-gnu"

; Function Attrs: uwtable
define noundef double @va_f64(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !4 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %3, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 16
  store i32 %6, ptr %3, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %1, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load double, ptr %9, align 8
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load double, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi double [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret double %_0
}

; Function Attrs: uwtable
define noundef i32 @va_i32(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !5 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load i32, ptr %9, align 4
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load i32, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi i32 [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret i32 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_i64(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !6 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load i64, ptr %9, align 8
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load i64, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi i64 [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret i64 %_0
}

; Function Attrs: uwtable
define noundef ptr @va_ptr(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !7 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load ptr, ptr %9, align 8
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load ptr, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi ptr [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret ptr %_0
}

; Function Attrs: uwtable
define noundef i32 @va_u32(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !8 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load i32, ptr %9, align 4
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load i32, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi i32 [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret i32 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_u64(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !9 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load i64, ptr %9, align 8
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load i64, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi i64 [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret i64 %_0
}

; Function Attrs: uwtable
define noundef i64 @va_usize(ptr noalias nofree noundef align 8 dereferenceable(32) %ap) unnamed_addr #0 !guid !10 {
start:
  %0 = getelementptr inbounds i8, ptr %ap, i64 8
  %1 = getelementptr inbounds i8, ptr %ap, i64 16
  %2 = getelementptr inbounds i8, ptr %ap, i64 24
  %3 = getelementptr inbounds i8, ptr %ap, i64 28
  %4 = load i32, ptr %2, align 4
  %5 = icmp sge i32 %4, 0
  br i1 %5, label %va_arg.on_stack, label %va_arg.maybe_reg

va_arg.maybe_reg:                                 ; preds = %start
  %6 = add i32 %4, 8
  store i32 %6, ptr %2, align 4
  %7 = icmp sgt i32 %6, 0
  br i1 %7, label %va_arg.on_stack, label %va_arg.in_reg

va_arg.in_reg:                                    ; preds = %va_arg.maybe_reg
  %8 = load ptr, ptr %0, align 8
  %9 = getelementptr i8, ptr %8, i32 %4
  %10 = load i64, ptr %9, align 8
  br label %va_arg.end

va_arg.on_stack:                                  ; preds = %va_arg.maybe_reg, %start
  %11 = load ptr, ptr %ap, align 8
  %12 = getelementptr inbounds i8, ptr %11, i32 8
  store ptr %12, ptr %ap, align 8
  %13 = load i64, ptr %11, align 8
  br label %va_arg.end

va_arg.end:                                       ; preds = %va_arg.on_stack, %va_arg.in_reg
  %_0 = phi i64 [ %10, %va_arg.in_reg ], [ %13, %va_arg.on_stack ]
  ret i64 %_0
}

attributes #0 = { uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="generic" "target-features"="+v8a,+outline-atomics" }

!llvm.module.flags = !{!0, !1, !2}
!llvm.ident = !{!3}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 7, !"uwtable", i32 2}
!2 = !{i32 7, !"frame-pointer", i32 1}
!3 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!4 = !{i64 -7542522322023173990}
!5 = !{i64 -7403566267722170155}
!6 = !{i64 3832354651819332949}
!7 = !{i64 -3961039088432752339}
!8 = !{i64 5985954481134168832}
!9 = !{i64 8263235085960526106}
!10 = !{i64 5843679358118385526}
