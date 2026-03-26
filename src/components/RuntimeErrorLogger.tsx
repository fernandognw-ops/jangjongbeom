"use client";

import { useEffect } from "react";

function toErrorLike(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

export function RuntimeErrorLogger() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onError = (event: ErrorEvent) => {
      const err = event.error instanceof Error ? event.error : undefined;
      const message = err?.message ?? event.message ?? "Unknown runtime error";
      const stack = err?.stack;
      console.group("%c[RUNTIME ERROR] Uncaught error captured", "color:#dc2626;font-weight:700;");
      console.error("message:", message);
      console.error("source:", {
        file: event.filename ?? "(unknown)",
        line: event.lineno ?? 0,
        column: event.colno ?? 0,
      });
      if (stack) {
        console.error("stack:\n" + stack);
      } else {
        console.error("stack: (not available)");
      }
      console.groupEnd();
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const parsed = toErrorLike(event.reason);
      console.group("%c[RUNTIME ERROR] Unhandled promise rejection", "color:#dc2626;font-weight:700;");
      console.error("message:", parsed.message);
      if (parsed.stack) {
        console.error("stack:\n" + parsed.stack);
      } else {
        console.error("stack: (not available)");
      }
      console.groupEnd();
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}

