import { Component } from 'react';

/**
 * Keeps one screen's crash from blanking the whole app: shows the error,
 * a retry, and (optionally) a way to clear that screen's stored data.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name || 'screen'}]`, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { name = 'This screen', onReset, resetLabel } = this.props;
    return (
      <div className="m-4 space-y-2 rounded-3xl border border-rose/40 bg-rose/10 p-4 text-sm">
        <p className="font-semibold">{name} hit a problem</p>
        <p className="break-words font-mono text-[11px] text-ink-dim">{String(error?.message || error)}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className="btn-primary px-4 py-2 text-xs">Try again</button>
          {onReset && (
            <button type="button" onClick={async () => { await onReset(); this.setState({ error: null }); }} className="btn-quiet px-4 py-2 text-xs">
              {resetLabel || 'Reset'}
            </button>
          )}
        </div>
      </div>
    );
  }
}
