import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBDatabase as FakeIDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { installFakeWebLocks } from './fake-web-lock-manager'
import { withCacheMutationLock } from '../cache-mutation-lock'
import {
  getToursByRepo,
  getTour,
  saveTour,
  deleteTour,
  deleteToursForRepo,
  _resetDBConnection,
} from '../tour-cache'
import type { Tour } from '@/types/tours'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTour(overrides: Partial<Tour> = {}): Tour {
  return {
    id: crypto.randomUUID(),
    name: 'Test Tour',
    description: 'A test tour',
    repoKey: 'owner/repo',
    stops: [
      {
        id: 's1',
        filePath: 'src/index.ts',
        startLine: 1,
        endLine: 10,
        annotation: 'Entry point',
        title: 'Index',
      },
      {
        id: 's2',
        filePath: 'src/utils.ts',
        startLine: 5,
        endLine: 15,
        annotation: 'Utility functions',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    visibility: 'public',
    ...overrides,
  }
}

async function removeTourPrincipal(id: string): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('repolens-cache', 2)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tours', 'readwrite')
    const store = tx.objectStore('tours')
    const request = store.get(id)
    request.onsuccess = () => {
      const record = request.result as Record<string, unknown>
      delete record.principal
      store.put(record)
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('tour-cache (IndexedDB)', () => {
  beforeEach(() => {
    // Reset cached DB connection so each test gets a fresh IndexedDB instance.
    _resetDBConnection()
    globalThis.indexedDB = new IDBFactory()
    globalThis.IDBKeyRange = IDBKeyRange
    installFakeWebLocks()
  })

  // -----------------------------------------------------------------------
  // saveTour + getTour round-trip
  // -----------------------------------------------------------------------

  it('round-trips: saveTour then getTour returns stored data', async () => {
    const tour = makeTour({ id: 'tour-1' })
    await saveTour(tour)

    const retrieved = await getTour('tour-1')

    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe('tour-1')
    expect(retrieved!.name).toBe('Test Tour')
    expect(retrieved!.repoKey).toBe('owner/repo')
    expect(retrieved!.stops).toHaveLength(2)
  })

  it('getTour returns null for non-existent id', async () => {
    const result = await getTour('nonexistent')
    expect(result).toBeNull()
  })

  it('only returns a private tour to the principal that saved it', async () => {
    const tour = makeTour({ id: 'private-tour', visibility: 'private' })
    await saveTour(tour, { principal: 'oauth:account-a' })

    await expect(getTour('private-tour', { principal: 'oauth:account-a' })).resolves.toMatchObject({
      id: 'private-tour',
      principal: 'oauth:account-a',
    })
    await expect(getTour('private-tour', { principal: 'oauth:account-b' })).resolves.toBeNull()
    await expect(getTour('private-tour', { principal: null })).resolves.toBeNull()
  })

  it('hides a private tour whose stored principal is missing', async () => {
    await saveTour(makeTour({ id: 'orphaned-private-tour', visibility: 'private' }), { principal: 'oauth:account-a' })
    await removeTourPrincipal('orphaned-private-tour')

    await expect(getTour('orphaned-private-tour', { principal: 'oauth:account-a' })).resolves.toBeNull()
    await expect(getToursByRepo('owner/repo', { principal: 'oauth:account-a' })).resolves.toEqual([])
  })

  it('lists public tours and only principal-owned private tours', async () => {
    await saveTour(makeTour({ id: 'public-tour', visibility: 'public' }))
    await saveTour(makeTour({ id: 'private-tour', visibility: 'private' }), { principal: 'pat:account-a' })

    await expect(getToursByRepo('owner/repo', { principal: 'pat:account-b' })).resolves.toEqual([
      expect.objectContaining({ id: 'public-tour', visibility: 'public' }),
    ])
    await expect(getToursByRepo('owner/repo', { principal: 'pat:account-a' })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'public-tour', visibility: 'public' }),
      expect.objectContaining({ id: 'private-tour', visibility: 'private', principal: 'pat:account-a' }),
    ]))
  })

  // -----------------------------------------------------------------------
  // getToursByRepo
  // -----------------------------------------------------------------------

  it('getToursByRepo returns only tours for the given repoKey', async () => {
    await saveTour(makeTour({ id: 'a', repoKey: 'owner/alpha' }))
    await saveTour(makeTour({ id: 'b', repoKey: 'owner/beta' }))
    await saveTour(makeTour({ id: 'c', repoKey: 'owner/alpha' }))

    const tours = await getToursByRepo('owner/alpha')

    expect(tours).toHaveLength(2)
    expect(tours.every((t) => t.repoKey === 'owner/alpha')).toBe(true)
  })

  it('getToursByRepo returns empty array for unknown repoKey', async () => {
    await saveTour(makeTour({ repoKey: 'owner/other' }))

    const tours = await getToursByRepo('owner/unknown')

    expect(tours).toEqual([])
  })

  it('getToursByRepo returns tours sorted by updatedAt descending', async () => {
    const now = Date.now()
    await saveTour(makeTour({ id: 'old', repoKey: 'owner/repo', updatedAt: now - 2000 }))
    await saveTour(makeTour({ id: 'new', repoKey: 'owner/repo', updatedAt: now }))
    await saveTour(makeTour({ id: 'mid', repoKey: 'owner/repo', updatedAt: now - 1000 }))

    const tours = await getToursByRepo('owner/repo')

    // saveTour auto-updates updatedAt, so just verify order is descending
    for (let i = 0; i < tours.length - 1; i++) {
      expect(tours[i].updatedAt).toBeGreaterThanOrEqual(tours[i + 1].updatedAt)
    }
  })

  // -----------------------------------------------------------------------
  // Upsert behaviour
  // -----------------------------------------------------------------------

  it('saveTour with an existing id updates the record (upsert)', async () => {
    const tour = makeTour({ id: 'upsert-test', name: 'Original' })
    await saveTour(tour)

    await saveTour({ ...tour, name: 'Updated' })

    const retrieved = await getTour('upsert-test')
    expect(retrieved!.name).toBe('Updated')
  })

  it('saveTour updates updatedAt timestamp automatically', async () => {
    const tour = makeTour({ id: 'ts-test', updatedAt: 1000 })
    await saveTour(tour)

    const retrieved = await getTour('ts-test')
    // saveTour uses Date.now() internally, so updatedAt should be recent
    expect(retrieved!.updatedAt).toBeGreaterThan(1000)
  })

  it('waits for the shared cache mutation lock before writing', async () => {
    let release!: () => void
    let entered!: () => void
    const lockEntered = new Promise<void>(resolve => { entered = resolve })
    const lockRelease = new Promise<void>(resolve => { release = resolve })
    const holder = withCacheMutationLock(undefined, async () => {
      entered()
      await lockRelease
    })
    await lockEntered

    let settled = false
    const write = saveTour(makeTour({ id: 'lock-wait' })).finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await Promise.all([holder, write])
    await expect(getTour('lock-wait')).resolves.toMatchObject({ id: 'lock-wait' })
  })

  it('rejects when a write transaction aborts', async () => {
    const original = FakeIDBDatabase.prototype.transaction
    const transaction = vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (this: InstanceType<typeof FakeIDBDatabase>, ...args) {
      const tx = original.apply(this, args as never)
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort())
      return tx
    } as typeof FakeIDBDatabase.prototype.transaction)

    await expect(saveTour(makeTour({ id: 'aborted-write' }))).rejects.toBeInstanceOf(DOMException)
    transaction.mockRestore()
  })

  it('rejects when a transaction reports an error without aborting', async () => {
    const original = FakeIDBDatabase.prototype.transaction
    const transaction = vi.spyOn(FakeIDBDatabase.prototype, 'transaction').mockImplementation(function (this: InstanceType<typeof FakeIDBDatabase>, ...args) {
      const tx = original.apply(this, args as never)
      if (args[1] === 'readwrite') queueMicrotask(() => tx.onerror?.(new Event('error')))
      return tx
    } as typeof FakeIDBDatabase.prototype.transaction)

    await expect(saveTour(makeTour({ id: 'errored-write' }))).rejects.toThrow('Transaction failed')
    transaction.mockRestore()
  })

  // -----------------------------------------------------------------------
  // deleteTour
  // -----------------------------------------------------------------------

  it('deleteTour removes the tour and getTour returns null afterward', async () => {
    await saveTour(makeTour({ id: 'to-delete' }))

    await deleteTour('to-delete')

    const result = await getTour('to-delete')
    expect(result).toBeNull()
  })

  it('deleteTour on non-existent id does not throw', async () => {
    await expect(deleteTour('nonexistent')).resolves.toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // deleteToursForRepo
  // -----------------------------------------------------------------------

  it('deleteToursForRepo removes all tours for the repoKey', async () => {
    await saveTour(makeTour({ id: 'del-1', repoKey: 'owner/target' }))
    await saveTour(makeTour({ id: 'del-2', repoKey: 'owner/target' }))
    await saveTour(makeTour({ id: 'keep', repoKey: 'owner/keep' }))

    await deleteToursForRepo('owner/target')

    const deleted = await getToursByRepo('owner/target')
    const kept = await getToursByRepo('owner/keep')

    expect(deleted).toHaveLength(0)
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe('keep')
  })

  it('deleteToursForRepo on unknown repoKey does not throw', async () => {
    await expect(deleteToursForRepo('owner/unknown')).resolves.toBeUndefined()
  })

  // -----------------------------------------------------------------------
  // Graceful failure when IndexedDB is unavailable
  // -----------------------------------------------------------------------

  it('getToursByRepo returns empty array when indexedDB.open throws', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error('IndexedDB unavailable')
      },
    } as unknown as IDBFactory

    const result = await getToursByRepo('owner/repo')
    expect(result).toEqual([])
  })

  it('getTour returns null when indexedDB.open throws', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error('IndexedDB unavailable')
      },
    } as unknown as IDBFactory

    const result = await getTour('some-id')
    expect(result).toBeNull()
  })

  it('rejects when indexedDB.open throws', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error('IndexedDB unavailable')
      },
    } as unknown as IDBFactory

    await expect(saveTour(makeTour())).rejects.toThrow('IndexedDB unavailable')
  })

  it('rejects when deleting and indexedDB.open throws', async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new Error('IndexedDB unavailable')
      },
    } as unknown as IDBFactory

    await expect(deleteTour('some-id')).rejects.toThrow('IndexedDB unavailable')
  })
})
