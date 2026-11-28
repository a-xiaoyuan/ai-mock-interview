// 服务端设置了访问口令（ACCESS_TOKEN）时，先在这里输入口令
import { useState, type FormEvent } from 'react';
import { errorMessage, login } from '../api';
import { Icon, LogoMark } from './Icon';

export function LoginPage({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await login(token.trim());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submit}>
        <LogoMark size={40} />
        <h1>输入访问口令</h1>
        <p className="muted small">这个站点设置了访问口令，口令由部署它的人提供。登录后在这个浏览器里保持 30 天。</p>
        <div className="field">
          <label htmlFor="access-token">访问口令</label>
          <input
            id="access-token"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
          />
        </div>
        {error && (
          <div className="error-box" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary" type="submit" disabled={!token.trim() || busy}>
          {busy ? <span className="spinner" /> : <Icon name="lock" />}
          进入
        </button>
      </form>
    </section>
  );
}
