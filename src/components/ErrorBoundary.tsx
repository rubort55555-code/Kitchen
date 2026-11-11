// Запасной экран: если при отрисовке что-то сломалось, вместо белого экрана показываем объяснение и кнопки.
import { Component, type ReactNode } from "react";
import { reportError } from "../lib/store";
import { resetApp } from "../lib/resetApp";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { reportError(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen" role="alert">
        <h1>Приложение не открылось</h1>
        <p className="muted">Ваши данные на телефоне целы. Чаще всего помогает обновление файлов приложения.</p>
        <button className="btn" onClick={() => { resetApp(); }}>Обновить приложение</button>
        <button className="btn sec" style={{ marginTop: 10 }} onClick={() => location.reload()}>Просто перезагрузить</button>
      </div>
    );
  }
}
