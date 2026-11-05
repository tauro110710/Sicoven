import React from 'react';

type Props = {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
};

type State = { error: Error | null };

export class ReportErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('SICOVEN report rendering failed:', this.props.title, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section role="alert" className="mx-auto max-w-3xl rounded-xl border border-rose-300 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-rose-900">No se pudo abrir {this.props.title}</h2>
          <p className="mt-2 text-sm text-slate-700">El informe detectó un problema con los datos o con su cálculo. SICOVEN no mostrará cifras incompletas ni alterará los asientos.</p>
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-xs text-rose-900">{this.state.error.message}</pre>
          <button type="button" onClick={this.props.onBack} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Volver a Balances NIF</button>
        </section>
      );
    }
    return this.props.children;
  }
}
