import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ToursProvider, useTours } from '../tours-provider'
import type { Tour, TourStop } from '@/types/tours'

// ---------------------------------------------------------------------------
// Mock the tour-cache module so we don't hit real IndexedDB
// ---------------------------------------------------------------------------

vi.mock('@/lib/cache/tour-cache', () => ({
  getToursByRepo: vi.fn().mockResolvedValue([]),
  saveTour: vi.fn().mockResolvedValue(undefined),
  deleteTour: vi.fn().mockResolvedValue(undefined),
}))

import {
  getToursByRepo as mockGetToursByRepo,
  saveTour as mockSaveTour,
  deleteTour as mockDeleteTour,
} from '@/lib/cache/tour-cache'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  return <ToursProvider>{children}</ToursProvider>
}

function makeTour(overrides: Partial<Tour> = {}): Tour {
  return {
    id: crypto.randomUUID(),
    name: 'Test Tour',
    description: 'A tour for testing',
    repoKey: 'owner/repo',
    stops: [
      { id: 's1', filePath: 'src/a.ts', startLine: 1, endLine: 10, annotation: 'Stop A', title: 'A' },
      { id: 's2', filePath: 'src/b.ts', startLine: 5, endLine: 20, annotation: 'Stop B', title: 'B' },
      { id: 's3', filePath: 'src/c.ts', startLine: 1, endLine: 5, annotation: 'Stop C' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToursProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockGetToursByRepo as Mock).mockResolvedValue([])
  })

  // ---- Initial state -----------------------------------------------------

  it('provides initial state with empty tours and no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    expect(result.current.tours).toEqual([])
    expect(result.current.activeTour).toBeNull()
    expect(result.current.activeStopIndex).toBe(0)
    expect(result.current.isPlaying).toBe(false)
  })

  // ---- useTours outside provider -----------------------------------------

  it('useTours throws when used outside ToursProvider', () => {
    // Suppress console.error from React for the expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTours())
    }).toThrow('useTours must be used within a ToursProvider')

    spy.mockRestore()
  })

  // ---- loadTours ---------------------------------------------------------

  it('loadTours populates tours from cache', async () => {
    const tour = makeTour({ id: 'cached-tour' })
    ;(mockGetToursByRepo as Mock).mockResolvedValue([tour])

    const { result } = renderHook(() => useTours(), { wrapper })

    await act(async () => {
      await result.current.loadTours('owner/repo')
    })

    expect(mockGetToursByRepo).toHaveBeenCalledWith('owner/repo')
    expect(result.current.tours).toHaveLength(1)
    expect(result.current.tours[0].id).toBe('cached-tour')
  })

  // ---- createTour --------------------------------------------------------

  it('createTour adds a new tour to state and calls saveTour on cache', async () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    let created: Tour | undefined
    await act(async () => {
      created = await result.current.createTour('New Tour', 'Description', 'owner/repo')
    })

    expect(created).toBeDefined()
    expect(created!.name).toBe('New Tour')
    expect(created!.description).toBe('Description')
    expect(created!.repoKey).toBe('owner/repo')
    expect(created!.stops).toEqual([])
    expect(created!.id).toBeDefined()
    expect(created!.createdAt).toBeGreaterThan(0)
    expect(created!.updatedAt).toBeGreaterThan(0)
    expect(mockSaveTour).toHaveBeenCalledTimes(1)
    expect(result.current.tours).toHaveLength(1)
  })

  // ---- deleteTour --------------------------------------------------------

  it('deleteTour removes the tour from state and calls deleteTour on cache', async () => {
    const tour = makeTour({ id: 'to-delete' })
    ;(mockGetToursByRepo as Mock).mockResolvedValue([tour])

    const { result } = renderHook(() => useTours(), { wrapper })

    await act(async () => {
      await result.current.loadTours('owner/repo')
    })
    expect(result.current.tours).toHaveLength(1)

    await act(async () => {
      await result.current.deleteTour('to-delete')
    })

    expect(mockDeleteTour).toHaveBeenCalledWith('to-delete')
    expect(result.current.tours).toHaveLength(0)
  })

  it('deleteTour stops playback if the deleted tour is the active one', async () => {
    const tour = makeTour({ id: 'active-del' })
    ;(mockGetToursByRepo as Mock).mockResolvedValue([tour])

    const { result } = renderHook(() => useTours(), { wrapper })

    await act(async () => {
      await result.current.loadTours('owner/repo')
    })

    act(() => {
      result.current.startTour(tour)
    })
    expect(result.current.isPlaying).toBe(true)

    await act(async () => {
      await result.current.deleteTour('active-del')
    })

    expect(result.current.isPlaying).toBe(false)
    expect(result.current.activeTour).toBeNull()
    expect(result.current.activeStopIndex).toBe(0)
  })

  // ---- startTour / stopTour ----------------------------------------------

  it('startTour sets activeTour, activeStopIndex=0, and isPlaying=true', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    expect(result.current.activeTour).toEqual(tour)
    expect(result.current.activeStopIndex).toBe(0)
    expect(result.current.isPlaying).toBe(true)
  })

  it('stopTour clears activeTour, resets activeStopIndex, sets isPlaying=false', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.stopTour()
    })

    expect(result.current.activeTour).toBeNull()
    expect(result.current.activeStopIndex).toBe(0)
    expect(result.current.isPlaying).toBe(false)
  })

  // ---- nextStop / prevStop / goToStop ------------------------------------

  it('nextStop increments activeStopIndex', () => {
    const tour = makeTour() // 3 stops
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })
    expect(result.current.activeStopIndex).toBe(0)

    act(() => {
      result.current.nextStop()
    })
    expect(result.current.activeStopIndex).toBe(1)
  })

  it('nextStop clamps at the last stop', () => {
    const tour = makeTour() // 3 stops (max index = 2)
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    // Advance past the last stop
    act(() => { result.current.nextStop() }) // 1
    act(() => { result.current.nextStop() }) // 2
    act(() => { result.current.nextStop() }) // still 2

    expect(result.current.activeStopIndex).toBe(2)
  })

  it('prevStop decrements activeStopIndex', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })
    act(() => {
      result.current.nextStop()
    })
    expect(result.current.activeStopIndex).toBe(1)

    act(() => {
      result.current.prevStop()
    })
    expect(result.current.activeStopIndex).toBe(0)
  })

  it('prevStop clamps at 0', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.prevStop()
    })
    expect(result.current.activeStopIndex).toBe(0)
  })

  it('goToStop sets specific index', () => {
    const tour = makeTour() // 3 stops
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.goToStop(2)
    })
    expect(result.current.activeStopIndex).toBe(2)
  })

  it('goToStop clamps to valid bounds', () => {
    const tour = makeTour() // 3 stops
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.goToStop(100) // clamped to 2
    })
    expect(result.current.activeStopIndex).toBe(2)

    act(() => {
      result.current.goToStop(-5) // clamped to 0
    })
    expect(result.current.activeStopIndex).toBe(0)
  })

  // ---- addStop -----------------------------------------------------------

  it('addStop appends a stop with a generated id and persists', async () => {
    const tour = makeTour({ stops: [] })
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.addStop({
        filePath: 'src/new.ts',
        startLine: 1,
        endLine: 10,
        annotation: 'New stop',
        title: 'New',
      })
    })

    expect(result.current.activeTour!.stops).toHaveLength(1)
    expect(result.current.activeTour!.stops[0].filePath).toBe('src/new.ts')
    expect(result.current.activeTour!.stops[0].id).toBeDefined()
    expect(mockSaveTour).toHaveBeenCalled()
  })

  // ---- removeStop --------------------------------------------------------

  it('removeStop removes the stop by id and persists', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    const stopId = tour.stops[1].id // 's2'
    act(() => {
      result.current.removeStop(stopId)
    })

    expect(result.current.activeTour!.stops).toHaveLength(2)
    expect(result.current.activeTour!.stops.find((s) => s.id === stopId)).toBeUndefined()
    expect(mockSaveTour).toHaveBeenCalled()
  })

  // ---- updateStop --------------------------------------------------------

  it('updateStop patches the stop fields and persists', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.updateStop('s1', { annotation: 'Updated annotation', title: 'Updated' })
    })

    const updated = result.current.activeTour!.stops.find((s) => s.id === 's1')
    expect(updated!.annotation).toBe('Updated annotation')
    expect(updated!.title).toBe('Updated')
    expect(mockSaveTour).toHaveBeenCalled()
  })

  // ---- reorderStops ------------------------------------------------------

  it('reorderStops reorders the stops array to match the given id order', () => {
    const tour = makeTour()
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    // Reverse the order
    act(() => {
      result.current.reorderStops(['s3', 's2', 's1'])
    })

    const stops = result.current.activeTour!.stops
    expect(stops[0].id).toBe('s3')
    expect(stops[1].id).toBe('s2')
    expect(stops[2].id).toBe('s1')
    expect(mockSaveTour).toHaveBeenCalled()
  })

  // ---- Edge cases: no active tour (noop) ----------------------------------

  it('addStop is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.addStop({
        filePath: 'src/test.ts',
        startLine: 1,
        endLine: 5,
        annotation: 'Test',
      })
    })

    expect(result.current.activeTour).toBeNull()
    expect(mockSaveTour).not.toHaveBeenCalled()
  })

  it('removeStop is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.removeStop('nonexistent')
    })

    expect(result.current.activeTour).toBeNull()
    expect(mockSaveTour).not.toHaveBeenCalled()
  })

  it('updateStop is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.updateStop('s1', { annotation: 'updated' })
    })

    expect(result.current.activeTour).toBeNull()
    expect(mockSaveTour).not.toHaveBeenCalled()
  })

  it('reorderStops is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.reorderStops(['s1', 's2'])
    })

    expect(result.current.activeTour).toBeNull()
    expect(mockSaveTour).not.toHaveBeenCalled()
  })

  it('nextStop is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.nextStop()
    })

    expect(result.current.activeStopIndex).toBe(0)
  })

  it('goToStop is a noop when no active tour', () => {
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.goToStop(5)
    })

    expect(result.current.activeStopIndex).toBe(0)
  })

  // ---- reorderStops filters unknown IDs -----------------------------------

  it('reorderStops filters out unknown stop IDs', () => {
    const tour = makeTour() // 3 stops: s1, s2, s3
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    act(() => {
      result.current.reorderStops(['s2', 'nonexistent', 's1'])
    })

    const stops = result.current.activeTour!.stops
    expect(stops).toHaveLength(2) // only s2 and s1
    expect(stops[0].id).toBe('s2')
    expect(stops[1].id).toBe('s1')
  })

  // ---- saveTour sync with activeTour --------------------------------------

  it('saveTour updates activeTour when the saved tour has the same ID', async () => {
    const tour = makeTour({ id: 'sync-test', name: 'Original' })
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })
    expect(result.current.activeTour!.name).toBe('Original')

    const updatedTour = { ...tour, name: 'Updated' }
    await act(async () => {
      await result.current.saveTour(updatedTour)
    })

    expect(result.current.activeTour!.name).toBe('Updated')
    expect(mockSaveTour).toHaveBeenCalled()
  })

  it('saveTour does NOT update activeTour when tour has different ID', async () => {
    const active = makeTour({ id: 'active-id', name: 'Active' })
    const other = makeTour({ id: 'other-id', name: 'Other' })
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(active)
    })

    await act(async () => {
      await result.current.saveTour(other)
    })

    expect(result.current.activeTour!.id).toBe('active-id')
    expect(result.current.activeTour!.name).toBe('Active')
  })

  // ---- deleteTour when not the active tour --------------------------------

  it('deleteTour keeps activeTour when a different tour is deleted', async () => {
    const active = makeTour({ id: 'keep-active' })
    const other = makeTour({ id: 'delete-me' })
    ;(mockGetToursByRepo as Mock).mockResolvedValue([active, other])

    const { result } = renderHook(() => useTours(), { wrapper })

    await act(async () => {
      await result.current.loadTours('owner/repo')
    })

    act(() => {
      result.current.startTour(active)
    })
    expect(result.current.isPlaying).toBe(true)

    await act(async () => {
      await result.current.deleteTour('delete-me')
    })

    expect(result.current.activeTour!.id).toBe('keep-active')
    expect(result.current.isPlaying).toBe(true)
    expect(result.current.tours).toHaveLength(1)
  })

  // ---- removeStop clamps activeStopIndex ----------------------------------

  it('removeStop clamps activeStopIndex if it was pointing at the last stop', () => {
    const tour = makeTour() // 3 stops: s1, s2, s3
    const { result } = renderHook(() => useTours(), { wrapper })

    act(() => {
      result.current.startTour(tour)
    })

    // Go to last stop (index 2)
    act(() => {
      result.current.goToStop(2)
    })
    expect(result.current.activeStopIndex).toBe(2)

    // Remove last stop
    act(() => {
      result.current.removeStop('s3')
    })

    // Index should be clamped to new max (1)
    expect(result.current.activeStopIndex).toBeLessThanOrEqual(1)
    expect(result.current.activeTour!.stops).toHaveLength(2)
  })
})
