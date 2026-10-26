import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root'));

// A viewer tab opens at /#/view?u=...; load the heavy PDF renderer only then.
if (window.location.hash.startsWith('#/view')) {
  import('./PdfViewer.jsx').then(({ default: PdfViewer }) => {
    root.render(<React.StrictMode><PdfViewer /></React.StrictMode>);
  });
} else if (window.location.hash.startsWith('#/table')) {
  import('./TableViewer.jsx').then(({ default: TableViewer }) => {
    root.render(<React.StrictMode><TableViewer /></React.StrictMode>);
  });
} else if (window.location.hash.startsWith('#/image')) {
  import('./ImageViewer.jsx').then(({ default: ImageViewer }) => {
    root.render(<React.StrictMode><ImageViewer /></React.StrictMode>);
  });
} else {
  import('./App.jsx').then(({ default: App }) => {
    root.render(<React.StrictMode><App /></React.StrictMode>);
  });
}
