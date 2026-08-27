export interface TourStop {
  id: string
  filePath: string
  /** 1-based start line */
  startLine: number
  /** 1-based end line */
  endLine: number
  /** Markdown annotation displayed at this stop */
  annotation: string
  /** Optional short label for the stop */
  title?: string
}

export interface Tour {
  id: string
  name: string
  description: string
  /** Repository key in `owner/repo` format */
  repoKey: string
  /** Repository visibility, when known. Legacy tours may omit this field. */
  visibility?: 'public' | 'private'
  /** Credential principal that owns a private tour. */
  principal?: string
  stops: TourStop[]
  /** Unix-ms timestamp */
  createdAt: number
  /** Unix-ms timestamp */
  updatedAt: number
}

export interface TourState {
  tours: Tour[]
  activeTour: Tour | null
  activeStopIndex: number
  isPlaying: boolean
}
