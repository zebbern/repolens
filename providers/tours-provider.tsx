"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import type { Tour, TourStop } from '@/types/tours'
import {
  getToursByRepo,
  saveTour as saveTourToDB,
  deleteTour as deleteTourFromDB,
} from '@/lib/cache/tour-cache'
import { getGitHubCredentialPrincipal } from '@/lib/github/client'

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface ToursContextType {
  tours: Tour[]
  activeTour: Tour | null
  activeStopIndex: number
  isPlaying: boolean

  // CRUD
  loadTours: (repoKey: string) => Promise<void>
  createTour: (name: string, description: string, repoKey: string) => Promise<Tour>
  saveTour: (tour: Tour) => Promise<void>
  deleteTour: (id: string) => Promise<void>

  // Playback
  startTour: (tour: Tour) => void
  stopTour: () => void
  goToStop: (index: number) => void
  nextStop: () => void
  prevStop: () => void

  // Stop mutations
  addStop: (stop: Omit<TourStop, 'id'>) => void
  removeStop: (stopId: string) => void
  updateStop: (stopId: string, updates: Partial<TourStop>) => void
  reorderStops: (stopIds: string[]) => void
}

const ToursContext = createContext<ToursContextType | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToursProvider({
  children,
  repoKey,
  repoVisibility,
}: {
  children: ReactNode
  repoKey?: string
  repoVisibility?: Tour['visibility']
}) {
  const [tours, setTours] = useState<Tour[]>([])
  const [activeTour, setActiveTour] = useState<Tour | null>(null)
  const [activeStopIndex, setActiveStopIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const currentRepoKeyRef = useRef<string | null>(repoKey ?? null)
  const loadGenerationRef = useRef(0)
  const providerActiveRef = useRef(true)

  useLayoutEffect(() => {
    providerActiveRef.current = true
    return () => {
      providerActiveRef.current = false
      loadGenerationRef.current += 1
    }
  }, [])

  const clearRepositoryState = useCallback(() => {
    setTours([])
    setActiveTour(null)
    setActiveStopIndex(0)
    setIsPlaying(false)
  }, [])

  useLayoutEffect(() => {
    const nextRepoKey = repoKey ?? null
    if (currentRepoKeyRef.current === nextRepoKey) return
    currentRepoKeyRef.current = nextRepoKey
    loadGenerationRef.current += 1
    clearRepositoryState()
  }, [clearRepositoryState, repoKey])

  const attachRepositoryVisibility = useCallback((tour: Tour): Tour => {
    if (!repoVisibility) return tour
    if (currentRepoKeyRef.current !== null && currentRepoKeyRef.current !== tour.repoKey) return tour
    return { ...tour, visibility: repoVisibility }
  }, [repoVisibility])

  const claimRepositoryScope = useCallback((nextRepoKey: string): boolean => {
    if (!providerActiveRef.current) return false
    if (currentRepoKeyRef.current !== null && currentRepoKeyRef.current !== nextRepoKey) return false
    currentRepoKeyRef.current = nextRepoKey
    return true
  }, [])
  const hasFixedRepositoryScope = repoKey !== undefined

  // ---- CRUD ---------------------------------------------------------------

  const loadTours = useCallback(async (repoKey: string) => {
    if (!providerActiveRef.current) return
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    if (hasFixedRepositoryScope && !claimRepositoryScope(repoKey)) return
    if (currentRepoKeyRef.current !== repoKey) {
      currentRepoKeyRef.current = repoKey
      clearRepositoryState()
    }
    const loaded = await getToursByRepo(repoKey, { principal: getGitHubCredentialPrincipal() })
    if (!providerActiveRef.current || loadGenerationRef.current !== generation || currentRepoKeyRef.current !== repoKey) return
    setTours(loaded.map(attachRepositoryVisibility))
  }, [attachRepositoryVisibility, claimRepositoryScope, clearRepositoryState, hasFixedRepositoryScope])

  const createTour = useCallback(
    async (name: string, description: string, repoKey: string): Promise<Tour> => {
      if (!providerActiveRef.current) throw new Error('Tours provider is inactive')
      const now = Date.now()
      const tour: Tour = {
        id: crypto.randomUUID(),
        name,
        description,
        repoKey,
        stops: [],
        createdAt: now,
        updatedAt: now,
      }
      if (!claimRepositoryScope(tour.repoKey)) {
        throw new Error('Cannot create a tour outside the current repository scope')
      }
      const generation = loadGenerationRef.current
      const persistedTour = attachRepositoryVisibility(tour)
      await saveTourToDB(persistedTour, { principal: getGitHubCredentialPrincipal() })
      if (!providerActiveRef.current || loadGenerationRef.current !== generation || currentRepoKeyRef.current !== tour.repoKey) return persistedTour
      setTours((prev) => [persistedTour, ...prev])
      return persistedTour
    },
    [attachRepositoryVisibility, claimRepositoryScope],
  )

  const saveTour = useCallback(async (tour: Tour) => {
    if (!providerActiveRef.current) throw new Error('Tours provider is inactive')
    if (!claimRepositoryScope(tour.repoKey)) {
      throw new Error('Cannot save a tour outside the current repository scope')
    }
    const generation = loadGenerationRef.current
    const persistedTour = attachRepositoryVisibility(tour)
    await saveTourToDB(persistedTour, { principal: getGitHubCredentialPrincipal() })
    if (!providerActiveRef.current || loadGenerationRef.current !== generation || currentRepoKeyRef.current !== tour.repoKey) return
    setTours((prev) => prev.map((t) => (t.id === tour.id ? { ...persistedTour, updatedAt: Date.now() } : t)))
    // Keep activeTour in sync if it's the one being saved
    setActiveTour((prev) => (prev?.id === tour.id ? { ...persistedTour, updatedAt: Date.now() } : prev))
  }, [attachRepositoryVisibility, claimRepositoryScope])

  const deleteTour = useCallback(
    async (id: string) => {
      if (!providerActiveRef.current) return
      const knownTour = tours.find(tour => tour.id === id) ?? (activeTour?.id === id ? activeTour : null)
      if (!knownTour || !claimRepositoryScope(knownTour.repoKey)) return
      const generation = loadGenerationRef.current
      await deleteTourFromDB(id)
      if (!providerActiveRef.current || loadGenerationRef.current !== generation || currentRepoKeyRef.current !== knownTour.repoKey) return
      setTours((prev) => prev.filter((t) => t.id !== id))
      // If the deleted tour is active, stop playback
      setActiveTour((prev) => {
        if (prev?.id === id) {
          setIsPlaying(false)
          setActiveStopIndex(0)
          return null
        }
        return prev
      })
    },
    [activeTour, claimRepositoryScope, tours],
  )

  // ---- Playback -----------------------------------------------------------

  const startTour = useCallback((tour: Tour) => {
    if (!providerActiveRef.current) return
    if (!claimRepositoryScope(tour.repoKey)) return
    const scopedTour = attachRepositoryVisibility(tour)
    setActiveTour(scopedTour)
    setActiveStopIndex(0)
    setIsPlaying(true)
  }, [attachRepositoryVisibility, claimRepositoryScope])

  const stopTour = useCallback(() => {
    if (!providerActiveRef.current) return
    setActiveTour(null)
    setActiveStopIndex(0)
    setIsPlaying(false)
  }, [])

  const goToStop = useCallback(
    (index: number) => {
      if (!providerActiveRef.current) return
      setActiveTour((tour) => {
        if (!tour || currentRepoKeyRef.current !== tour.repoKey) return tour
        const clamped = Math.max(0, Math.min(index, tour.stops.length - 1))
        setActiveStopIndex(clamped)
        return tour
      })
    },
    [],
  )

  const nextStop = useCallback(() => {
    if (!providerActiveRef.current) return
    setActiveStopIndex((prev) => {
      if (!activeTour || currentRepoKeyRef.current !== activeTour.repoKey) return prev
      return Math.min(prev + 1, activeTour.stops.length - 1)
    })
  }, [activeTour])

  const prevStop = useCallback(() => {
    if (!providerActiveRef.current) return
    setActiveStopIndex((prev) => Math.max(prev - 1, 0))
  }, [])

  // ---- Stop mutations (operate on activeTour) -----------------------------

  const addStop = useCallback(
    (stop: Omit<TourStop, 'id'>) => {
      const generation = loadGenerationRef.current
      setActiveTour((prev) => {
        if (!providerActiveRef.current || loadGenerationRef.current !== generation || !prev || currentRepoKeyRef.current !== prev.repoKey) return prev
        const newStop: TourStop = { ...stop, id: crypto.randomUUID() }
        const updated: Tour = {
          ...prev,
          stops: [...prev.stops, newStop],
          updatedAt: Date.now(),
        }
        const persisted = attachRepositoryVisibility(updated)
        setTours((all) => all.map((t) => (t.id === persisted.id ? persisted : t)))
        saveTourToDB(persisted, { principal: getGitHubCredentialPrincipal() }).catch((err) => console.error('Failed to persist tour:', err))
        return persisted
      })
    },
    [attachRepositoryVisibility],
  )

  const removeStop = useCallback(
    (stopId: string) => {
      const generation = loadGenerationRef.current
      setActiveTour((prev) => {
        if (!providerActiveRef.current || loadGenerationRef.current !== generation || !prev || currentRepoKeyRef.current !== prev.repoKey) return prev
        const updated: Tour = {
          ...prev,
          stops: prev.stops.filter((s) => s.id !== stopId),
          updatedAt: Date.now(),
        }
        const persisted = attachRepositoryVisibility(updated)
        setTours((all) => all.map((t) => (t.id === persisted.id ? persisted : t)))
        saveTourToDB(persisted, { principal: getGitHubCredentialPrincipal() }).catch((err) => console.error('Failed to persist tour:', err))
        // Clamp activeStopIndex if needed
        setActiveStopIndex((idx) => Math.min(idx, Math.max(0, persisted.stops.length - 1)))
        return persisted
      })
    },
    [attachRepositoryVisibility],
  )

  const updateStop = useCallback(
    (stopId: string, updates: Partial<TourStop>) => {
      const generation = loadGenerationRef.current
      setActiveTour((prev) => {
        if (!providerActiveRef.current || loadGenerationRef.current !== generation || !prev || currentRepoKeyRef.current !== prev.repoKey) return prev
        const updated: Tour = {
          ...prev,
          stops: prev.stops.map((s) => (s.id === stopId ? { ...s, ...updates } : s)),
          updatedAt: Date.now(),
        }
        const persisted = attachRepositoryVisibility(updated)
        setTours((all) => all.map((t) => (t.id === persisted.id ? persisted : t)))
        saveTourToDB(persisted, { principal: getGitHubCredentialPrincipal() }).catch((err) => console.error('Failed to persist tour:', err))
        return persisted
      })
    },
    [attachRepositoryVisibility],
  )

  const reorderStops = useCallback(
    (stopIds: string[]) => {
      const generation = loadGenerationRef.current
      setActiveTour((prev) => {
        if (!providerActiveRef.current || loadGenerationRef.current !== generation || !prev || currentRepoKeyRef.current !== prev.repoKey) return prev
        const stopMap = new Map(prev.stops.map((s) => [s.id, s]))
        const reordered = stopIds
          .map((id) => stopMap.get(id))
          .filter((s): s is TourStop => s !== undefined)
        const updated: Tour = {
          ...prev,
          stops: reordered,
          updatedAt: Date.now(),
        }
        const persisted = attachRepositoryVisibility(updated)
        setTours((all) => all.map((t) => (t.id === persisted.id ? persisted : t)))
        saveTourToDB(persisted, { principal: getGitHubCredentialPrincipal() }).catch((err) => console.error('Failed to persist tour:', err))
        return persisted
      })
    },
    [attachRepositoryVisibility],
  )

  // ---- Context value (memoized) -------------------------------------------

  const value = useMemo<ToursContextType>(
    () => ({
      tours,
      activeTour,
      activeStopIndex,
      isPlaying,
      loadTours,
      createTour,
      saveTour,
      deleteTour,
      startTour,
      stopTour,
      goToStop,
      nextStop,
      prevStop,
      addStop,
      removeStop,
      updateStop,
      reorderStops,
    }),
    [
      tours,
      activeTour,
      activeStopIndex,
      isPlaying,
      loadTours,
      createTour,
      saveTour,
      deleteTour,
      startTour,
      stopTour,
      goToStop,
      nextStop,
      prevStop,
      addStop,
      removeStop,
      updateStop,
      reorderStops,
    ],
  )

  return <ToursContext.Provider value={value}>{children}</ToursContext.Provider>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTours(): ToursContextType {
  const context = useContext(ToursContext)
  if (context === null) {
    throw new Error('useTours must be used within a ToursProvider')
  }
  return context
}
