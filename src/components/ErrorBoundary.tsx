"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div
            style={{
              minHeight: "100vh",
              backgroundColor: "#E0E7FF",
              color: "#fafafa",
              padding: "2rem",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>오류가 발생했습니다</h1>
            <p style={{ color: "#a1a1aa", fontSize: "0.875rem" }}>
              페이지를 새로고침해 주세요.
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
