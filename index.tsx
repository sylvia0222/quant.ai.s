import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    console.error('App runtime error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#e2e8f0', fontFamily: 'monospace' }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>畫面載入失敗</h1>
          <p style={{ fontSize: 12, color: '#94a3b8' }}>錯誤訊息：{this.state.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
