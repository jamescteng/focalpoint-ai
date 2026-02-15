function ts(): string {
  return new Date().toISOString();
}

export const FocalPointLogger = {
  info: (stage: string, data: any) => console.log(`[${ts()}][FocalPoint][INFO][${stage}]`, data),
  warn: (stage: string, msg: string) => console.warn(`[${ts()}][FocalPoint][WARN][${stage}]`, msg),
  error: (stage: string, err: any) => console.error(`[${ts()}][FocalPoint][ERROR][${stage}]`, err),
  debug: (stage: string, data: any) => console.debug(`[${ts()}][FocalPoint][DEBUG][${stage}]`, data)
};

export function logMem(tag: string): void {
  const m = process.memoryUsage();
  console.log(`[${ts()}][FocalPoint][MEM][${tag}]`, {
    rss: Math.round(m.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(m.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(m.heapTotal / 1024 / 1024) + 'MB',
  });
}
