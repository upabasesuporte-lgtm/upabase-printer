import React from "react";

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      const err = this.state.error as Error | null;
      return (
        <div className="p-8 text-white bg-zinc-950 min-h-screen">
          <div className="max-w-2xl mx-auto bg-red-950/40 border border-red-500/30 rounded-2xl p-6 space-y-4">
            <h1 className="text-lg font-bold text-red-400">Erro inesperado no aplicativo</h1>
            <p className="text-sm text-red-300 font-mono break-all">{err?.message ?? "Erro desconhecido"}</p>
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">Stack trace</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap">{err?.stack}</pre>
            </details>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}