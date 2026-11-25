import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { Icon } from './Icon';

export interface PracticeTarget {
  topic: string;
  role: string;
  level: string;
}

/** 启动专项练习：成功后由上层切到面试页；失败时在按钮旁显示原因 */
export type StartPractice = (target: PracticeTarget) => Promise<void>;

export function PracticeButton({ target, onPractice }: { target: PracticeTarget; onPractice: StartPractice }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sec, setSec] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setSec(0);
    const t = setInterval(() => setSec((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  async function start() {
    setError('');
    setLoading(true);
    try {
      await onPractice(target);
    } catch (e) {
      setError(`出题失败：${errorMessage(e)}`);
      setLoading(false);
    }
  }

  return (
    <span className="practice">
      <button type="button" className="sm soft" onClick={start} disabled={loading} title={`围绕「${target.topic}」出 3 道题`}>
        {loading ? <span className="spinner" /> : <Icon name="target" size={14} />}
        {loading ? <span className="num">出题中… {sec} 秒</span> : '专项练习'}
      </button>
      {error && <span className="error-text practice-error">{error}</span>}
    </span>
  );
}
