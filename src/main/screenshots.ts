import { desktopCapturer, screen } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Capture, ScreenshotService } from './tracker'

// Width of the preview sent to the renderer. The full-resolution PNG goes to disk;
// only this smaller copy crosses the bridge.
const THUMBNAIL_WIDTH = 320

export const createScreenshotService = (directory: string): ScreenshotService => ({
  capture: async (takenAt: number): Promise<Capture> => {
    const primary = screen.getPrimaryDisplay()

    // getSources scales to thumbnailSize, so ask for the display's real pixel
    // dimensions or the capture comes back downscaled.
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(primary.size.width * primary.scaleFactor),
        height: Math.round(primary.size.height * primary.scaleFactor)
      }
    })

    const source = sources.find((candidate) => candidate.display_id === String(primary.id))
    const image = (source ?? sources[0])?.thumbnail
    if (image === undefined) throw new Error('no screen source available')
    if (image.isEmpty()) throw new Error('capture returned an empty image')

    await mkdir(directory, { recursive: true })
    const fileName = `${takenAt}.png`
    await writeFile(join(directory, fileName), image.toPNG())

    return { fileName, dataUrl: image.resize({ width: THUMBNAIL_WIDTH }).toDataURL() }
  }
})
