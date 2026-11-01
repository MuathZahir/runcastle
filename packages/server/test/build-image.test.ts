import { describe, expect, it } from 'vitest'
import { BUILD_IMAGE_USAGE, runBuildImage } from '../src/bin/build-image'
import type { ExecFn } from '../src/doctor/doctor'
import type { BuildStepCall } from '../src/services/image-build'
import { ROOT_BURN_REFUSED } from '../src/workflows/burn-user'

const exec: ExecFn = async () => ({ ok: true, code: 0, stdout: '', stderr: '' })
const config = { sandbox: 'docker' as const }

function harness(code = 0) {
  const lines: string[] = []
  const builds: BuildStepCall[] = []
  return {
    lines,
    builds,
    deps: {
      log: (line: string) => lines.push(line),
      exec,
      config,
      runningAsRoot: false,
      runStep: async (call: BuildStepCall) => {
        builds.push(call)
        call.onLine('#1 building')
        return { code }
      },
    },
  }
}

describe('runcastle build-image', () => {
  it('builds the stock image, shows its output and exits 0', async () => {
    const { deps, lines, builds } = harness()

    expect(await runBuildImage([], deps)).toBe(0)

    expect(builds.map((b) => b.args[2])).toEqual(['sandcastle:runcastle'])
    expect(lines).toContain('#1 building')
    expect(lines.at(-1)).toBe('Built sandcastle:runcastle.')
  })

  it('exits non-zero with the cause when the build fails', async () => {
    const { deps, lines } = harness(1)

    expect(await runBuildImage([], deps)).toBe(1)

    expect(lines.at(-1)).toBe('sandcastle:runcastle did not build: #1 building')
  })

  it('refuses a machine-wide custom image rather than building over it', async () => {
    const { deps, lines, builds } = harness()

    expect(await runBuildImage([], { ...deps, config: { ...config, sandboxImage: 'acme:box' } })).toBe(1)

    expect(builds).toEqual([])
    expect(lines.join('\n')).toContain('acme:box is a custom image')
  })

  it('refuses to run as root, which would bake UID 0 into the image', async () => {
    const { deps, lines, builds } = harness()

    expect(await runBuildImage([], { ...deps, runningAsRoot: true })).toBe(1)

    expect(builds).toEqual([])
    expect(lines).toEqual([ROOT_BURN_REFUSED])
  })

  it('takes no arguments', async () => {
    const { deps, lines } = harness()

    expect(await runBuildImage(['--project', '.'], deps)).toBe(1)

    expect(lines).toEqual([BUILD_IMAGE_USAGE])
  })
})
