import { getAttr, XAttr, XElement } from '../xml/parser';
import type { CompletionData, CompletionResult, ItemKind } from '../xproc/completion';
import { SEQUENCE_TYPES } from '../xproc/core';
import {
  DECLARATIONS, INSTRUCTIONS, LRE_ATTRS, STANDARD_ATTRS, XSL_NS, XsltAttrDef, xsltElement, XsltElementDef, xsltSpecUrl, XsltVersion,
} from './schema';

const XS_NS = 'http://www.w3.org/2001/XMLSchema';
const ROOTS = ['stylesheet', 'transform', 'package'];
/** attributes whose value is a whitespace-separated list */
const TOKEN_LISTS = new Set(['mode', 'use-attribute-sets', 'exclude-result-prefixes', 'extension-element-prefixes', 'use-character-maps',
  'use-accumulators', 'cdata-section-elements', 'suppress-indentation', 'elements']);

const qn = (prefix: string, local: string) => (prefix ? `${prefix}:${local}` : local);

export function isXsl(el: XElement | undefined, local?: string): boolean {
  return !!el && el.ns === XSL_NS && (local === undefined || el.local === local);
}

function hasXslVersion(el: XElement): boolean {
  return el.attrs.some(a => a.ns === XSL_NS && a.local === 'version');
}

/** true if el is an XSLT element or a literal result element in a stylesheet */
export function inXslt(el: XElement | undefined): boolean {
  for (let e = el; e; e = e.parent) {
    if (e.ns === XSL_NS || hasXslVersion(e)) {
      return true;
    }
  }
  return false;
}

/** the XSLT version in effect for el (the nearest [xsl:]version attribute) */
export function xsltVersion(el: XElement | undefined): XsltVersion {
  for (let e = el; e; e = e.parent) {
    const v = e.ns === XSL_NS ? getAttr(e, 'version') : e.attrs.find(a => a.ns === XSL_NS && a.local === 'version')?.value;
    if (v !== undefined) {
      const n = parseFloat(v);
      return isNaN(n) || n >= 3 ? 3 : n >= 2 ? 2 : 1;
    }
  }
  return 3;
}

/** the outermost element of the stylesheet that contains el */
function stylesheetRoot(el: XElement): XElement {
  let root = el;
  for (let e: XElement | undefined = el; e; e = e.parent) {
    if (isXsl(e) && ROOTS.includes(e.local)) {
      return e;
    }
    if (e.ns === XSL_NS || hasXslVersion(e)) {
      root = e;
    }
  }
  return root;
}

function* descendants(el: XElement): Generator<XElement> {
  for (const c of el.children) {
    yield c;
    yield* descendants(c);
  }
}

function xslPrefix(nsMap: Map<string, string>): string | undefined {
  if (nsMap.get('xsl') === XSL_NS) {
    return 'xsl';
  }
  for (const [p, u] of nsMap) {
    if (u === XSL_NS) {
      return p;
    }
  }
  return undefined;
}

const available = (version: XsltVersion) => (x: { since?: XsltVersion }) => (x.since ?? 1) <= version;

function categoryLabel(def: XsltElementDef): string {
  const cat = def.category === 'root' ? 'stylesheet element' : def.category;
  return def.since > 1 ? `XSLT ${cat} (since XSLT ${def.since}.0)` : `XSLT ${cat}`;
}

export function xsltDocumentation(def: XsltElementDef, label: string, version: XsltVersion): string {
  const lines = [`**${label}** — ${categoryLabel(def)}`, '', def.doc];
  const attrs = def.attrs.filter(available(version));
  if (attrs.length) {
    lines.push('', 'Attributes: ' + attrs.map(x => `\`${x.name}\`${x.required ? ' *(required)*' : ''}`).join(', '));
  }
  if (def.since > version) {
    lines.push('', `*Not available in XSLT ${version}.0.*`);
  }
  lines.push('', `[Specification](${xsltSpecUrl(def, version)})`);
  return lines.join('\n');
}

function allowedChildren(parent: XElement, version: XsltVersion): string[] {
  const spec = isXsl(parent) ? xsltElement(parent.local)?.children ?? ['#sc'] : ['#sc'];
  const result: string[] = [];
  for (const s of spec) {
    for (const local of s === '#sc' ? INSTRUCTIONS : s === '#decl' ? DECLARATIONS : [s]) {
      if (!result.includes(local)) {
        result.push(local);
      }
    }
  }
  let inIterate = false;
  for (let e: XElement | undefined = parent; e && !inIterate; e = e.parent) {
    inIterate = isXsl(e, 'iterate');
  }
  return result.filter(local => {
    const def = xsltElement(local);
    return !!def && def.since <= version && (inIterate || (local !== 'break' && local !== 'next-iteration'));
  });
}

