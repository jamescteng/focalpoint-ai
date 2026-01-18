
import React from 'react';
import ReactDOM from 'react-dom/client';
import './src/styles.css';
import './src/i18n';
import App from './App';

declare global {
  interface Window {
    __fpSendBeacon?: (event: string, extra?: Record<string, unknown>) => void;
    __fpMountTimeout?: ReturnType<typeof setTimeout>;
  }
}

if (window.__fpSendBeacon) {
  window.__fpSendBeacon('js_loaded');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if (window.__fpMountTimeout) {
  clearTimeout(window.__fpMountTimeout);
}
if (window.__fpSendBeacon) {
  window.__fpSendBeacon('react_mounted');
}
