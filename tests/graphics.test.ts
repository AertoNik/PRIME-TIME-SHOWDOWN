import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGraphicsContext, GraphicsUnavailableError, startupErrorHtml } from '../src/graphics';

describe('graphics startup and diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses WebGL2 with antialiasing when available', () => {
    const context = { isContextLost: () => false };
    const getContext = vi.fn(() => context);
    vi.stubGlobal('document', { createElement: () => ({ getContext }) });
    expect(createGraphicsContext().context).toBe(context);
    expect(getContext).toHaveBeenCalledExactlyOnceWith('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' });
  });
  it('retries without antialiasing on a fresh canvas if the preferred context fails', () => {
    const context = { isContextLost: () => false };
    const first = { getContext: vi.fn(() => null) }, second = { getContext: vi.fn(() => context) };
    const createElement = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.stubGlobal('document', { createElement });
    const result = createGraphicsContext();
    expect(result.canvas).toBe(second); expect(result.antialias).toBe(false);
    expect(second.getContext).toHaveBeenCalledWith('webgl2', { alpha: false, antialias: false, powerPreference: 'default' });
  });
  it('recovers when getContext throws', () => {
    const context = { isContextLost: () => false };
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValueOnce({ getContext: () => { throw new Error('GPU'); } }).mockReturnValueOnce({ getContext: () => context }) });
    expect(createGraphicsContext().context).toBe(context);
  });
  it('reports unavailable or already lost contexts as a graphics error', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ isContextLost: () => true }) }) });
    expect(() => createGraphicsContext()).toThrow(GraphicsUnavailableError);
  });
  it('distinguishes a graphics failure from another startup error and escapes details', () => {
    expect(startupErrorHtml(new GraphicsUnavailableError())).toContain('3D НЕДОСТУПНО');
    const html = startupErrorHtml(new Error('<img src=x onerror=alert(1)>'));
    expect(html).toContain('ОШИБКА ЗАПУСКА'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  });
});
