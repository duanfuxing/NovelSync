import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 生产环境禁用浏览器默认右键菜单（刷新、另存为、打印等）
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
