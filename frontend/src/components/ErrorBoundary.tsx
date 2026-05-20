"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center h-full bg-[#0D1117] p-8">
            <div className="text-center">
              <p className="text-sm text-red-400 font-medium">Something went wrong</p>
              <p className="text-[10px] text-gray-600 mt-1 max-w-md">
                {this.state.error?.message}
              </p>
              <button
                onClick={() => this.setState({ hasError: false })}
                className="mt-3 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}