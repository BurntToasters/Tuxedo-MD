const APP_NAME = 'Tuxedo MD';

export function formatWindowTitle(tabName: string, dirty: boolean): string {
  const prefix = dirty ? '• ' : '';
  const name = tabName.trim() || 'Untitled';
  return `${prefix}${name} — ${APP_NAME}`;
}
