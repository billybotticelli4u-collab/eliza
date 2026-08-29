import { describe, expect, test } from 'bun:test';

describe('published dependency policy', () => {
  test('does not ship the unused pdfjs-dist dependency', async () => {
    const manifest = (await Bun.file(new URL('../../package.json', import.meta.url)).json()) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).not.toHaveProperty('pdfjs-dist');
  });
});
