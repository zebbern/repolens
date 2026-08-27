export const PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT = 'repolens:private-repository-access-revoked'
export const PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT = 'repolens:private-repository-access-revocation-finished'
export const PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY = 'repolens:private-repository-revocation'

export function notifyPrivateRepositoryAccessRevoked(): void {
  if (typeof window === 'undefined') return
  try {
    const nonce = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}:${Math.random()}`
    window.localStorage.setItem(PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY, nonce)
  } catch {
    // Same-window revocation still works when storage is unavailable.
  }
  window.dispatchEvent(new Event(PRIVATE_REPOSITORY_ACCESS_REVOKED_EVENT))
}

export function notifyPrivateRepositoryAccessRevocationFinished(success: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PRIVATE_REPOSITORY_ACCESS_REVOCATION_FINISHED_EVENT, {
    detail: { success },
  }))
}

export function isPrivateRepositoryRevocation(event: StorageEvent): boolean {
  return event.key === PRIVATE_REPOSITORY_REVOCATION_STORAGE_KEY
}
