import { describe, expect, it } from 'vitest'
import { applyCorrection, applyRewind, previewRewind, seedState, validateAction } from './rewind-domain'

describe('rewind domain', () => {
  it('preserves independent evidence during preview', () => {
    const impact = previewRewind(seedState(), 'github://acme/rewind')
    expect(impact.invalidated.map((memory) => memory.id)).toContain('mem_7f2a91')
    expect(impact.preserved.map((memory) => memory.id)).toContain('mem_34c8d0')
  })
  it('does not mutate preview and blocks dependent actions after repair', () => {
    const state = seedState()
    const preview = previewRewind(state, 'github://acme/rewind')
    expect(state.memories.find((memory) => memory.id === 'mem_7f2a91')?.status).toBe('valid')
    const repaired = applyRewind(state, 'github://acme/rewind')
    expect(repaired.memories.find((memory) => memory.id === 'mem_7f2a91')?.status).toBe('retracted')
    expect(validateAction(repaired, 'action_003').ok).toBe(false)
    expect(preview.invalidated.length).toBeGreaterThan(0)
  })
  it('admits reviewed correction, marks superseded memory, and unblocks action', () => {
    const state = seedState()
    // First revoke source to retract mem_a81e22 (which blocks action_003)
    const repaired = applyRewind(state, 'github://acme/rewind')
    expect(validateAction(repaired, 'action_003').ok).toBe(false)

    // Apply correction superseding mem_a81e22
    const corrected = applyCorrection(repaired, {
      source: {
        id: 'github://acme/rewind#reviewed-deploy',
        title: 'Reviewed deployment documentation',
        content: 'Production deployments use verified pipeline gate.',
      },
      memory: {
        id: 'mem_a81e22_corrected',
        title: 'Deployments use verified pipeline approval',
        content: 'Updated production deployment procedure verified by maintainers.',
        supersedesId: 'mem_a81e22',
      },
    })

    // Check superseded memory is marked 'superseded'
    expect(corrected.memories.find((m) => m.id === 'mem_a81e22')?.status).toBe('superseded')
    // Check new memory is valid
    const newMem = corrected.memories.find((m) => m.id === 'mem_a81e22_corrected')
    expect(newMem?.status).toBe('valid')
    // Check action_003 is unblocked and now valid
    const actionResult = validateAction(corrected, 'action_003')
    expect(actionResult.ok).toBe(true)
  })
})
