import { Component, type ReactNode } from 'react'

/** React unmounts the whole tree on an uncaught render error, so one page of the paper throwing
 *  used to take the town's canvas down with it. A page is the most a viewer may lose. */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <p className="feed-empty">This page could not be read. Close the paper and open it again.</p>
    )
  }
}
