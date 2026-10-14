import { escapeHtml } from './icons';

export class GraphicsUnavailableError extends Error {
  constructor() { super('Браузер не смог создать WebGL2-контекст даже без сглаживания.'); this.name = 'GraphicsUnavailableError'; }
}

export function createGraphicsContext(): { canvas: HTMLCanvasElement; context: WebGL2RenderingContext; antialias: boolean } {
  // Retry on a fresh canvas: some GPU/browser combinations reject the preferred configuration.
  for (const antialias of [true, false]) {
    const canvas = document.createElement('canvas');
    try {
      const context = canvas.getContext('webgl2', {
        alpha: false, antialias,
        powerPreference: antialias ? 'high-performance' : 'default',
      });
      if (context && !context.isContextLost()) return { canvas, context, antialias };
    } catch { /* A browser may throw instead of returning null; try the simpler configuration. */ }
  }
  throw new GraphicsUnavailableError();
}

export function startupErrorHtml(error: unknown): string {
  const graphics = error instanceof GraphicsUnavailableError;
  const title = graphics ? '3D НЕДОСТУПНО' : 'ОШИБКА ЗАПУСКА';
  const description = graphics
    ? 'Браузер не смог включить WebGL2 для 3D-сцены. Проверь аппаратное ускорение графики в настройках браузера и перезапусти его.'
    : 'Игра не смогла завершить запуск. Подробности ниже помогут определить причину.';
  const detail = error instanceof Error ? error.message : String(error);
  return `<h2>${title}</h2><p>${description}</p><details><summary>Подробности ошибки</summary><pre>${escapeHtml(detail)}</pre></details><button class="primary" onclick="location.reload()">ПОВТОРИТЬ</button>`;
}
