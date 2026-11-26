import { Component, ErrorInfo, ReactNode } from "react";

type State = { hasError: boolean; message: string };

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || "An unexpected error occurred." };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RepTrack UI error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="w-full space-y-4 rounded-2xl border border-line bg-card p-6">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted">{this.state.message}</p>
          <button type="button" className="btn-primary w-full" onClick={() => window.location.reload()}>
            Reload RepTrack
          </button>
        </div>
      </div>
    );
  }
}
