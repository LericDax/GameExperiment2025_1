const trackImports = import.meta.glob('../sounds/music/tracks/*.{mp3,MP3,wav,WAV}', {
  eager: true,
  import: 'default',
  query: '?url',
})

function formatTitleFromFileName(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  const words = withoutExtension
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) {
    return fileName
  }
  return words.replace(/\b(\w)(\w*)/g, (match, first, rest) => {
    return first.toUpperCase() + rest.toLowerCase()
  })
}

const tracks = Object.entries(trackImports)
  .map(([path, url]) => {
    const segments = path.split('/')
    const fileName = segments[segments.length - 1]
    return {
      id: fileName,
      url,
      fileName,
      title: formatTitleFromFileName(fileName),
    }
  })
  .sort((a, b) => a.fileName.localeCompare(b.fileName))

export function getMusicTracks() {
  return tracks.map((track) => ({ ...track }))
}

export function hasMusicTracks() {
  return tracks.length > 0
}
