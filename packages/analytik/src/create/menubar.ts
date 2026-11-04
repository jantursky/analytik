export const MENUBAR_REPO = 'jantursky/analytik'
export const MENUBAR_APP = 'Analytik Menu Bar.app'

export interface MenubarIo {
  platform: string
  /** The newest releases of the repository, newest first. */
  releases: () => Promise<
    { tag_name: string; draft?: boolean; assets: { name: string; browser_download_url: string }[] }[]
  >
  /** Downloads a file and returns where it was saved. */
  download: (url: string) => Promise<string>
  /** Unpacks a zip next to itself and returns the folder. */
  unzip: (zip: string) => string
  /** Replaces the app in `dir` with the unpacked one. */
  install: (unpacked: string, dir: string) => string
  /** Opens the installed app. */
  open: (app: string) => void
  log: (message: string) => void
}

/** Finds the newest Mac app release, downloads it and puts the app into `dir` (Applications by default). */
export async function installMenubar(
  io: MenubarIo,
  options: { dir?: string; open?: boolean } = {},
): Promise<{ tag: string; app: string }> {
  if (io.platform !== 'darwin') throw new Error('The menu bar app is for macOS 14 or later.')
  const release = (await io.releases()).find((r) => r.tag_name.startsWith('menubar-v') && r.draft !== true)
  const asset = release?.assets.find((a) => a.name.endsWith('.zip'))
  if (!release || !asset) throw new Error(`No Mac app release found at https://github.com/${MENUBAR_REPO}/releases`)
  io.log(`Downloading ${release.tag_name}`)
  const app = io.install(io.unzip(await io.download(asset.browser_download_url)), options.dir ?? '/Applications')
  io.log(`Installed ${app}`)
  if (options.open !== false) io.open(app)
  return { tag: release.tag_name, app }
}