function elementSnippet(label: string, prefix: string, def: XsltElementDef, version: XsltVersion): string {
  let n = 1;
  let attrs = '';
  for (const name of def.snippetAttrs ?? def.attrs.filter(x => x.required).map(x => x.name)) {
    const ad = def.attrs.find(x => x.name === name);
    if (ad && available(version)(ad)) {
      attrs += ` ${name}="${ad.values ? `\${${n++}|${ad.values.join(',')}|}` : `\${${n++}}`}"`;
    }
  }
  if (def.form === 'empty') {
    return `${label}${attrs}/>`;
  }
  if (def.form === 'inline') {
    return `${label}${attrs}>$0</${label}>`;
  }
  return `${label}${attrs}>\n\t${def.body ? def.body(prefix ? prefix + ':' : '') : '$0'}\n</${label}>`;
}

/** XSLT elements allowed as children of parent (an element of a stylesheet) */
export function xsltElementItems(parent: XElement, nsMap: Map<string, string>, nameOnly: boolean, withLt: boolean): CompletionData[] {
  const lt = withLt ? '<' : '';
  const version = xsltVersion(parent);
  const prefix = xslPrefix(nsMap);
  const items: CompletionData[] = [];
  if (prefix !== undefined) {
    allowedChildren(parent, version).forEach((local, idx) => {
      const def = xsltElement(local)!;
      const label = qn(prefix, local);
      const snippet = elementSnippet(label, prefix, def, version);
      items.push({
        label, kind: 'element', filterText: lt + label, sortText: `1${String(idx).padStart(2, '0')}`,
        detail: categoryLabel(def),
        documentation: xsltDocumentation(def, label, version),
        isSnippet: true,
        insertText: lt + (nameOnly ? label : snippet),
        retrigger: !nameOnly && snippet.includes('="${1'),
      });
    });
  }
  items.push({
    label: `/${parent.name}`, kind: 'closeTag', filterText: lt + '/' + parent.name, sortText: '0',
    insertText: `${lt}/${parent.name}${nameOnly ? '' : '>'}`, detail: 'close tag',
  });
  return items;
}

/** xsl:stylesheet root elements (for the stylesheet port of p:xslt) */
export function xsltRootItems(nsMap: Map<string, string>, nameOnly: boolean, withLt: boolean): CompletionData[] {
  const lt = withLt ? '<' : '';
  const declared = xslPrefix(nsMap);
  const prefix = declared ?? 'xsl';
  const label = qn(prefix, 'stylesheet');
  const xsDeclared = [...nsMap.values()].includes(XS_NS);
  return ['3.0', '2.0', '1.0'].map((version, idx) => {
    let attrs = declared === undefined ? ` xmlns:${prefix}="${XSL_NS}"` : '';
    if (version !== '1.0') {
      attrs += `${xsDeclared ? '' : ` xmlns:xs="${XS_NS}"`} exclude-result-prefixes="xs"`;
    }
    return {
      label: `${label} (XSLT ${version})`, filterText: lt + label, kind: 'element' as ItemKind, sortText: `05${idx}`, isSnippet: true,
      detail: `XSLT ${version} stylesheet`,
      documentation: xsltDocumentation(xsltElement('stylesheet')!, label, parseInt(version, 10) as XsltVersion),
      insertText: nameOnly ? label : `${lt}${label}${attrs} version="${version}">\n\t$0\n</${label}>`,
    };
  });
}

function attrDefs(el: XElement, version: XsltVersion): { name: string; def: XsltAttrDef; detail?: string }[] {
  const result: { name: string; def: XsltAttrDef; detail?: string }[] = [];
  const push = (name: string, def: XsltAttrDef, detail?: string) => {
    if (available(version)(def) && !result.some(r => r.name === name)) {
      result.push({ name, def, detail });
    }
  };
  if (isXsl(el)) {
    for (const ad of xsltElement(el.local)?.attrs ?? []) {
      push(ad.name, ad, ad.required ? 'required' : undefined);
    }
    STANDARD_ATTRS.forEach(ad => push(ad.name, ad, 'standard XSLT attribute'));
  } else {
    const prefix = xslPrefix(el.nsMap);
    if (prefix) {
      if (!inXslt(el.parent)) {
        push(`${prefix}:version`, { name: 'version', values: ['3.0', '2.0', '1.0'] }, 'simplified stylesheet');
      }
      LRE_ATTRS.forEach(ad => push(`${prefix}:${ad.name}`, ad, 'literal result element'));
    }
  }
  return result;
}

