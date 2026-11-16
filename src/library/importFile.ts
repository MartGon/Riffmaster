import * as alphaTab from '@coderline/alphatab'
import { addSong } from './db'
import type { Song } from './types'

/**
 * Reads a tab file, checks that it can be opened, and stores it in the library.
 * Throws if the file is not a supported tab format.
 */
/** The file is not a tab the player can read. Other errors mean it could not be stored. */
export class UnreadableFileError extends Error {}

export async function importFile(file: File): Promise<Song> {
  let data: ArrayBuffer
  let score: alphaTab.model.Score
  try {
    data = await file.arrayBuffer()
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data))
  } catch (error) {
    throw new UnreadableFileError(String(error))
  }
  return addSong({
    title: score.title.trim() || file.name.replace(/\.[^.]+$/, ''),
    artist: score.artist.trim(),
    fileName: file.name,
    data,
  })
}
