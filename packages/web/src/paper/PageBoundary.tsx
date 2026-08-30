import { Component, type ReactNode } from 'react'

/** React unmounts the whole tree on an uncaught render error, so one page of the paper throwing
 *  used to take the town's canvas down with it. A page is the most a viewer may lose to a page;
 *  `main.tsx` mounts a second one at the root, where the loss is the session. */
export class PageBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  // The line the viewer is left with says nothing about what broke, so the console is the only
  // record there is.
  override componentDidCatch(err: Error): void {
    console.error(err)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      this.props.fallback ?? (
        <p className="feed-empty">
          This page could not be read. Close the paper and open it again.
        </p>
      )
    )
  }
}
