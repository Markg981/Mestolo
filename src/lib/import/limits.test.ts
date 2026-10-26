import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BODY_SIZE_LIMIT_BYTES,
  MAX_AUDIO_BYTES,
  MAX_TOTAL_BYTES,
  MULTIPART_MARGIN_BYTES,
} from './limits';

describe('limiti import vs bodySizeLimit', () => {
  it('next.config.ts usa lo stesso bodySizeLimit della costante condivisa', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    const m = /bodySizeLimit:\s*'(\d+)mb'/.exec(cfg);
    expect(m).not.toBeNull();
    expect(Number(m![1]) * 1024 * 1024).toBe(BODY_SIZE_LIMIT_BYTES);
  });

  it('foto totali + margine multipart stanno nel body limit', () => {
    expect(MAX_TOTAL_BYTES + MULTIPART_MARGIN_BYTES).toBeLessThanOrEqual(BODY_SIZE_LIMIT_BYTES);
  });

  it('audio + margine multipart stanno nel body limit', () => {
    expect(MAX_AUDIO_BYTES + MULTIPART_MARGIN_BYTES).toBeLessThanOrEqual(BODY_SIZE_LIMIT_BYTES);
  });
});
