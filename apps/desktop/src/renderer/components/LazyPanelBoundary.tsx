import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  resetKey: string;
}
interface State {
  failed: boolean;
}

export class LazyPanelBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Unable to load KubeDeck panel", error.message);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="error-panel" role="alert">
          <strong>Unable to load this panel.</strong>
          <p>Restart KubeDeck or reopen the packaged application.</p>
        </section>
      );
    }
    return this.props.children;
  }
}
