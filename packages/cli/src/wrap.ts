// Renders a comma-separated id list across as few lines as fit, so help text
// and prompts stay readable as the platform registry grows.
export function wrapIds(ids: string[], indent: string, width = 88): string {
  const budget = width - indent.length;
  const lines: string[] = [];
  for (const id of ids) {
    const last = lines.length - 1;
    if (lines.length > 0 && `${lines[last]}, ${id}`.length <= budget) lines[last] += `, ${id}`;
    else lines.push(id);
  }
  return lines.join(`,\n${indent}`);
}