export function xsltAttributeItems(el: XElement): CompletionData[] {
  const version = xsltVersion(el);
  const present = new Set(el.attrs.map(x => x.name));
  return attrDefs(el, version).filter(r => !present.has(r.name)).map(r => ({
    label: r.name, kind: 'attribute' as ItemKind, isSnippet: true, insertText: `${r.name}="$1"`,
    sortText: (r.def.required ? '0' : r.detail?.startsWith('standard') ? '2' : '1') + r.name,
    detail: r.detail,
    documentation: r.def.values ? `values: ${r.def.values.map(x => `\`${x}\``).join(', ')}` : undefined,
    retrigger: true,
  }));
}

export function xsltAttrDoc(el: XElement, a: XAttr): string | undefined {
  const r = attrDefs(el, 3).find(x => x.name === a.name);
  if (!r) {
    return undefined;
  }
  const what = isXsl(el) ? (r.detail?.startsWith('standard') ? 'standard XSLT attribute' : `attribute of \`${el.name}\``) : 'XSLT attribute on a literal result element';
  return `**${a.name}** — ${what}${r.def.required ? ' *(required)*' : ''}${r.def.values ? `\n\nvalues: ${r.def.values.map(x => `\`${x}\``).join(', ')}` : ''}`;
}

export function xsltElementDoc(el: XElement): string | undefined {
  const def = isXsl(el) ? xsltElement(el.local) : undefined;
  return def ? xsltDocumentation(def, el.name, xsltVersion(el)) : undefined;
}

function namesOf(root: XElement, local: string, attr: string): string[] {
  const result: string[] = [];
  for (const e of descendants(root)) {
    const v = isXsl(e, local) ? getAttr(e, attr)?.trim() : undefined;
    if (v && !result.includes(v)) {
      result.push(v);
    }
  }
  return result;
}

function modesOf(root: XElement): string[] {
  const result = new Set<string>();
  for (const e of descendants(root)) {
    const v = isXsl(e, 'template') || isXsl(e, 'apply-templates') ? getAttr(e, 'mode') : isXsl(e, 'mode') ? getAttr(e, 'name') : undefined;
    v?.split(/\s+/).filter(m => m && !m.startsWith('#')).forEach(m => result.add(m));
  }
  return [...result];
}

const paramsOf = (el: XElement | undefined) => (el?.children ?? []).filter(c => isXsl(c, 'param')).map(c => getAttr(c, 'name')).filter((n): n is string => !!n);

function variablesInScope(el: XElement, root: XElement, fullRoot: XElement): { name: string; detail: string }[] {
  const result: { name: string; detail: string }[] = [];
  const add = (v: XElement, global: boolean) => {
    const name = getAttr(v, 'name');
    if (name && !result.some(r => r.name === name)) {
      const as = getAttr(v, 'as');
      result.push({ name, detail: `${global ? 'global' : 'local'} ${v.local}${as ? ` as ${as}` : ''}` });
    }
  };
  for (let e: XElement | undefined = el; e && e !== root; e = e.parent) {
    for (const s of e.parent?.children ?? []) {
      if (s === e) {
        break;
      }
      if (isXsl(s, 'variable') || isXsl(s, 'param')) {
        add(s, e.parent === root);
      }
    }
  }
  for (const c of fullRoot.children) {
    if ((isXsl(c, 'variable') || isXsl(c, 'param')) && c.start !== el.start) {
      add(c, true);
    }
  }
  return result;
}

/**
 * Completion of attribute values in a stylesheet. `full` maps an element of the document prefix
 * (which is all the completion parser sees) to the element in the complete document.
 */
