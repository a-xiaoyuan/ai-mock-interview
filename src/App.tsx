import { useEffect, useRef, useState } from 'react';
import { createPlan, getConfig } from './api';
import { BankPage } from './components/BankPage';
import { Icon, LogoMark } from './components/Icon';
import { InterviewPage } from './components/InterviewPage';
import type { StartPractice } from './components/PracticeButton';
import { ReportPage } from './components/ReportPage';
import { SetupPage } from './components/SetupPage';
import { markUsed } from './lib/bank';
import { saveRecord } from './lib/history';
import type { InterviewConfig, InterviewRecord, Plan, ServerConfig } from './types';

type View =
  | { name: 'setup' }
  | { name: 'bank' }
  | { name: 'interview'; config: InterviewConfig; plan: Plan; key: number }
  | { name: 'report'; record: InterviewRecord };

export default function App() {
  const [view, setView] = useState<View>({ name: 'setup' });
  const [server, setServer] = useState<ServerConfig | null>(null);
  const [serverError, setServerError] = useState(false);
  /** 首页正在填写的设置（简历、JD 等），离开首页再回来、以及专项练习时沿用；不需要触发重新渲染 */
  const lastConfig = useRef<InterviewConfig | null>(null);

  useEffect(() => {
    getConfig()
      .then(setServer)
      .catch(() => setServerError(true));
  }, []);

  /** 面试进行中离开要先确认 */
  function go(next: View) {
    if (view.name === 'interview' && !confirm('面试还没结束，确定离开？')) return;
    setView(next);
    window.scrollTo(0, 0);
  }
  const goHome = () => go({ name: 'setup' });

  function startInterview(config: InterviewConfig, plan: Plan) {
    markUsed(plan.questions.flatMap((q) => (q.from ? [q.from] : [])));
    setView({ name: 'interview', config, plan, key: Date.now() });
    window.scrollTo(0, 0);
  }

  const startPractice: StartPractice = async ({ topic, role, level }) => {
    const base = lastConfig.current ?? { style: 'gentle' as const, resume: '', jd: '' };
    const config: InterviewConfig = { ...base, role, level, count: 3, focus: topic };
    startInterview(config, await createPlan(config));
  };

  function onDone(record: InterviewRecord) {
    saveRecord(record);
    setView({ name: 'report', record });
    window.scrollTo(0, 0);
  }

  return (
    <>
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="AI 模拟面试，回到首页">
          <LogoMark />
          <span>AI 模拟面试</span>
        </button>
        <nav className="nav" aria-label="主导航">
          <button aria-current={view.name === 'setup' ? 'page' : undefined} onClick={goHome}>
            <Icon name="play" />
            开始面试
          </button>
          <button aria-current={view.name === 'bank' ? 'page' : undefined} onClick={() => go({ name: 'bank' })}>
            <Icon name="library" />
            面经题库
          </button>
        </nav>
        <span className="spacer" />
        <ModeBadge server={server} error={serverError} />
        {(view.name === 'interview' || view.name === 'report') && (
          <button className="sm ghost back" onClick={goHome}>
            <Icon name="arrowLeft" />
            返回首页
          </button>
        )}
      </header>
      <main>
        {view.name === 'setup' && (
          <SetupPage
            initial={lastConfig.current}
            onChange={(c) => {
              lastConfig.current = c;
            }}
            onOpenBank={() => go({ name: 'bank' })}
            onStart={startInterview}
            onPractice={startPractice}
            onOpenRecord={(record) => go({ name: 'report', record })}
          />
        )}
        {view.name === 'bank' && <BankPage />}
        {view.name === 'interview' && <InterviewPage key={view.key} config={view.config} plan={view.plan} onDone={onDone} runners={server?.runner ?? []} />}
        {view.name === 'report' && <ReportPage record={view.record} onAgain={goHome} onPractice={startPractice} />}
      </main>
    </>
  );
}

function ModeBadge({ server, error }: { server: ServerConfig | null; error: boolean }) {
  const [cls, text] = error
    ? ['bad', '服务未连接']
    : !server
      ? ['', '连接中…']
      : server.mock
        ? ['warn', 'Mock 模式 · 未配置模型']
        : ['ok', `模型：${server.model}`];
  return (
    <span className={`status ${cls}`} title={text}>
      <i />
      <span className="status-text">{text}</span>
    </span>
  );
}
