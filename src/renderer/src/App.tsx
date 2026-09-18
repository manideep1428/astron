import React from 'react'
import { Dashboard } from './components/Dashboard'
import { AgentDots } from './components/AgentDots'
import { AssistantOverlay } from './components/AssistantOverlay'

export default function App(): React.JSX.Element {
  const windowKind = new URLSearchParams(window.location.search).get('window')
  if (windowKind === 'assistant') {
    return <AssistantOverlay />
  }
  if (windowKind === 'agent-hub') {
    return <AgentDots />
  }

  return <Dashboard />
}
