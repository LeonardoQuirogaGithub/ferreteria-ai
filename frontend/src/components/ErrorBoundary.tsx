import { Component, type ReactNode } from 'react';
import { Alert, Button } from './ui';

/** Evita que un error de renderizado de una pantalla deje toda la aplicación en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert tone="danger" title="Esta pantalla tuvo un error inesperado">
        <p>Puede volver a intentarlo o navegar a otra sección.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => this.setState({ error: null })}>Reintentar</Button>
      </Alert>
    );
  }
}
