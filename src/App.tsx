import { useEffect, useState } from 'react';
import { createPlan, getConfig } from './api';
import { InterviewPage } from './components/InterviewPage';
import type { StartPractice } from './components/PracticeButton';
import { ReportPage } from './components/ReportPage';
import { SetupPage } from './components/SetupPage';
import { saveRecord } from './lib/history';
import type { InterviewConfig, InterviewRecord, Plan, ServerConfig } from './types';

type View =
  | { name: 'setup' }
  | { name: 'interview'; config: InterviewConfig; plan: Plan; key: number }
  | { name: 'report'; record: InterviewRecord };

export default function App() {
  const [view, setView] = useState<View>({ name: 'setup' });
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [serverError, setServerError] = useState(false);
  /** 首页最近一次填写的设置（简历、JD 等），回到首页和专项练习时沿用 */
  const [lastConfig, setLastConfig] = useState<InterviewConfig | null>(null);

  useEffect(() => {
    getConfig()
      .then(setServer)
      .catch(() => setServerError(true));
  }, []);

  function goHome() {
    if (view.name === 'interview' && !confirm('面试还没结束，确定离开？')) return;
    setView({ name: 'setup' });
  }

  function startInterview(config: InterviewConfig, plan: Plan) {
    if (!config.focus) setLastConfig(config);
    setView({ name: 'interview', config, plan, key: Date.now() });
  }

  const startPractice: StartPractice = async ({ topic, role, level }) => {
    const base = lastConfig ?? { style: 'gentle' as const, resume: '', jd: '' };
    const config: InterviewConfig = { ...base, role, level, count: 3, focus: topic };
    const plan = await createPlan({ role, level, resume: config.resume.trim(), jd: config.jd.trim(), count: 3, focus: topic });
    startInterview(config, plan);
  };

  function onDone(record: InterviewRecord) {
    saveRecord(record);
    setView({ name: 'report', record });
  }

  return (
    <>
      <header className="topbar">
        <h1>AI 模拟面试</h1>
        <ModeBadge server={server} error={serverError} />
        <span className="spacer" />
        {view.name !== 'setup' && <button onClick={goHome}>返回首页</button>}
      </header>
      <main>
        {view.name === 'setup' && (
          <SetupPage
            initial={lastConfig}
            onStart={startInterview}
            onPractice={startPractice}
            onOpenRecord={(record) => setView({ name: 'report', record })}
          />
        )}
        {view.name === 'interview' && <InterviewPage key={view.key} config={view.config} plan={view.plan} onDone={onDone} />}
        {view.name === 'report' && <ReportPage record={view.record} onAgain={() => setView({ name: 'setup' })} onPractice={startPractice} />}
      </main>
    </>
  );
}

function ModeBadge({ server, error }: { server: ServerConfig | null; error: boolean }) {
  if (error) return <span className="badge warn">服务未连接</span>;
  if (!server) return <span className="badge">连接中…</span>;
  return server.mock ? <span className="badge warn">Mock 模式 · 未配置模型</span> : <span className="badge">模型：{server.model}</span>;
}