export function xsltValueItems(el: XElement, attrName: string, typed: string, valueStart: number, valueEnd: number, text: string,
  full: (e: XElement) => XElement | undefined): CompletionResult | undefined {
  const version = xsltVersion(el);
  const root = stylesheetRoot(el);
  const fullRoot = full(root) ?? root;
  const items: CompletionData[] = [];
  const add = (label: string, detail?: string, kind: ItemKind = 'value') => {
    if (!items.some(i => i.label === label)) {
      items.push({ label, kind, insertText: label, detail, sortText: String(items.length).padStart(4, '0') });
    }
  };

  const cursor = valueStart + typed.length;
  const varRef = /\$((?:[\w.-]+:)?[\w.-]*)$/.exec(typed);
  if (varRef) {
    let end = cursor;
    while (end < text.length && /[\w.:-]/.test(text[end])) {
      end++;
    }
    variablesInScope(el, root, fullRoot).forEach(v => add('$' + v.name, v.detail, 'variable'));
    return items.length ? { items, replaceStart: valueStart + varRef.index, replaceEnd: end } : undefined;
  }

  const prefix = xslPrefix(el.nsMap);
  const local = isXsl(el) ? attrName : prefix && attrName.startsWith(prefix + ':') ? attrName.substring(prefix.length + 1) : undefined;
  if (local === undefined) {
    return undefined;
  }
  let replaceStart = valueStart;
  if (TOKEN_LISTS.has(local) && !(local === 'mode' && isXsl(el, 'apply-templates'))) {
    replaceStart = valueStart + typed.lastIndexOf(' ') + 1;
    valueEnd = Math.max(replaceStart, cursor);
  }

  attrDefs(el, version).find(r => r.name === attrName)?.def.values?.forEach(x => add(x));
  const parent = el.parent;
  if (local === 'mode') {
    if (isXsl(el, 'template')) {
      add('#all', 'all modes');
      add(version >= 3 ? '#unnamed' : '#default', 'the unnamed mode');
    } else if (isXsl(el, 'apply-templates')) {
      add('#current', 'the current mode');
      add(version >= 3 ? '#unnamed' : '#default', 'the unnamed mode');
    }
    modesOf(fullRoot).forEach(m => add(m, 'mode'));
  } else if (local === 'name' && isXsl(el, 'mode')) {
    modesOf(fullRoot).forEach(m => add(m, 'mode'));
  } else if (local === 'default-mode') {
    add('#unnamed', 'the unnamed mode');
    modesOf(fullRoot).forEach(m => add(m, 'mode'));
  } else if (local === 'name' && isXsl(el, 'call-template')) {
    namesOf(fullRoot, 'template', 'name').forEach(n => add(n, 'named template', 'stepName'));
  } else if (local === 'name' && isXsl(el, 'with-param') && parent) {
    let params: string[] = [];
    if (isXsl(parent, 'call-template')) {
      const name = getAttr(parent, 'name');
      params = paramsOf([...descendants(fullRoot)].find(e => isXsl(e, 'template') && getAttr(e, 'name') === name));
    } else if (isXsl(parent, 'next-iteration')) {
      let it: XElement | undefined = parent;
      while (it && !isXsl(it, 'iterate')) {
        it = it.parent;
      }
      params = paramsOf(it);
    } else if (isXsl(parent, 'apply-templates') || isXsl(parent, 'apply-imports') || isXsl(parent, 'next-match')) {
      params = [...descendants(fullRoot)].filter(e => isXsl(e, 'template') && getAttr(e, 'match')).flatMap(paramsOf);
    }
    const passed = new Set(parent.children.filter(c => c !== el && isXsl(c, 'with-param')).map(c => getAttr(c, 'name')));
    params.filter(p => !passed.has(p)).forEach(p => add(p, 'parameter'));
  } else if (local === 'use-attribute-sets') {
    namesOf(fullRoot, 'attribute-set', 'name').forEach(n => add(n, 'attribute set'));
  } else if (local === 'use-character-maps') {
    namesOf(fullRoot, 'character-map', 'name').forEach(n => add(n, 'character map'));
  } else if (local === 'use-accumulators') {
    add('#all');
    namesOf(fullRoot, 'accumulator', 'name').forEach(n => add(n, 'accumulator'));
  } else if (local === 'format' && isXsl(el, 'result-document')) {
    namesOf(fullRoot, 'output', 'name').forEach(n => add(n, 'output definition'));
  } else if (local === 'exclude-result-prefixes' || local === 'extension-element-prefixes') {
    if (local === 'exclude-result-prefixes') {
      add('#all', 'all namespaces');
    }
    add('#default', 'the default namespace');
    for (const [p, ns] of el.nsMap) {
      if (p && p !== 'xml' && ns !== XSL_NS) {
        add(p, ns, 'namespace');
      }
    }
  } else if (local === 'as') {
    SEQUENCE_TYPES.forEach(t => add(t));
  }
  return items.length ? { items, replaceStart, replaceEnd: valueEnd } : undefined;
}
