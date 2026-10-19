// Node built-ins for the developer scripts. The project has no @types/node (the game runs in the
// browser), and the checks cannot `import 'node:fs'` under the browser tsconfig — so the modules are
// taken from process.getBuiltinModule (Node 22.3+) and typed loosely here, in one place.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Loose = any;

interface NodeProcess {
  getBuiltinModule(id: string): Loose;
  argv: string[];
  execPath: string;
  env: Record<string, string | undefined>;
  platform: string;
  arch: string;
  pid: number;
  exitCode: number | undefined;
  cwd(): string;
  exit(code?: number): never;
  on(ev: string, fn: (...a: Loose[]) => void): void;
  kill(pid: number, sig?: string | number): boolean;
  stdout: { write(s: string): boolean };
}

export const proc = (globalThis as unknown as { process: NodeProcess }).process;
export const fs: Loose = proc.getBuiltinModule('node:fs');
export const path: Loose = proc.getBuiltinModule('node:path');
export const cp: Loose = proc.getBuiltinModule('node:child_process');
export const crypto: Loose = proc.getBuiltinModule('node:crypto');
export const os: Loose = proc.getBuiltinModule('node:os');
export const net: Loose = proc.getBuiltinModule('node:net');
export const url: Loose = proc.getBuiltinModule('node:url');
export const nodeModule: Loose = proc.getBuiltinModule('node:module');

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
