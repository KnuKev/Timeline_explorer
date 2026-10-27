import { Component, type ErrorInfo, type ReactNode } from 'react'
import { readLanguage, strings } from './i18n'

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
      const ui = strings[readLanguage()]
      return (
        <main className="fatal-error">
          <section>
            <span aria-hidden="true">!</span>
            <h1>{ui.errorTitle}</h1>
            <p>{ui.errorDescription}</p>
            <pre>{this.state.error.message}</pre>
            <button type="button" onClick={() => window.location.reload()}>{ui.reload}</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
