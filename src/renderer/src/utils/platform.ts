export const isMac = window.astronApi?.platform === 'darwin'

export const assistantShortcut = isMac ? 'Control + Command + A' : 'Ctrl + Win + A'
export const shortcutAction = isMac ? 'Tap' : 'Hold'
export const assistantStopInstruction = isMac
  ? `Tap ${assistantShortcut} again to send`
  : 'Release to send'
