import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { useApp, AppProvider } from '../app-provider'

// Keep tests isolated — the provider persists the chat-collapsed flag to localStorage.
beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})

// Test helper component that reads context values
function TestConsumer() {
  const { previewUrl, isGenerating, sidebarWidth, setPreviewUrl, setIsGenerating, setSidebarWidth } = useApp()
  return (
    <div>
      <span data-testid="previewUrl">{previewUrl ?? 'null'}</span>
      <span data-testid="isGenerating">{String(isGenerating)}</span>
      <span data-testid="sidebarWidth">{sidebarWidth}</span>
      <button onClick={() => setPreviewUrl('https://example.com')}>set-url</button>
      <button onClick={() => setPreviewUrl(null)}>clear-url</button>
      <button onClick={() => setIsGenerating(true)}>start-gen</button>
      <button onClick={() => setIsGenerating(false)}>stop-gen</button>
      <button onClick={() => setSidebarWidth(400)}>set-width</button>
    </div>
  )
}

describe('AppProvider', () => {
  it('provides initial state values', () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )

    expect(screen.getByTestId('previewUrl')).toHaveTextContent('null')
    expect(screen.getByTestId('isGenerating')).toHaveTextContent('false')
    expect(screen.getByTestId('sidebarWidth')).toHaveTextContent('320')
  })

  it('updates previewUrl via setPreviewUrl', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )

    await act(async () => {
      screen.getByText('set-url').click()
    })

    expect(screen.getByTestId('previewUrl')).toHaveTextContent('https://example.com')
  })

  it('clears previewUrl to null', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )

    await act(async () => {
      screen.getByText('set-url').click()
    })
    expect(screen.getByTestId('previewUrl')).toHaveTextContent('https://example.com')

    await act(async () => {
      screen.getByText('clear-url').click()
    })
    expect(screen.getByTestId('previewUrl')).toHaveTextContent('null')
  })

  it('updates isGenerating state', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )

    await act(async () => {
      screen.getByText('start-gen').click()
    })
    expect(screen.getByTestId('isGenerating')).toHaveTextContent('true')

    await act(async () => {
      screen.getByText('stop-gen').click()
    })
    expect(screen.getByTestId('isGenerating')).toHaveTextContent('false')
  })

  it('updates sidebarWidth state', async () => {
    render(
      <AppProvider>
        <TestConsumer />
      </AppProvider>
    )

    await act(async () => {
      screen.getByText('set-width').click()
    })
    expect(screen.getByTestId('sidebarWidth')).toHaveTextContent('400')
  })

  it('does not update previewUrl when same value is set', async () => {
    const renderSpy = vi.fn()

    function SpyConsumer() {
      const { previewUrl, setPreviewUrl } = useApp()
      renderSpy()
      return (
        <div>
          <span data-testid="url">{previewUrl ?? 'null'}</span>
          <button onClick={() => setPreviewUrl('https://example.com')}>set</button>
        </div>
      )
    }

    render(
      <AppProvider>
        <SpyConsumer />
      </AppProvider>
    )

    const initialRenderCount = renderSpy.mock.calls.length

    // Set URL first time
    await act(async () => {
      screen.getByText('set').click()
    })

    const afterFirstSet = renderSpy.mock.calls.length

    // Set same URL again — should be a no-op
    await act(async () => {
      screen.getByText('set').click()
    })

    // Should not cause additional renders
    expect(renderSpy.mock.calls.length).toBe(afterFirstSet)
  })
})

describe('AppProvider chat-collapsed state', () => {
  function CollapseConsumer() {
    const { isChatCollapsed, chatFocusRequest, setChatCollapsed, openChatAndFocus } = useApp()
    return (
      <div>
        <span data-testid="collapsed">{String(isChatCollapsed)}</span>
        <span data-testid="focus-request">{chatFocusRequest}</span>
        <button onClick={() => setChatCollapsed(true)}>hide</button>
        <button onClick={() => setChatCollapsed(false)}>show</button>
        <button onClick={openChatAndFocus}>open-chat</button>
      </div>
    )
  }

  it('defaults to not collapsed', () => {
    render(
      <AppProvider>
        <CollapseConsumer />
      </AppProvider>
    )
    expect(screen.getByTestId('collapsed')).toHaveTextContent('false')
  })

  it('collapses and persists the preference to localStorage', async () => {
    render(
      <AppProvider>
        <CollapseConsumer />
      </AppProvider>
    )

    await act(async () => {
      screen.getByText('hide').click()
    })

    expect(screen.getByTestId('collapsed')).toHaveTextContent('true')
    expect(localStorage.getItem('repolens:chat-collapsed')).toBe('1')
  })

  it('restores the collapsed preference from localStorage on mount', async () => {
    localStorage.setItem('repolens:chat-collapsed', '1')

    await act(async () => {
      render(
        <AppProvider>
          <CollapseConsumer />
        </AppProvider>
      )
    })

    expect(screen.getByTestId('collapsed')).toHaveTextContent('true')
  })

  it('opens a collapsed chat and issues a new focus request', async () => {
    render(
      <AppProvider>
        <CollapseConsumer />
      </AppProvider>
    )

    await act(async () => screen.getByText('hide').click())
    expect(screen.getByTestId('collapsed')).toHaveTextContent('true')

    await act(async () => screen.getByText('open-chat').click())

    expect(screen.getByTestId('collapsed')).toHaveTextContent('false')
    expect(screen.getByTestId('focus-request')).toHaveTextContent('1')
    expect(localStorage.getItem('repolens:chat-collapsed')).toBe('0')
  })
})

describe('useApp', () => {
  it('throws when used outside AppProvider', () => {
    function BadConsumer() {
      useApp()
      return null
    }

    // Suppress console.error for expected React error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<BadConsumer />)).toThrow('useApp must be used within an AppProvider')
    spy.mockRestore()
  })
})

describe('AppProvider memoization', () => {
  it('context value identity is stable across re-renders when deps are unchanged', async () => {
    const capturedValues: unknown[] = []

    function Spy() {
      const ctx = useApp()
      capturedValues.push(ctx)
      return null
    }

    function Parent() {
      const [, setTick] = React.useState(0)
      return (
        <>
          <button data-testid="force-render" onClick={() => setTick(t => t + 1)} />
          <AppProvider>
            <Spy />
          </AppProvider>
        </>
      )
    }

    render(<Parent />)

    // Force parent re-render — AppProvider re-renders but state unchanged
    await act(async () => {
      screen.getByTestId('force-render').click()
    })

    expect(capturedValues.length).toBeGreaterThanOrEqual(2)
    expect(capturedValues[0]).toBe(capturedValues[1])
  })
})
