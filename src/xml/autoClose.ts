import { parseXml } from './parser';

/**
 * If the '>' just before offset completes a (non-empty) start tag, returns the element name
 * for which an end tag should be inserted.
 */
export function tagClosedAt(text: string, offset: number): string | undefined {
  if (text[offset - 1] !== '>' || text[offset - 2] === '/') {
    return undefined;
  }
  const pre = parseXml(text.substring(0, offset));
  if (pre.partial) {
    return undefined;
  }
  const el = pre.openStack[pre.openStack.length - 1];
  if (!el || el.startTagEnd !== offset) {
    return undefined;
  }
  // don't insert if the element is already closed right after the cursor
  if (new RegExp(`^\\s*</${el.name.replace(/[.]/g, '\\.')}\\s*>`).test(text.substring(offset))) {
    return undefined;
  }
  return el.name;
}
