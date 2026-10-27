import { describe, it, expect } from 'vitest'
import nextConfig from '../../next.config'

describe('Permissions-Policy', () => {
  it('consente il microfono alla propria origine', async () => {
    const rules = await nextConfig.headers!()
    const values = rules.flatMap((r) => r.headers).filter((h) => h.key === 'Permissions-Policy')
    expect(values.length).toBeGreaterThan(0)
    for (const h of values) {
      expect(h.value).toContain('microphone=(self)')
    }
  })
})
