#!/usr/bin/env node
/**
 * Build the Arch Linux desktop artifacts from the vendored upstream checkout.
 *
 * Upstream ships `apps/desktop` but only supports macOS and Windows release
 * targets. This script applies `patches/desktop-linux-x64.patch` to the
 * submodule (adding a `linux-x64` target), then drives upstream's own
 * packaging pipeline so the Arch artifact is produced by upstream code rather
 * than by a fork of it.
 *
 * Usage:
 *   node scripts/build-desktop-linux.mjs            # pacman + AppImage
 *   node scripts/build-desktop-linux.mjs --dir      # unpacked app dir only
 *   node scripts/build-desktop-linux.mjs --prepare-only
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = join(ROOT, 'deepseek-harness')
const PATCH = join(ROOT, 'patches', 'desktop-linux-x64.patch')
const ICON_SOURCE = join(ROOT, 'assets', 'app-icon.png')
const ICON_TARGET = join(UPSTREAM, 'apps', 'desktop', 'build', 'app-icon.png')
const DIST = join(ROOT, 'dist')

const fail = message => {
  throw new Error(`build-desktop-linux: ${message}`)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

const runCapture = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Reject a checkout whose HEAD is not the commit pinned by upstream.json. */
const verifyPinnedCommit = () => {
  const document = JSON.parse(readFileSync(join(ROOT, 'upstream.json'), 'utf8'))
  const channel = document.activeChannel
  const pinned = document.channels?.[channel]?.commit
  if (typeof pinned !== 'string') fail(`upstream.json has no commit for channel ${String(channel)}`)
  const { status, stdout } = runCapture('git', ['rev-parse', 'HEAD'], { cwd: UPSTREAM })
  if (status !== 0) fail('deepseek-harness is not a git checkout; run git submodule update --init')
  const head = stdout.trim()
  if (head !== pinned) {
    fail(`deepseek-harness HEAD is ${head} but upstream.json pins ${pinned} (channel ${channel})`)
  }
  console.log(`upstream commit: ${head} (channel ${channel})`)
}

/**
 * Apply the Linux target patch once; a re-run is a no-op.
 *
 * The submodule is pinned and must stay clean (see AGENTS.md and
 * scripts/verify-layout.mjs), so the caller always reverts this change.
 * @returns Whether this run actually applied the patch.
 */
const applyLinuxPatch = () => {
  if (!existsSync(PATCH)) fail(`missing patch ${PATCH}`)
  const check = runCapture('git', ['apply', '--check', '--reverse', PATCH], { cwd: UPSTREAM })
  if (check.status === 0) {
    console.log('linux-x64 patch: already applied')
    return false
  }
  const applies = runCapture('git', ['apply', '--check', PATCH], { cwd: UPSTREAM })
  if (applies.status !== 0) {
    fail(`patch does not apply cleanly to the pinned checkout:\n${applies.stderr.trim()}`)
  }
  run('git', ['apply', PATCH], { cwd: UPSTREAM })
  console.log('linux-x64 patch: applied')
  return true
}

/** Restore the pinned checkout so the repository gate keeps passing. */
const revertLinuxPatch = () => {
  const check = runCapture('git', ['apply', '--check', '--reverse', PATCH], { cwd: UPSTREAM })
  if (check.status !== 0) return
  run('git', ['apply', '--reverse', PATCH], { cwd: UPSTREAM })
  console.log('linux-x64 patch: reverted (submodule left clean)')
}

/** electron-builder needs a Linux icon inside the app directory. */
const installIcon = () => {
  if (!existsSync(ICON_SOURCE)) fail(`missing icon ${ICON_SOURCE}`)
  mkdirSync(dirname(ICON_TARGET), { recursive: true })
  copyFileSync(ICON_SOURCE, ICON_TARGET)
  console.log(`icon: ${ICON_SOURCE} -> apps/desktop/build/app-icon.png`)
}

/** Leave no untracked file behind, since the pinned checkout must end clean. */
const removeIcon = () => {
  if (!existsSync(ICON_TARGET)) return
  rmSync(dirname(ICON_TARGET), { recursive: true, force: true })
  console.log('icon: removed from apps/desktop/build')
}

/** Upstream requires an update origin even for local packaging. */
const packagingEnvironment = () => ({
  ...process.env,
  // The packaging pipeline calls pnpm several times headlessly; without CI=true
  // pnpm refuses to purge a stale modules directory and aborts the build.
  CI: process.env.CI ?? 'true',
  // Release identity: an Arch package is identified by this reverse-DNS app id.
  DSH_DESKTOP_APP_ID: process.env.DSH_DESKTOP_APP_ID ?? 'ai.deepseek.dsh.desktop',
  // Auto-update metadata still has to resolve; Arch itself updates via pacman,
  // so the test channel points at this repository's release downloads.
  DSH_DESKTOP_AUTO_UPDATE_ENV: process.env.DSH_DESKTOP_AUTO_UPDATE_ENV ?? 'test',
  DOWNLOAD_TEST_ORIGIN: process.env.DOWNLOAD_TEST_ORIGIN ?? 'https://github.com',
})

const main = () => {
  const argv = new Set(process.argv.slice(2))
  if (process.platform !== 'linux') fail('the Arch artifacts must be built on a Linux host')
  if (process.arch !== 'x64') fail(`the Arch artifacts require x64 Node; received ${process.arch}`)

  verifyPinnedCommit()

  // The pinned checkout must be clean again no matter how the build ends.
  try {
    applyLinuxPatch()
    installIcon()

    const args = ['--filter', '@deepseek-ai/dsh-desktop', 'run', 'package', 'linux-x64']
    if (argv.has('--dir')) args.push('--', '--dir')
    if (argv.has('--prepare-only')) args.push('--', '--prepare-only')

    console.log(`packaging: corepack pnpm ${args.join(' ')}`)
    run('corepack', ['pnpm', ...args], {
      cwd: UPSTREAM,
      env: packagingEnvironment(),
    })

    if (argv.has('--prepare-only')) return

    const artifacts = join(UPSTREAM, 'apps', 'desktop', '.desktop-build', 'targets', 'linux-x64', 'artifacts')
    if (!existsSync(artifacts)) fail(`electron-builder produced no artifacts directory at ${artifacts}`)
    mkdirSync(DIST, { recursive: true })
    const produced = readdirSync(artifacts)
      .filter(name => /\.(pacman|AppImage)$/u.test(name))
      .map(name => join(artifacts, name))
    if (produced.length === 0) fail(`no .pacman/.AppImage artifact in ${artifacts}`)
    for (const file of produced) {
      const target = join(DIST, file.slice(file.lastIndexOf('/') + 1))
      copyFileSync(file, target)
      console.log(`artifact: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MiB)`)
    }
  } finally {
    removeIcon()
    revertLinuxPatch()
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
