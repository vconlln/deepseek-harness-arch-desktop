#!/usr/bin/env node
/**
 * Compile source-only native addons against the Electron ABI this app runs on.
 *
 * Why this exists
 * ---------------
 * `@deepseek-ai/dsh-session-persistence-jsonl` imports `flock` from `fs-ext`
 * at module scope to take the advisory session lock. `fs-ext@2.1.1` is a NAN
 * addon with no prebuilds, so it can only work when `build/Release/fs_ext.node`
 * exists for the runtime that loads it — here, the Electron main process.
 *
 * This repository installs with `enableScripts: false` and only executes build
 * scripts for packages listed in the root `dependenciesMeta`. `fs-ext` is not
 * listed (it is a transitive dependency), so Yarn leaves it as sources only.
 * Electron Builder then packages with `--config.npmRebuild=false` because every
 * other native dependency ships Node-API prebuilds. The combination produced an
 * app without the binding, and the packaged 2.1.0 build failed to boot with:
 *
 *   plugin tree failed to load: ...
 *   Cannot find module './build/Release/fs_ext.node'
 *
 * Running this script before packaging (and before `dev`) compiles exactly that
 * binding against the Electron headers, so the packaged tree matches what the
 * loader requires.
 *
 * Usage
 * -----
 *   node scripts/prepare-native-addons.mjs            # build what is stale
 *   node scripts/prepare-native-addons.mjs --check    # fail if a rebuild is needed
 *   node scripts/prepare-native-addons.mjs --force    # rebuild unconditionally
 *   node scripts/prepare-native-addons.mjs --arch x64 # cross-arch build (macOS)
 *
 * Build tooling: python3, make and a C++ toolchain (g++/MSVC/Xcode CLT). Header
 * downloads can be redirected with `ELECTRON_REBUILD_DIST_URL`.
 *
 * macOS note: universal (`--universal`) packages need one binding per CPU. This
 * script builds the requested arch only, so a universal macOS release needs an
 * arch-aware loader (or per-slice builds) before it can be published.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** Name of the marker written next to a freshly built binding. */
export const BUILD_MARKER_FILENAME = '.dsh-electron-build.json'

/**
 * Addons that are installed as sources only. `binding` is the exact path the
 * package's own loader requires, so a successful build is precisely what the
 * runtime will load.
 */
export const NATIVE_ADDONS = Object.freeze([
  {
    name: 'fs-ext',
    manifest: 'fs-ext/package.json',
    binding: 'build/Release/fs_ext.node',
    consumers: ['@deepseek-ai/dsh-session-persistence-jsonl'],
  },
])

/** Absolute path of this script's package root (`dsh-plugin-desktop`). */
export function packageRootFromScriptUrl(scriptUrl) {
  return dirname(dirname(fileURLToPath(scriptUrl)))
}

/**
 * Read the Electron version the app is packaged with.
 * @param {string} packageRoot - Desktop package root.
 * @returns {string} Version such as `43.3.0`.
 */
export function readElectronVersion(packageRoot) {
  const require = createRequire(join(packageRoot, 'package.json'))
  const installed = readJson(join(packageRoot, 'node_modules', 'electron', 'package.json'))
  if (installed !== undefined && typeof installed.version === 'string' && installed.version.length > 0) {
    return installed.version
  }
  try {
    const resolved = require('electron/package.json')
    if (typeof resolved.version === 'string' && resolved.version.length > 0) return resolved.version
  } catch {
    // Fall through to the declared range for a friendlier error below.
  }
  const declared = readJson(join(packageRoot, 'package.json'))
  const range = declared?.devDependencies?.electron ?? declared?.dependencies?.electron
  if (typeof range === 'string' && /^\d+\.\d+\.\d+$/u.test(range)) return range
  throw new Error(
    'Cannot determine the Electron version to build native addons against. '
      + 'Pass --electron-version <version> or install electron first.',
  )
}

/**
 * Decide whether the addons for this target still need to be compiled.
 * @param {{ packageRoot: string, electronVersion: string, platform: string, arch: string, force?: boolean }} input
 * @returns {{ needsBuild: boolean, reason: string, addons: Array<{ name: string, version: string, bindingPath: string, markerPath: string }> }}
 */
export function planNativeAddons(input) {
  const { packageRoot, electronVersion, platform, arch, force = false } = input
  const addons = NATIVE_ADDONS.map(addon => {
    const manifestPath = join(packageRoot, 'node_modules', addon.manifest)
    const manifest = readJson(manifestPath)
    if (manifest === undefined) {
      throw new Error(
        `${addon.name} is not installed at ${manifestPath}. Run \`corepack yarn install\` first.`,
      )
    }
    const packageDir = dirname(manifestPath)
    return {
      name: addon.name,
      version: String(manifest.version ?? 'unknown'),
      bindingPath: join(packageDir, addon.binding),
      // Keep the marker beside the addon's build root so a node-gyp clean or a
      // fresh `yarn install` invalidates it together with the binding.
      markerPath: join(dirname(dirname(join(packageDir, addon.binding))), BUILD_MARKER_FILENAME),
    }
  })

  const expected = { electronVersion, platform, arch }
  for (const addon of addons) {
    if (!existsSync(addon.bindingPath)) {
      return { needsBuild: true, reason: `missing ${relativeBinding(addon)}`, addons }
    }
    const marker = readJson(addon.markerPath)
    if (marker === undefined) {
      return { needsBuild: true, reason: `no build marker for ${addon.name}`, addons }
    }
    for (const [key, value] of Object.entries(expected)) {
      if (marker[key] !== value) {
        return {
          needsBuild: true,
          reason: `${addon.name} was built for ${describeMarker(marker)}, needs ${describeMarker(expected)}`,
          addons,
        }
      }
    }
    if (marker.version !== addon.version) {
      return { needsBuild: true, reason: `${addon.name} changed version since it was built`, addons }
    }
  }
  return { needsBuild: force || false, reason: force ? 'forced' : 'up to date', addons }
}

