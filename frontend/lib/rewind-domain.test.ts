import { describe, expect, it } from 'vitest'
import { applyRewind, previewRewind, seedState, validateAction } from './rewind-domain'

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
})
