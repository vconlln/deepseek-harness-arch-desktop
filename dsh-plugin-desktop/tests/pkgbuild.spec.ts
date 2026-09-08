import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDesktopEntry } from '../scripts/verify-linux-package.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version?: unknown
  build?: { linux?: { desktop?: { entry?: Record<string, string> } } }
}
const pkgbuild = readFileSync(new URL('../aur/PKGBUILD', import.meta.url), 'utf8')
const desktop = readFileSync(new URL('../aur/dsh-desktop.desktop', import.meta.url), 'utf8')

function variable(content: string, name: string): string {
  const match = new RegExp(`^${name}=(.+)$`, 'mu').exec(content)
  if (match?.[1] === undefined) throw new Error(`PKGBUILD is missing ${name}`)
  return match[1]!.trim()
}

describe('Arch Linux AUR package', () => {
  it('names the binary package after the desktop product', () => {
    expect(variable(pkgbuild, 'pkgname')).toBe('deepseek-harness-desktop-bin')
    expect(variable(pkgbuild, 'pkgver')).toBe(manifest.version)
  })

  it('targets x86_64 only', () => {
    expect(variable(pkgbuild, 'arch')).toBe('(x86_64)')
  })

  it('declares the Electron runtime libraries and sandbox options', () => {
    const depends = variable(pkgbuild, 'depends')
    for (const name of ['gtk3', 'nss', 'alsa-lib', 'libxss']) {
      expect(depends).toContain(`'${name}'`)
    }
    const optdepends = /^optdepends=\(([\s\S]*?)\)$/mu.exec(pkgbuild)?.[1] ?? ''
    expect(optdepends).toContain('bubblewrap')
    expect(optdepends).toContain('fuse2')
  })

  it('extracts the release artifact with bsdtar', () => {
    expect(pkgbuild).toContain('bsdtar -xf')
    expect(pkgbuild).toContain('${pkgdir}')
  })

  it('keeps checksums as SKIP only before the first release', () => {
    expect(pkgbuild).toContain("sha256sums=('SKIP')")
    expect(pkgbuild).toContain('sha256sum 产物')
  })

  it('declares provides and conflicts against the packaged binary name', () => {
    // The electron-builder pacman archive is named after the npm package.
    expect(pkgbuild).toContain('provides=("dsh-plugin-desktop=')
    expect(pkgbuild).toContain('conflicts=(dsh-plugin-desktop)')
  })

  it('mirrors the electron-builder desktop entry fields', () => {
    const configured = manifest.build?.linux?.desktop?.entry
    const fields = parseDesktopEntry(desktop)
    expect(configured).toBeDefined()
    // The electron-builder generator derives Exec and Comment itself; the AUR
    // reference file mirrors the REAL emitted entry, while Name/Icon/Terminal/
    // Categories/StartupWMClass mirror the configured desktop entry.
    expect(fields['Exec']).toBe('"/opt/DSH Desktop/dsh-desktop" %U')
    expect(fields['Comment']).toBe('DSH Desktop: an Electron shell composed as a DeepSeek Harness Cordis plugin')
    expect(fields['Name']).toBe(configured?.['Name'])
    expect(fields['Icon']).toBe(configured?.['Icon'])
    expect(fields['Terminal']).toBe(configured?.['Terminal'])
    expect(fields['StartupWMClass']).toBe(configured?.['StartupWMClass'])
    expect((fields['Categories'] ?? '').split(';')).toContain('Development')
  })
})
