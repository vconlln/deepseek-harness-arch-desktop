import { describe, expect, it } from 'vitest'
import {
  parseDesktopEntry,
  verifyLinuxPackage,
  type LinuxPackageVerificationOptions,
} from '../scripts/verify-linux-package.ts'

const ELF_HEADER = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

const DESKTOP_CONTENT = [
  '[Desktop Entry]',
  'Name=DSH Desktop',
  'Comment=DeepSeek Harness 桌面端',
  'Exec=/usr/bin/dsh-desktop',
  'Icon=dsh-desktop',
  'Terminal=false',
  'Type=Application',
  'Categories=Development;Utility;',
  'StartupWMClass=DSH Desktop',
  '',
].join('\n')

function options(overrides: Partial<LinuxPackageVerificationOptions> = {}): LinuxPackageVerificationOptions {
  return {
    desktopRoot: '/repo/dsh-plugin-desktop',
    version: '2.0.2',
    distDir: '/repo/dsh-plugin-desktop/dist',
    bsdtarCommand: 'bsdtar',
    listArchive: () => [
      'usr/bin/dsh-desktop',
      'usr/lib/dsh-desktop/resources/app.asar',
      'usr/lib/dsh-desktop/resources/app.asar.unpacked/package.json',
      'usr/share/applications/dsh-desktop.desktop',
      'usr/share/icons/hicolor/256x256/apps/dsh-desktop.png',
    ],
    readArchiveEntry: (_archivePath, entryName) => {
      if (entryName === 'usr/share/applications/dsh-desktop.desktop') return DESKTOP_CONTENT
      throw new Error(`unexpected entry read: ${entryName}`)
    },
    statArtifact: artifactPath => ({
      isFile: () => true,
      size: 1024,
      mode: artifactPath.endsWith('.AppImage') ? 0o100755 : 0o100644,
    }),
    readFile: () => ELF_HEADER,
    ...overrides,
  }
}

describe('Linux package verification', () => {
  it('parses a desktop entry into first-wins key fields', () => {
    const fields = parseDesktopEntry([
      '# comment',
      '[Desktop Entry]',
      'Name=DSH Desktop',
      'Name=shadowed',
      'Exec=/usr/bin/dsh-desktop %U',
      '',
    ].join('\n'))
    expect(fields).toEqual({
      Name: 'DSH Desktop',
      Exec: '/usr/bin/dsh-desktop %U',
    })
  })

  it('passes on complete artifacts and returns the pacman path', () => {
    expect(verifyLinuxPackage(options())).toBe('/repo/dsh-plugin-desktop/dist/DSH-Desktop-2.0.2-x64.pacman')
  })

  it('aggregates every missing artifact and entry violation into one error', () => {
    const error = () => verifyLinuxPackage(options({
      listArchive: () => ['usr/bin/dsh-desktop'],
      statArtifact: () => ({ isFile: () => true, size: 0, mode: 0o100644 }),
      readFile: () => Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
    }))
    const message = (() => {
      try {
        error()
        return ''
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause)
      }
    })()
    expect(message).toContain('artifact is not a non-empty regular file')
    expect(message).toContain('pacman archive is missing the resources/app.asar entry')
    expect(message).toContain('pacman archive is missing the resources/app.asar.unpacked tree')
    expect(message).toContain('pacman archive is missing usr/share/applications/dsh-desktop.desktop')
    expect(message).toContain('pacman archive is missing a hicolor dsh-desktop.png icon')
    expect(message).toContain('AppImage must carry an executable bit')
  })

  it('rejects a non-ELF AppImage', () => {
    const cause = (() => {
      try {
        verifyLinuxPackage(options({ readFile: () => Buffer.from('MZ\x90\x00') }))
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()
    expect(cause).toContain('AppImage is not an ELF binary')
  })

  it('rejects a desktop entry with wrong fields', () => {
    const cause = (() => {
      try {
        verifyLinuxPackage(options({
          readArchiveEntry: () => [
            '[Desktop Entry]',
            'Name=DSH Desktop',
            'Exec=/opt/DSH Desktop/dsh-desktop',
            'Icon=dsh-desktop',
            'Terminal=true',
            'Categories=Utility;',
            'StartupWMClass=Other',
            '',
          ].join('\n'),
        }))
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()
    expect(cause).toContain('desktop entry Exec must be /usr/bin/dsh-desktop')
    expect(cause).toContain('desktop entry Terminal must be false')
    expect(cause).toContain('desktop entry Categories must include Development')
    expect(cause).toContain('desktop entry StartupWMClass must be DSH Desktop')
  })

  it('reports a missing artifact file', () => {
    const cause = (() => {
      try {
        verifyLinuxPackage(options({
          statArtifact: (artifactPath) => {
            if (artifactPath.endsWith('.AppImage')) return { isFile: () => true, size: 1, mode: 0o100755 }
            throw new Error('ENOENT')
          },
        }))
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()
    expect(cause).toContain('artifact missing')
  })
})
