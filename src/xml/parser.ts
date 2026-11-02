/**
 * A small, error tolerant XML parser that keeps track of source offsets.
 * It is not a conformant XML parser, but it detects the common
 * well-formedness errors and – unlike conformant parsers – it can deal with
 * incomplete documents (as needed for code completion).
 */

export const XML_NS = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface XAttr {
  name: string;
  prefix: string;
  local: string;
  ns: string;
  value: string;
  rawValue: string;
  start: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
  end: number;
}

export interface XElement {
  name: string;
  prefix: string;
  local: string;
  ns: string;
  attrs: XAttr[];
  children: XElement[];
  parent?: XElement;
  /** offset of '<' */
  start: number;
  nameEnd: number;
  /** offset after the closing '>' of the start tag */
  startTagEnd: number;
  /** offset of the end tag ('</'), or end of content */
  contentEnd: number;
  /** offset after the end tag */
  end: number;
  selfClosing: boolean;
  closed: boolean;
  nsMap: Map<string, string>;
  /** concatenated character data of direct text children (without CDATA markup) */
  text: string;
}

export interface XmlError {
  message: string;
  start: number;
  end: number;
}

export type PartialState = 'name' | 'inTag' | 'attrName' | 'afterAttrName' | 'afterEq' | 'attrValue';

export interface PartialTag {
  kind: 'start' | 'end' | 'comment' | 'pi' | 'cdata' | 'doctype';
  start: number;
  element?: XElement;
  state?: PartialState;
  attrName?: string;
  attrStart?: number;
  valueStart?: number;
  quote?: string;
  endName?: string;
}

export interface XmlDocument {
  text: string;
  root?: XElement;
  elements: XElement[];
  errors: XmlError[];
  /** elements that are still open at the end of the input */
  openStack: XElement[];
  /** set if the input ends inside markup */
  partial?: PartialTag;
  hasDoctype: boolean;
}

const NAME = /[A-Za-z_\u00C0-\uFFFF][-\w.\u00B7\u00C0-\uFFFF:]*/y;
const WS = /\s/;
const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const REF = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z_][-\w.]*));/g;

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) {
    return s;
  }
  return s.replace(REF, (m, hex, dec, name) => {
    if (hex) {
      return safeFromCodePoint(parseInt(hex, 16), m);
    }
    if (dec) {
      return safeFromCodePoint(parseInt(dec, 10), m);
    }
    return PREDEFINED[name] ?? m;
  });
}

function safeFromCodePoint(cp: number, fallback: string): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return fallback;
  }
}

function splitQName(name: string): [string, string] {
  const i = name.indexOf(':');
  return i < 0 ? ['', name] : [name.substring(0, i), name.substring(i + 1)];
}

