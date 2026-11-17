import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../styles/base.css';
import '../styles/measure.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
