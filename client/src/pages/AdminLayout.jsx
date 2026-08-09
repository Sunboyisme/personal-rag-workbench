import SourcesPage from './SourcesPage';
import ChunkLabPage from './ChunkLabPage';
import IndexPage from './IndexPage';
import RetrievalLabPage from './RetrievalLabPage';
import RecipesPage from './RecipesPage';
import ModulesPage from './ModulesPage';
import PromptPage from './PromptPage';
import LogsPage from './LogsPage';
import EvalPage from './EvalPage';

const NAV = [
  { path: '/admin/sources', label: '数据源', key: 'sources' },
  { path: '/admin/chunk-lab', label: '切分实验室', key: 'chunk-lab' },
  { path: '/admin/index', label: '建库', key: 'index' },
  { path: '/admin/retrieval-lab', label: '检索实验室', key: 'retrieval-lab' },
  { path: '/admin/recipes', label: 'Recipe', key: 'recipes' },
  { path: '/admin/prompts', label: '提示词', key: 'prompts' },
  { path: '/admin/eval', label: '评测', key: 'eval' },
  { path: '/admin/logs', label: '执行日志', key: 'logs' },
  { path: '/admin/modules', label: '模块管理', key: 'modules' },
];

export default function AdminLayout({ tab, navigate, traceId }) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="brand">
          <div className="brand-mark">RAG</div>
          <div>
            <strong>实验工作台</strong>
            <span>RAG Workbench</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <a
              key={item.key}
              href={item.path}
              className={tab === item.key ? 'active' : ''}
              onClick={(e) => navigate(e, item.path)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="btn ghost admin-back" onClick={(e) => navigate(e, '/')}>
          返回问答
        </button>
      </aside>
      <main className="admin-main">
        {tab === 'sources' && <SourcesPage />}
        {tab === 'chunk-lab' && <ChunkLabPage />}
        {tab === 'index' && <IndexPage />}
        {tab === 'retrieval-lab' && <RetrievalLabPage />}
        {tab === 'recipes' && <RecipesPage />}
        {tab === 'prompts' && <PromptPage />}
        {tab === 'eval' && <EvalPage />}
        {tab === 'logs' && <LogsPage navigate={navigate} traceId={traceId} />}
        {tab === 'modules' && <ModulesPage />}
      </main>
    </div>
  );
}
