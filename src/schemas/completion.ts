import { getAttr, XAttr, XElement } from '../xml/parser';
import type { CompletionData, CompletionResult, ItemKind } from '../xproc/completion';
import { XPROC_NS } from '../xproc/types';
import { RELAXNG } from './relaxng';
import { SCHEMATRON } from './schematron';
import { ValueContext, VocabAttrDef, VocabElementDef, Vocabulary } from './types';
import { XMLSCHEMA } from './xmlschema';

const VOCABULARIES = [SCHEMATRON, RELAXNG, XMLSCHEMA];
const BY_NS = new Map(VOCABULARIES.map(v => [v.ns, v]));
const DEFS = new Map(VOCABULARIES.map(v => [v, new Map(v.elements.map(d => [d.local, d]))]));

/** the schema language expected on the schema port of the validation steps */
const SCHEMA_STEPS = new Map([['validate-with-schematron', SCHEMATRON], ['validate-with-relax-ng', RELAXNG], ['validate-with-xml-schema', XMLSCHEMA]]);

export const SCHEMA_NAMESPACES = VOCABULARIES.map(v => v.ns);

const qn = (prefix: string, local: string) => (prefix ? `${prefix}:${local}` : local);

/** the schema language of el, if el is an element of Schematron, RELAX NG or XML Schema */
export function vocabularyOf(el: XElement | undefined): Vocabulary | undefined {
  return el ? BY_NS.get(el.ns) : undefined;
}

/** the schema language expected by a port connection (p:input or p:with-input port="schema" of a validation step) */
export function schemaPortVocabulary(port: XElement | undefined): Vocabulary | undefined {
  if (!port || port.ns !== XPROC_NS || (port.local !== 'input' && port.local !== 'with-input') || getAttr(port, 'port') !== 'schema') {
    return undefined;
  }
  return port.parent?.ns === XPROC_NS ? SCHEMA_STEPS.get(port.parent.local) : undefined;
}

function elementDef(vocab: Vocabulary, local: string): VocabElementDef | undefined {
  return DEFS.get(vocab)!.get(local);
}

function prefixIn(nsMap: Map<string, string>, ns: string): string | undefined {
  for (const [p, u] of nsMap) {
    if (u === ns) {
      return p;
    }
  }
  return undefined;
}

/** the outermost element of the schema that contains el */
function schemaRoot(vocab: Vocabulary, el: XElement): XElement {
  let root = el;
  for (let e: XElement | undefined = el; e; e = e.parent) {
    if (e.ns === vocab.ns) {
      root = e;
    }
  }
  return root;
}

function detailOf(vocab: Vocabulary, def: VocabElementDef): string {
  return `${vocab.name} element${def.note ? ` (${def.note})` : ''}`;
}

const valuesDoc = (ad: VocabAttrDef) => (ad.values ? `values: ${ad.values.map(x => `\`${x}\``).join(', ')}` : undefined);

function documentation(vocab: Vocabulary, def: VocabElementDef, label: string): string {
  const lines = [`**${label}** — ${detailOf(vocab, def)}`, '', def.doc];
  if (def.attrs.length) {
    lines.push('', 'Attributes: ' + def.attrs.map(x => `\`${x.name}\`${x.required ? ' *(required)*' : ''}`).join(', '));
  }
  lines.push('', `[Specification](${vocab.specUrl})`);
  return lines.join('\n');
}

