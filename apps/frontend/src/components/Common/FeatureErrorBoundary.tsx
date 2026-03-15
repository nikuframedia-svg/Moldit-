import React from 'react';

interface Props {
  module: string;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class FeatureErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[FeatureErrorBoundary:${this.props.module}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-card)',
            borderRadius: 8,
            border: '1px solid var(--semantic-red)',
            margin: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--semantic-red)', marginBottom: 8 }}>
            Erro no módulo {this.props.module}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            {this.state.error?.message ?? 'Erro inesperado'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--accent)',
              color: 'var(--text-inverse, #fff)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