export function parseXml(text: string): XmlDocument {
  const doc: XmlDocument = { text, elements: [], errors: [], openStack: [], hasDoctype: false };
  const stack: XElement[] = [];
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const err = (message: string, start: number, end = start + 1) => {
    start = Math.max(0, Math.min(start, n));
    end = Math.max(start + 1, Math.min(end, n));
    doc.errors.push({ message, start, end });
  };

  const checkRefs = (from: number, to: number) => {
    let amp = text.indexOf('&', from);
    while (amp >= 0 && amp < to) {
      REF.lastIndex = amp;
      const m = REF.exec(text);
      if (!m || m.index !== amp || amp + m[0].length > to) {
        err('Unescaped "&" (use &amp;)', amp);
      } else if (m[3] && !(m[3] in PREDEFINED) && !doc.hasDoctype) {
        err(`Undefined entity "&${m[3]};"`, amp, amp + m[0].length);
      }
      amp = text.indexOf('&', amp + 1);
    }
  };

  const handleText = (from: number, to: number) => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      const s = text.substring(from, to);
      const k = s.search(/\S/);
      if (k >= 0) {
        err('Text is not allowed outside of the root element', from + k, from + s.trimEnd().length);
      }
      return;
    }
    checkRefs(from, to);
    parent.text += decodeEntities(text.substring(from, to));
  };

  const skipWs = (j: number) => {
    while (j < n && WS.test(text[j])) {
      j++;
    }
    return j;
  };

  const resolveNamespaces = (el: XElement) => {
    const parent = stack[stack.length - 1];
    const nsMap = new Map<string, string>(parent ? parent.nsMap : [['xml', XML_NS]]);
    for (const a of el.attrs) {
      if (a.name === 'xmlns') {
        nsMap.set('', a.value);
      } else if (a.prefix === 'xmlns') {
        if (a.value === '') {
          nsMap.delete(a.local);
        } else {
          nsMap.set(a.local, a.value);
        }
      }
    }
    el.nsMap = nsMap;
    const ens = nsMap.get(el.prefix);
    if (el.prefix && ens === undefined) {
      err(`Namespace prefix "${el.prefix}" is not bound`, el.start + 1, el.nameEnd);
    }
    el.ns = ens ?? '';
    for (const a of el.attrs) {
      if (a.name === 'xmlns' || a.prefix === 'xmlns') {
        a.ns = XMLNS_NS;
      } else if (a.prefix) {
        const ans = nsMap.get(a.prefix);
        if (ans === undefined) {
          err(`Namespace prefix "${a.prefix}" is not bound`, a.start, a.nameEnd);
        }
        a.ns = ans ?? '';
      }
    }
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      handleText(i, textEnd);
    }
    if (lt < 0) {
      break;
    }
    i = lt;

    if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) {
        err('Unterminated comment', i, i + 4);
        doc.partial = { kind: 'comment', start: i };
        i = n;
        break;
      }
      i = e + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      if (!stack.length) {
        err('CDATA section outside of the root element', i, i + 9);
      }
      const e = text.indexOf(']]>', i + 9);
      if (e < 0) {
        err('Unterminated CDATA section', i, i + 9);
        doc.partial = { kind: 'cdata', start: i };
        i = n;
        break;
      }
      if (stack.length) {
        stack[stack.length - 1].text += text.substring(i + 9, e);
      }
      i = e + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const e = text.indexOf('?>', i + 2);
      if (e < 0) {
        err('Unterminated processing instruction', i, i + 2);
        doc.partial = { kind: 'pi', start: i };
        i = n;
        break;
      }
      i = e + 2;
      continue;
    }
    if (text.startsWith('<!', i)) {
      let depth = 0;
      let j = i + 2;
      while (j < n) {
        const c = text[j];
        if (c === '[') {
          depth++;
        } else if (c === ']') {
          depth--;
        } else if (c === '>' && depth <= 0) {
          break;
        } else if (c === '"' || c === "'") {
          const q = text.indexOf(c, j + 1);
          j = q < 0 ? n : q;
        }
        j++;
      }
      doc.hasDoctype = true;
      if (j >= n) {
        doc.partial = { kind: 'doctype', start: i };
      }
      i = j + 1;
      continue;
    }

    if (text[i + 1] === '/') {
      // end tag
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      const name = m ? m[0] : '';
      let j = skipWs(i + 2 + name.length);
      if (j >= n) {
        doc.partial = { kind: 'end', start: i, endName: name };
        err('Unterminated end tag', i, n);
        i = n;
        break;
      }
      if (text[j] !== '>') {
        err('Expected ">"', j);
        const gt = text.indexOf('>', j);
        const lt2 = text.indexOf('<', j);
        j = gt >= 0 && (lt2 < 0 || gt < lt2) ? gt : (lt2 >= 0 ? lt2 - 1 : n - 1);
      }
      const endTagEnd = j + 1;
      if (!name) {
        err('Missing element name in end tag', i, endTagEnd);
      } else {
        let idx = stack.length - 1;
        while (idx >= 0 && stack[idx].name !== name) {
          idx--;
        }
        if (idx < 0) {
          err(`Unexpected end tag </${name}>`, i, endTagEnd);
        } else {
          for (let k = stack.length - 1; k > idx; k--) {
            const el = stack[k];
            err(`Element <${el.name}> is not closed`, el.start + 1, el.nameEnd);
            el.contentEnd = i;
            el.end = i;
          }
          const el = stack[idx];
          el.closed = true;
          el.contentEnd = i;
          el.end = endTagEnd;
          stack.length = idx;
        }
      }
      i = endTagEnd;
      continue;
    }

    // start tag
    NAME.lastIndex = i + 1;
    const m = NAME.exec(text);
    const name = m ? m[0] : '';
    const [prefix, local] = splitQName(name);
    const el: XElement = {
      name, prefix, local, ns: '', attrs: [], children: [], parent: stack[stack.length - 1],
      start: i, nameEnd: i + 1 + name.length, startTagEnd: -1, contentEnd: n, end: n,
      selfClosing: false, closed: false, nsMap: new Map(), text: '',
    };
    if (!name) {
      if (i + 1 >= n) {
        resolveNamespaces(el);
        doc.partial = { kind: 'start', start: i, element: el, state: 'name' };
        i = n;
        break;
      }
      err('Invalid element name', i, i + 2);
      i++;
      continue;
    }

    let j = el.nameEnd;
    let partial: PartialTag | undefined;
    if (j >= n) {
      partial = { kind: 'start', start: i, element: el, state: 'name' };
    }
    while (!partial) {
      const wsStart = j;
      j = skipWs(j);
      if (j >= n) {
        partial = { kind: 'start', start: i, element: el, state: 'inTag' };
        break;
      }
      const c = text[j];
      if (c === '>') {
        el.startTagEnd = j + 1;
        break;
      }
      if (c === '/') {
        if (text[j + 1] === '>') {
          el.selfClosing = true;
          el.startTagEnd = j + 2;
          break;
        }
        if (j + 1 >= n) {
          partial = { kind: 'start', start: i, element: el, state: 'inTag' };
          break;
        }
        err('Expected "/>"', j);
        j++;
        continue;
      }
      if (c === '<') {
        err(`Start tag <${name}> is not terminated`, i, j);
        el.startTagEnd = j;
        break;
      }
      NAME.lastIndex = j;
      const am = NAME.exec(text);
      if (!am) {
        err(`Unexpected character "${c}" in start tag`, j);
        j++;
        continue;
      }
      if (j === wsStart) {
        err('Whitespace is required between attributes', j);
      }
      const aStart = j;
      const aName = am[0];
      j += aName.length;
      const aNameEnd = j;
      if (j >= n) {
        partial = { kind: 'start', start: i, element: el, state: 'attrName', attrName: aName, attrStart: aStart };
        break;
      }
      j = skipWs(j);
      if (j >= n) {
        partial = { kind: 'start', start: i, element: el, state: 'afterAttrName', attrName: aName, attrStart: aStart };
        break;
      }
      if (text[j] !== '=') {
        err(`Attribute "${aName}" has no value`, aStart, aNameEnd);
        continue;
      }
      j = skipWs(j + 1);
      if (j >= n) {
        partial = { kind: 'start', start: i, element: el, state: 'afterEq', attrName: aName, attrStart: aStart };
        break;
      }
      const q = text[j];
      const [ap, al] = splitQName(aName);
      if (q !== '"' && q !== "'") {
        err(`Value of attribute "${aName}" must be quoted`, j);
        const vs = j;
        while (j < n && !WS.test(text[j]) && text[j] !== '>' && !(text[j] === '/' && text[j + 1] === '>')) {
          j++;
        }
        const raw = text.substring(vs, j);
        el.attrs.push({ name: aName, prefix: ap, local: al, ns: '', value: decodeEntities(raw), rawValue: raw, start: aStart, nameEnd: aNameEnd, valueStart: vs, valueEnd: j, end: j });
        continue;
      }
      const vStart = j + 1;
      const close = text.indexOf(q, vStart);
      if (close < 0) {
        partial = { kind: 'start', start: i, element: el, state: 'attrValue', attrName: aName, attrStart: aStart, valueStart: vStart, quote: q };
        break;
      }
      const raw = text.substring(vStart, close);
      const ltPos = raw.indexOf('<');
      if (ltPos >= 0) {
        err('"<" is not allowed in attribute values (use &lt;)', vStart + ltPos);
      }
      checkRefs(vStart, close);
      if (el.attrs.some(a => a.name === aName)) {
        err(`Duplicate attribute "${aName}"`, aStart, aNameEnd);
      }
      el.attrs.push({ name: aName, prefix: ap, local: al, ns: '', value: decodeEntities(raw), rawValue: raw, start: aStart, nameEnd: aNameEnd, valueStart: vStart, valueEnd: close, end: close + 1 });
      j = close + 1;
    }

    resolveNamespaces(el);
    if (partial) {
      doc.partial = partial;
      err(`Unterminated start tag <${name}>`, i, el.nameEnd);
      i = n;
      break;
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(el);
    } else if (doc.root) {
      err('Only one root element is allowed', i + 1, el.nameEnd);
    } else {
      doc.root = el;
    }
    doc.elements.push(el);
    if (el.selfClosing) {
      el.closed = true;
      el.contentEnd = el.startTagEnd;
      el.end = el.startTagEnd;
    } else {
      stack.push(el);
    }
    i = el.startTagEnd;
  }

  for (let k = stack.length - 1; k >= 0; k--) {
    const el = stack[k];
    if (!doc.partial) {
      err(`Element <${el.name}> is not closed`, el.start + 1, el.nameEnd);
    }
    el.contentEnd = n;
    el.end = n;
  }
  if (!doc.root && !doc.partial) {
    err('Document has no root element', 0, Math.min(n, 1));
  }
  doc.openStack = stack.slice();
  return doc;
}

export function getAttr(el: XElement | undefined, name: string): string | undefined {
  return el?.attrs.find(a => a.name === name)?.value;
}

export function getAttrNode(el: XElement | undefined, name: string): XAttr | undefined {
  return el?.attrs.find(a => a.name === name);
}

/** Finds the innermost element whose markup contains the offset. */
export function elementAt(doc: XmlDocument, offset: number): XElement | undefined {
  let best: XElement | undefined;
  for (const el of doc.elements) {
    if (el.start <= offset && offset < el.end) {
      if (!best || el.start >= best.start) {
        best = el;
      }
    }
  }
  return best;
}

/** Converts offsets to line/column positions (0-based). */
export class LineIndex {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.starts.push(i + 1);
      }
    }
  }
  position(offset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: offset - this.starts[lo] };
  }
  offset(line: number, character: number): number {
    const start = this.starts[Math.max(0, Math.min(line, this.starts.length - 1))];
    return start + character;
  }
}
