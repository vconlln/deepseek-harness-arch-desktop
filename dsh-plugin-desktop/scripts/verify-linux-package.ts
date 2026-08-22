/** Verify the unsigned Linux x64 artifacts: pacman archive and AppImage. */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46]) // 0x7f 'E' 'L' 'F'

/** Archive and filesystem primitives injected so tests run without real artifacts. */
export interface LinuxPackageVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact names. */
  readonly version: string
  /** Absolute dist directory containing the artifacts. */
  readonly distDir: string
  /** bsdtar executable used to inspect the pacman archive. */
  readonly bsdtarCommand: string
  /** List the entries of one archive; rejects on archive failure. */
  readonly listArchive: (archivePath: string) => string[]
  /** Read one regular-file entry out of an archive; rejects when absent. */
  readonly readArchiveEntry: (archivePath: string, entryName: string) => string
  /** Stat one artifact path. */
  readonly statArtifact: (artifactPath: string) => { isFile: () => boolean; size: number; mode: number }
  /** Read one regular file. */
  readonly readFile: (filePath: string) => Buffer
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

function listWithBsdtar(command: string, archivePath: string): string[] {
  const result = spawnSync(command, ['-tf', archivePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) {
    throw new Error(`bsdtar ${command} is required to inspect the pacman archive: ${result.error.message} (install libarchive)`)
  }
  if (result.status !== 0) {
    throw new Error(`bsdtar -tf failed for ${archivePath}: ${result.stderr.trim()}`)
  }
  return result.stdout.split(/\r?\n/u).filter(Boolean)
}

function readWithBsdtar(command: string, archivePath: string, entryName: string): string {
  const result = spawnSync(command, ['-xOf', archivePath, entryName], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) {
    throw new Error(`bsdtar ${command} is required to inspect the pacman archive: ${result.error.message} (install libarchive)`)
  }
  if (result.status !== 0) {
    throw new Error(`bsdtar -xOf failed for ${archivePath} ${entryName}: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function defaultOptions(): LinuxPackageVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
    distDir: join(desktopRoot, 'dist'),
    bsdtarCommand: 'bsdtar',
    listArchive: archivePath => listWithBsdtar('bsdtar', archivePath),
    readArchiveEntry: (archivePath, entryName) => readWithBsdtar('bsdtar', archivePath, entryName),
    statArtifact: artifactPath => statSync(artifactPath),
    readFile: filePath => readFileSync(filePath),
  }
}

/** Normalize one archive entry to forward slashes without the leading ./ prefix. */
function normalizeEntry(entry: string): string {
  return entry.replaceAll('\\', '/').replace(/^\.\//u, '')
}

/** Extract the KEY=VALUE fields of a desktop entry as a record. */
export function parseDesktopEntry(content: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    if (!fields[key]) fields[key] = line.slice(separator + 1)
  }
  return fields
}

/**
 * Verify the exact versioned pacman and AppImage artifacts.
 * All violations are collected and reported together.
 * @returns the absolute pacman artifact path.
 */
export function verifyLinuxPackage(
  options: LinuxPackageVerificationOptions = defaultOptions(),
): string {
  const violations: string[] = []
  const expect = (condition: boolean, message: string): void => {
    if (!condition) violations.push(message)
  }

  const pacmanPath = join(options.distDir, `DSH-Desktop-${options.version}-x64.pacman`)
  const appImagePath = join(options.distDir, `DSH-Desktop-${options.version}-x64.AppImage`)

  for (const artifactPath of [pacmanPath, appImagePath]) {
    try {
      const stat = options.statArtifact(artifactPath)
      expect(stat.isFile() && stat.size > 0, `artifact is not a non-empty regular file: ${artifactPath}`)
    } catch (error) {
      violations.push(`artifact missing: ${artifactPath}`)
    }
  }

  let entries: string[] | undefined
  try {
    entries = options.listArchive(pacmanPath).map(normalizeEntry)
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error))
  }
  if (entries !== undefined) {
    const hasEntry = (candidate: string, directory = false): boolean =>
      entries!.some(entry => entry === candidate || (directory && entry.startsWith(`${candidate}/`)))
    expect(hasEntry('usr/bin/dsh-desktop'), 'pacman archive is missing usr/bin/dsh-desktop')
    expect(entries.some(entry => entry === 'resources/app.asar' || entry.endsWith('/resources/app.asar')), 'pacman archive is missing the resources/app.asar entry')
    expect(entries.some(entry => entry === 'resources/app.asar.unpacked'
      || entry.endsWith('/resources/app.asar.unpacked')
      || entry.includes('/resources/app.asar.unpacked/')), 'pacman archive is missing the resources/app.asar.unpacked tree')
    expect(hasEntry('usr/share/applications/dsh-desktop.desktop'), 'pacman archive is missing usr/share/applications/dsh-desktop.desktop')
    expect(entries.some(entry => /^usr\/share\/icons\/hicolor\/[^/]+\/apps\/dsh-desktop\.png$/u.test(entry)), 'pacman archive is missing a hicolor dsh-desktop.png icon')
    const desktopEntryName = 'usr/share/applications/dsh-desktop.desktop'
    if (hasEntry(desktopEntryName)) {
      try {
        const desktop = parseDesktopEntry(options.readArchiveEntry(pacmanPath, desktopEntryName))
        expect(desktop['Exec'] === '/usr/bin/dsh-desktop', `desktop entry Exec must be /usr/bin/dsh-desktop, got ${String(desktop['Exec'])}`)
        expect(desktop['Icon'] === 'dsh-desktop', `desktop entry Icon must be dsh-desktop, got ${String(desktop['Icon'])}`)
        expect(desktop['Name'] === 'DSH Desktop', `desktop entry Name must be DSH Desktop, got ${String(desktop['Name'])}`)
        expect(desktop['Terminal'] === 'false', `desktop entry Terminal must be false, got ${String(desktop['Terminal'])}`)
        expect((desktop['Categories'] ?? '').split(';').includes('Development'), 'desktop entry Categories must include Development')
        expect(desktop['StartupWMClass'] === 'DSH Desktop', `desktop entry StartupWMClass must be DSH Desktop, got ${String(desktop['StartupWMClass'])}`)
      } catch (error) {
        violations.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  try {
    const header = options.readFile(appImagePath).subarray(0, 4)
    expect(header.equals(ELF_MAGIC), `AppImage is not an ELF binary: ${appImagePath}`)
    const stat = options.statArtifact(appImagePath)
    expect(stat.isFile(), 'AppImage stat failed')
    expect((stat.mode & 0o111) !== 0, 'AppImage must carry an executable bit')
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error))
  }

  if (violations.length > 0) {
    throw new Error(`Linux package verification failed:\n- ${violations.join('\n- ')}`)
  }
  return pacmanPath
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Linux package verification passed: ${verifyLinuxPackage()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
