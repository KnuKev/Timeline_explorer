import { Component, type ErrorInfo, type ReactNode } from 'react'
import { getStoredLanguage, translations } from './i18n'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Timeline Kart rendering error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const t = translations[getStoredLanguage()]
      return (
        <main className="fatal-error">
          <section>
            <span aria-hidden="true">!</span>
            <h1>{t.crashTitle}</h1>
            <p>{t.crashBody}</p>
            <pre>{this.state.error.message}</pre>
            <button type="button" onClick={() => window.location.reload()}>{t.reload}</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
