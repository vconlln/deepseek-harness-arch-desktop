import { describe, expect, it } from 'vitest'
import {
  createLinuxPackageOptions,
  packageLinux,
  packageLinuxArtifacts,
  withoutLinuxSigningSecrets,
  type LinuxPackageOptions,
} from '../scripts/package-linux.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function options(calls: CommandCall[], logs: string[] = []): LinuxPackageOptions {
  return {
    env: {
      PATH: '/usr/bin',
      SAFE_VALUE: 'kept',
      CSC_LINK: 'private-generic-certificate',
      APPLE_API_KEY: 'private-apple-key',
    },
    platform: 'linux',
    arch: 'x64',
    nodeVersion: '22.23.2',
    workspaceRoot: '/repo',
    desktopRoot: '/repo/dsh-plugin-desktop',
    yarnCommand: 'corepack',
    builderCli: '/repo/node_modules/electron-builder/cli.js',
    verifier: '/repo/dsh-plugin-desktop/scripts/verify-linux-package.ts',
    nodeExecutable: '/usr/bin/node',
    run: (command, args, cwd, env) => {
      calls.push({ command, args: [...args], cwd, env: { ...env } })
    },
    log: message => logs.push(message),
  }
}

describe('Linux x64 artifact packaging', () => {
  it('checks without credentials, builds pacman and AppImage targets, then verifies them', () => {
    const calls: CommandCall[] = []
    const logs: string[] = []

    packageLinux(options(calls, logs))

    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({
      command: 'corepack',
      args: ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:linux-package'],
      cwd: '/repo',
      env: { PATH: '/usr/bin', SAFE_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: '/usr/bin/node',
      args: [
        '/repo/node_modules/electron-builder/cli.js',
        '--linux',
        'pacman',
        'AppImage',
        '--x64',
        '--publish',
        'never',
        '--config.npmRebuild=false',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_VALUE: 'kept',
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      },
    })
    expect(calls[2]).toEqual({
      command: '/usr/bin/node',
      args: ['/repo/dsh-plugin-desktop/scripts/verify-linux-package.ts'],
      cwd: '/repo/dsh-plugin-desktop',
      env: { PATH: '/usr/bin' },
    })
    expect(logs).toEqual([
      'Building unsigned Linux x64 artifacts: pacman and AppImage.',
    ])
  })

  it('reuses a completed CI package gate when explicitly requested', () => {
    const calls: CommandCall[] = []
    const logs: string[] = []
    const value = {
      ...options(calls, logs),
      env: {
        ...options(calls).env,
        DSH_PACKAGE_CHECK_ALREADY_RAN: '1',
      },
    }

    packageLinuxArtifacts(value)

    expect(calls).toHaveLength(2)
    expect(logs).toEqual([
      'Building unsigned Linux x64 artifacts: pacman and AppImage.',
      'Skipping the Linux package preflight; the package gate already passed.',
    ])
  })

  it('rejects a non-Linux packaging host', () => {
    const calls: CommandCall[] = []
    expect(() => packageLinuxArtifacts({ ...options(calls), platform: 'darwin' }))
      .toThrow('Linux artifacts must be built on a native Linux host')
  })

  it('rejects a non-x64 host architecture', () => {
    const calls: CommandCall[] = []
    expect(() => packageLinuxArtifacts({ ...options(calls), arch: 'arm64' }))
      .toThrow('Linux artifacts require x64 Node; received arm64')
  })

  it('rejects an unsupported Node release', () => {
    const calls: CommandCall[] = []
    expect(() => packageLinuxArtifacts({ ...options(calls), nodeVersion: '22.18.0' }))
      .toThrow(/Node 22\.19\+ or Node >= 24/u)
  })

  it('removes every signing secret and certificate variable', () => {
    const sanitized = withoutLinuxSigningSecrets({
      KEEP_ME: 'yes',
      csc_link: 'certificate',
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
      Apple_Id: 'user@example.com',
      apple_app_specific_password: 'password',
      WIN_CSC_KEY_PASSWORD: 'windows',
    })
    expect(sanitized).toEqual({ KEEP_ME: 'yes' })
  })

  it('resolves real repository paths in the default options', () => {
    const real = createLinuxPackageOptions()
    expect(real.platform).toBe('linux')
    expect(real.desktopRoot.endsWith('dsh-plugin-desktop')).toBe(true)
    expect(real.workspaceRoot.endsWith('deepseek-harness-desktop-arch')).toBe(true)
    expect(real.verifier.endsWith('verify-linux-package.ts')).toBe(true)
  })
})
