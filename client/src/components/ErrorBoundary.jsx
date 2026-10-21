import { Component } from 'react';

// Keeps a rendering bug on one page from blanking the whole app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Something went wrong on this page</h1>
        <p className="mt-2 text-slate-500 dark:text-slate-400">{this.state.error.message}</p>
        <button type="button" className="btn-primary mt-6" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
