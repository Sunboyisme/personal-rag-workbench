import { useEffect, useState } from 'react';
import ChatPage from './pages/ChatPage';
import AdminLayout from './pages/AdminLayout';

const ADMIN_PREFIX = '/admin';

function parsePath(pathname) {
  const adminLogDetail = pathname.match(/^\/admin\/logs\/([^/]+)$/);
  if (adminLogDetail) {
    return { name: 'admin', tab: 'logs', traceId: decodeURIComponent(adminLogDetail[1]) };
  }

  // 旧链接兼容：/traces/:id → 后台日志详情
  const legacyTrace = pathname.match(/^\/traces\/([^/]+)$/);
  if (legacyTrace) {
    return { name: 'redirect', path: `/admin/logs/${encodeURIComponent(legacyTrace[1])}` };
  }

  const adminTraceMatch = pathname.match(/^\/admin\/traces\/([^/]+)$/);
  if (adminTraceMatch) {
    return { name: 'redirect', path: `/admin/logs/${encodeURIComponent(adminTraceMatch[1])}` };
  }

  if (pathname === ADMIN_PREFIX || pathname === `${ADMIN_PREFIX}/`) {
    return { name: 'admin', tab: 'sources' };
  }
  if (pathname.startsWith(`${ADMIN_PREFIX}/`)) {
    const tab = pathname.slice(`${ADMIN_PREFIX}/`.length).split('/')[0];
    const valid = [
      'sources',
      'chunk-lab',
      'index',
      'retrieval-lab',
      'recipes',
      'modules',
      'prompts',
      'logs',
      'eval',
    ];
    if (valid.includes(tab)) return { name: 'admin', tab };
  }

  return { name: 'chat' };
}

export default function App() {
  const [route, setRoute] = useState(() => parsePath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(event, nextPath) {
    if (event?.preventDefault) event.preventDefault();
    if (window.location.pathname === nextPath) return;
    window.history.pushState({}, '', nextPath);
    setRoute(parsePath(nextPath));
  }

  useEffect(() => {
    if (route.name === 'redirect' && route.path) {
      window.history.replaceState({}, '', route.path);
      setRoute(parsePath(route.path));
    }
  }, [route]);

  if (route.name === 'redirect') {
    return null;
  }

  if (route.name === 'chat') {
    return <ChatPage navigate={navigate} />;
  }

  return <AdminLayout tab={route.tab} navigate={navigate} traceId={route.traceId} />;
}
