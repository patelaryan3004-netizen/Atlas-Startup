import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import LandingPage from './LandingPage.jsx';
import './styles.css';

const isLanding = window.location.pathname.replace(/\/$/, '') === '/welcome';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isLanding ? <LandingPage /> : <App />}
  </React.StrictMode>
);
