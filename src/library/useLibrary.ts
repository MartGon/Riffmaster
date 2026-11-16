import { useCallback, useEffect, useState } from 'react'
import { deleteSong, listSongs, practiceBySong, setBlockedHandler, type SongPractice } from './db'
import { importFile, UnreadableFileError } from './importFile'
import type { Song } from './types'

export interface ImportResult {
  added: Song[]
  /** Names of files that could not be read as tabs. */
  failed: string[]
  /** Why readable files could not be stored, if any could not. */
  storageError: string | null
}

/** The list of saved songs, kept in step with the browser's storage. */
export function useLibrary() {
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [storageError, setStorageError] = useState(false)
  const [practice, setPractice] = useState<Map<string, SongPractice>>(new Map())
  /** True while another tab with an older version of the app keeps the library from opening. */
  const [blocked, setBlocked] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSongs(await listSongs())
      setPractice(await practiceBySong())
    } catch {
      setSongs([])
      setStorageError(true)
    }
  }, [])

  useEffect(() => {
    let current = true
    setBlockedHandler(() => current && setBlocked(true))
    listSongs().then(
      (list) => {
        if (!current) return
        setBlocked(false)
        setSongs(list)
        void practiceBySong().then((totals) => current && setPractice(totals), () => {})
      },
      () => {
        if (!current) return
        setSongs([])
        setStorageError(true)
      },
    )
    return () => {
      current = false
      setBlockedHandler(null)
    }
  }, [])

  const addFiles = useCallback(
    async (files: File[]): Promise<ImportResult> => {
      const result: ImportResult = { added: [], failed: [], storageError: null }
      for (const file of files) {
        try {
          result.added.push(await importFile(file))
        } catch (error) {
          if (error instanceof UnreadableFileError) result.failed.push(file.name)
          else result.storageError = error instanceof Error ? error.message : String(error)
        }
      }
      await refresh()
      return result
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await deleteSong(id)
      await refresh()
    },
    [refresh],
  )

  return { songs, practice, storageError, blocked, refresh, addFiles, remove }
}