function elementSnippet(label: string, prefix: string, def: VocabElementDef): string {
  let n = 1;
  let attrs = '';
  for (const name of def.snippetAttrs ?? def.attrs.filter(x => x.required).map(x => x.name)) {
    const ad = def.attrs.find(x => x.name === name);
    if (ad) {
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

/** elements of the schema language allowed as children of parent (an element of the schema) */
export function schemaElementItems(vocab: Vocabulary, parent: XElement, nameOnly: boolean, withLt: boolean): CompletionData[] {
  const lt = withLt ? '<' : '';
  const prefix = parent.prefix;
  const items: CompletionData[] = [];
  const children = vocab.children?.(parent) ?? elementDef(vocab, parent.local)?.children ?? [];
  children.forEach((local, idx) => {
    const def = elementDef(vocab, local)!;
    const label = qn(prefix, local);
    const snippet = elementSnippet(label, prefix, def);
    items.push({
      label, kind: 'element', filterText: lt + label, sortText: `1${String(idx).padStart(2, '0')}`,
      detail: detailOf(vocab, def),
      documentation: documentation(vocab, def, label),
      isSnippet: true,
      insertText: lt + (nameOnly ? label : snippet),
      retrigger: !nameOnly && snippet.includes('="${1'),
    });
  });
  items.push({
    label: `/${parent.name}`, kind: 'closeTag', filterText: lt + '/' + parent.name, sortText: '0',
    insertText: `${lt}/${parent.name}${nameOnly ? '' : '>'}`, detail: 'close tag',
  });
  return items;
}

/** root elements of the schema language (for the schema port of a validation step) */
export function schemaRootItems(vocab: Vocabulary | undefined, nsMap: Map<string, string>, nameOnly: boolean, withLt: boolean): CompletionData[] {
  if (!vocab) {
    return [];
  }
  const lt = withLt ? '<' : '';
  const declared = prefixIn(nsMap, vocab.ns);
  const prefix = declared ?? vocab.prefix;
  return vocab.roots.map((r, idx) => {
    const name = qn(prefix, r.local);
    let attrs = declared !== undefined ? '' : prefix ? ` xmlns:${prefix}="${vocab.ns}"` : ` xmlns="${vocab.ns}"`;
    for (const [p, ns] of r.namespaces ?? []) {
      if (nsMap.get(p) !== ns) {
        attrs += ` xmlns:${p}="${ns}"`;
      }
    }
    const body = r.body ? r.body(prefix ? prefix + ':' : '') : '$0';
    return {
      label: r.variant ? `${name} (${r.variant})` : name, filterText: lt + name, kind: 'element' as ItemKind, sortText: `05${idx}`, isSnippet: true,
      detail: r.detail,
      documentation: documentation(vocab, elementDef(vocab, r.local)!, name),
      insertText: nameOnly ? name : `${lt}${name}${attrs}${r.attrs}>\n\t${body}\n</${name}>`,
    };
  });
}

function attrDefs(vocab: Vocabulary, el: XElement): { def: VocabAttrDef; common: boolean }[] {
  const result: { def: VocabAttrDef; common: boolean }[] = [];
  const push = (def: VocabAttrDef, common: boolean) => {
    if (!result.some(r => r.def.name === def.name)) {
      result.push({ def, common });
    }
  };
  elementDef(vocab, el.local)?.attrs.forEach(d => push(d, false));
  vocab.commonAttrs?.forEach(d => push(d, true));
  return result;
}

export function schemaAttributeItems(vocab: Vocabulary, el: XElement): CompletionData[] {
  const present = new Set(el.attrs.map(x => x.name));
  return attrDefs(vocab, el).filter(r => !present.has(r.def.name)).map(({ def, common }) => ({
    label: def.name, kind: 'attribute' as ItemKind, isSnippet: true, insertText: `${def.name}="$1"`,
    sortText: (def.required ? '0' : common ? '2' : '1') + def.name,
    detail: def.required ? 'required' : common ? `common ${vocab.name} attribute` : undefined,
    documentation: valuesDoc(def),
    retrigger: true,
  }));
}

/**
 * Completion of attribute values in a schema. `full` maps an element of the document prefix
 * (which is all the completion parser sees) to the element in the complete document.
 */
export function schemaValueItems(vocab: Vocabulary, el: XElement, attrName: string, typed: string, valueStart: number, valueEnd: number, text: string,
  full: (e: XElement) => XElement | undefined): CompletionResult | undefined {
  const items: CompletionData[] = [];
  const add = (label: string, detail?: string, kind: ItemKind = 'value') => {
    if (!items.some(i => i.label === label)) {
      items.push({ label, kind, insertText: label, detail, sortText: String(items.length).padStart(4, '0') });
    }
  };
  let fullEl: XElement | undefined;
  for (let e: XElement | undefined = el; e && !fullEl; e = e.parent) {
    fullEl = full(e);
  }
  const root = schemaRoot(vocab, el);
  const c: ValueContext = { el, full: fullEl ?? el, root: full(root) ?? root, attr: attrName, add };

  const cursor = valueStart + typed.length;
  const varRef = vocab.variables ? /\$((?:[\w.-]+:)?[\w.-]*)$/.exec(typed) : null;
  if (varRef) {
    let end = cursor;
    while (end < text.length && /[\w.:-]/.test(text[end])) {
      end++;
    }
    vocab.variables!(c).forEach(v => add('$' + v.name, v.detail, 'variable'));
    return items.length ? { items, replaceStart: valueStart + varRef.index, replaceEnd: end } : undefined;
  }

  let replaceStart = valueStart;
  if (vocab.tokenLists?.has(attrName)) {
    replaceStart = valueStart + typed.lastIndexOf(' ') + 1;
    valueEnd = Math.max(replaceStart, cursor);
  }
  attrDefs(vocab, el).find(r => r.def.name === attrName)?.def.values?.forEach(x => add(x));
  vocab.values?.(c);
  return items.length ? { items, replaceStart, replaceEnd: valueEnd } : undefined;
}

export function schemaElementDoc(vocab: Vocabulary, el: XElement): string | undefined {
  const def = elementDef(vocab, el.local);
  return def ? documentation(vocab, def, el.name) : undefined;
}

export function schemaAttrDoc(vocab: Vocabulary, el: XElement, attr: XAttr): string | undefined {
  const r = attrDefs(vocab, el).find(x => x.def.name === attr.name);
  if (!r) {
    return undefined;
  }
  const what = r.common ? `common ${vocab.name} attribute` : `attribute of \`${el.name}\``;
  const values = valuesDoc(r.def);
  return `**${attr.name}** — ${what}${r.def.required ? ' *(required)*' : ''}${values ? `\n\n${values}` : ''}`;
}
