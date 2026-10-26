import { Component, type ErrorInfo, type ReactNode } from 'react'

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
      return (
        <main className="fatal-error">
          <section>
            <span aria-hidden="true">!</span>
            <h1>Visningen krasjet</h1>
            <p>Appen klarte ikke å vise dette datasettet. Last siden på nytt og prøv igjen.</p>
            <pre>{this.state.error.message}</pre>
            <button type="button" onClick={() => window.location.reload()}>Last inn siden på nytt</button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}