/**
 * Compile the requested addons in place with `@electron/rebuild`.
 * @param {{ packageRoot: string, addons: ReadonlyArray<{ name: string }>, electronVersion: string, platform: string, arch: string }} input
 */
export function buildNativeAddons(input) {
  const { packageRoot, addons, electronVersion, platform, arch } = input
  const require = createRequire(join(packageRoot, 'package.json'))
  let rebuildCli
  try {
    // `exports` hides ./lib/cli.js, so resolve the package entry and take its sibling CLI.
    rebuildCli = join(dirname(require.resolve('@electron/rebuild')), 'cli.js')
  } catch {
    throw new Error(
      'Cannot find @electron/rebuild. Run `corepack yarn install` in the repository root first.',
    )
  }
  const names = addons.map(addon => addon.name).join(',')
  const result = spawnSync(
    process.execPath,
    [
      rebuildCli,
      '--force',
      '--only',
      names,
      '--version',
      electronVersion,
      '--arch',
      arch,
      '--platform',
      platform,
    ],
    { cwd: packageRoot, env: process.env, stdio: 'inherit' },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `@electron/rebuild failed to compile ${names} for Electron ${electronVersion} (${platform}-${arch}).\n`
        + 'Install a C++ toolchain (python3 + make + g++ / MSVC / Xcode command line tools) and retry. '
        + 'For offline builds point ELECTRON_REBUILD_DIST_URL at a mirror holding the Electron headers.',
    )
  }
}

/**
 * Fail when the compiled binding is still missing after a build, and refresh
 * the markers that let later runs skip the work.
 * @param {{ addons: ReadonlyArray<{ name: string, version: string, bindingPath: string, markerPath: string }>, electronVersion: string, platform: string, arch: string }} input
 */
export function recordNativeAddonBuild(input) {
  const { addons, electronVersion, platform, arch } = input
  for (const addon of addons) {
    if (!existsSync(addon.bindingPath)) {
      throw new Error(
        `${addon.name} did not produce ${addon.bindingPath} for Electron ${electronVersion}. `
          + 'The package build succeeded but the expected binding is missing; check its binding.gyp target name.',
      )
    }
    mkdirSync(dirname(addon.markerPath), { recursive: true })
    writeFileSync(
      addon.markerPath,
      `${JSON.stringify(
        { electronVersion, platform, arch, version: addon.version, builtAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
}

/** Remove compiled output and markers so the next run rebuilds from scratch. */
export function cleanNativeAddonBuild(addons) {
  for (const addon of addons) {
    rmSync(dirname(addon.bindingPath), { recursive: true, force: true })
    rmSync(addon.markerPath, { force: true })
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function describeMarker(marker) {
  return `Electron ${String(marker.electronVersion)} ${String(marker.platform)}-${String(marker.arch)}`
}

function relativeBinding(addon) {
  return addon.bindingPath.replace(/^.*[\\/]node_modules[\\/]/u, 'node_modules/')
}

function main() {
  const { values } = parseArgs({
    options: {
      arch: { type: 'string' },
      platform: { type: 'string' },
      'electron-version': { type: 'string' },
      check: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      clean: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })

  const packageRoot = packageRootFromScriptUrl(import.meta.url)
  const electronVersion = values['electron-version'] ?? readElectronVersion(packageRoot)
  const platform = values.platform ?? process.platform
  const arch = values.arch ?? process.arch
  if (platform !== process.platform) {
    throw new Error(
      `Native addons must be compiled on the ${platform} host; this host is ${process.platform}. `
        + 'Cross-compiling C++ addons is not supported — run the packaging step on the target OS.',
    )
  }

  if (values.clean) {
    cleanNativeAddonBuild(
      planNativeAddons({ packageRoot, electronVersion, platform, arch }).addons,
    )
    console.log('prepare-native-addons: cleared previous build output')
    return
  }

  const plan = planNativeAddons({
    packageRoot,
    electronVersion,
    platform,
    arch,
    force: values.force,
  })
  if (!plan.needsBuild) {
    console.log(
      `prepare-native-addons: up to date (${plan.addons.map(addon => addon.name).join(', ')} for Electron ${electronVersion} ${platform}-${arch})`,
    )
    return
  }
  if (values.check) {
    throw new Error(
      `Native addons are not built for Electron ${electronVersion} ${platform}-${arch}: ${plan.reason}. `
        + 'Run `yarn workspace <desktop> prepare:native` before packaging.',
    )
  }

  console.log(
    `prepare-native-addons: ${plan.reason}; compiling ${plan.addons.map(addon => `${addon.name}@${addon.version}`).join(', ')} against Electron ${electronVersion} ${platform}-${arch}`,
  )
  buildNativeAddons({ packageRoot, addons: plan.addons, electronVersion, platform, arch })
  recordNativeAddonBuild({ addons: plan.addons, electronVersion, platform, arch })
  console.log(
    `prepare-native-addons: built ${plan.addons.map(addon => relativeBinding(addon)).join(', ')}`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(
      `prepare-native-addons: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
