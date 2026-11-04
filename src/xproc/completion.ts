import { getAttr, parseXml, XElement, XmlDocument } from '../xml/parser';
import {
  atomicStepChildren, builtinSteps, COMMON_NAMESPACES, commonAttrs, compoundSteps, CONTENT_TYPES, coreElement, SEQUENCE_TYPES, stepAttrs,
} from './core';
import { classify, findStep, isInsideAnyContent, isXProc, lookupStep, readablePorts, stepsInScope, XProcModel } from './model';
import { AttrDef, clark, CoreElementDef, isV3, OptionDef, StepDef, XPROC_NS, XProcVersion } from './types';
import { inXslt, xsltAttributeItems, xsltElementItems, xsltRootItems, xsltValueItems } from '../xslt/completion';

export type ItemKind = 'element' | 'step' | 'attribute' | 'value' | 'closeTag' | 'port' | 'stepName' | 'namespace' | 'file' | 'variable';

export interface CompletionData {
  label: string;
  kind: ItemKind;
  insertText: string;
  isSnippet?: boolean;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  /** trigger suggestions again after inserting the item (attribute values) */
  retrigger?: boolean;
}

export interface CompletionResult {
  items: CompletionData[];
  replaceStart: number;
  replaceEnd: number;
  /** the adapter should add file paths (relative hrefs) with the given extensions */
  hrefCompletion?: { typed: string; extensions: string[] };
  /** completion in character content (not inside markup) */
  inContent?: boolean;
}

const NAME_CHAR = /[-\w.:\u00B7\u00C0-\uFFFF]/;

export function qn(prefix: string, local: string): string {
  return prefix ? `${prefix}:${local}` : local;
}

function escapeSnippet(s: string): string {
  return s.replace(/[\\$}]/g, m => '\\' + m);
}

export function prefixFor(nsMap: Map<string, string>, ns: string): string | undefined {
  let found: string | undefined;
  for (const [p, u] of nsMap) {
    if (u === ns && p !== '') {
      if (found === undefined || p === 'p') {
        found = p;
      }
    }
  }
  return found;
}

export function stepLabel(def: StepDef, version: XProcVersion): string {
  return `${def.group === 'standard' || def.group === 'optional' ? `XProc ${version} ${def.group}` : def.group.startsWith('file:') ? 'declared in ' + def.group.replace(/^.*\//, '') : def.group} step`;
}

export function optionDoc(o: OptionDef): string {
  const parts: string[] = [];
  if (o.required) {
    parts.push('*required*');
  }
  if (o.as) {
    parts.push(`as \`${o.as}\``);
  }
  if (o.select !== undefined) {
    parts.push(`default: \`${o.select}\``);
  }
  if (o.values) {
    parts.push(`values: ${o.values.map(x => `\`${x}\``).join(', ')}`);
  }
  return [parts.join(' · '), o.doc].filter(Boolean).join('\n\n');
}

export function stepDocumentation(def: StepDef, label: string, version: XProcVersion): string {
  const port = (p: StepDef['ports'][0]) => {
    const flags = [p.primary && 'primary', p.sequence && 'sequence', p.parameter && 'parameters', p.hasDefault && 'default'].filter(Boolean);
    return `\`${p.port}\`${flags.length ? ` (${flags.join(', ')})` : ''}`;
  };
  const lines = [`**${label}** — ${stepLabel(def, version)}`];
  if (def.doc) {
    lines.push('', def.doc);
  }
  const ins = def.ports.filter(p => p.input);
  const outs = def.ports.filter(p => !p.input);
  lines.push('', `**Inputs:** ${ins.length ? ins.map(port).join(' · ') : '—'}  `, `**Outputs:** ${outs.length ? outs.map(port).join(' · ') : '—'}`);
  if (def.options.length) {
    lines.push('', '**Options:**');
    for (const o of def.options) {
      const extra = [o.required ? '*required*' : '', o.select !== undefined ? `= \`${o.select}\`` : '', o.values ? `(${o.values.join(' | ')})` : '']
        .filter(Boolean).join(' ');
      lines.push(`- \`${o.name}\` ${extra}`);
    }
  }
  if (def.specUrl) {
    lines.push('', `[Specification](${def.specUrl})`);
  }
  return lines.join('\n');
}

export function coreDocumentation(def: CoreElementDef, label: string): string {
  const lines = [`**${label}**`, '', def.doc];
  if (def.attrs.length) {
    lines.push('', 'Attributes: ' + def.attrs.map(a => `\`${a.name}\`${a.required ? ' *(required)*' : ''}`).join(', '));
  }
  if (def.specUrl) {
    lines.push('', `[Specification](${def.specUrl})`);
  }
  return lines.join('\n');
}

class Context {
  readonly v: XProcVersion;
  constructor(readonly model: XProcModel, readonly pre: XmlDocument) {
    this.v = model.version;
  }

  xp(nsMap: Map<string, string>): string {
    return prefixFor(nsMap, XPROC_NS) ?? (nsMap.get('') === XPROC_NS ? '' : 'p');
  }

  /** the counterpart of an element of the prefix document in the full document */
  full(el: XElement | undefined): XElement | undefined {
    return el ? this.model.doc.elements.find(e => e.start === el.start && e.name === el.name) : undefined;
  }

  anchor(el: XElement | undefined): XElement | undefined {
    for (let e = el; e; e = e.parent) {
      const f = this.full(e);
      if (f) {
        return f;
      }
    }
    return undefined;
  }

  inForeignContent(el: XElement | undefined): boolean {
    if (!el) {
      return false;
    }
    if (isXProc(el) && ['inline', 'documentation', 'pipeinfo'].includes(el.local)) {
      return true;
    }
    if (isInsideAnyContent(el)) {
      return true;
    }
    for (let e: XElement | undefined = el; e; e = e.parent) {
      if (classify(this.model, e) === 'foreign') {
        return true;
      }
    }
    return false;
  }
}

export function complete(model: XProcModel, offset: number): CompletionResult | undefined {
  const text = model.doc.text;
  const pre = parseXml(text.substring(0, offset));
  const ctx = new Context(model, pre);
  const stack = pre.openStack;
  const parent = stack[stack.length - 1];
  const p = pre.partial;

  if (p) {
    if (p.kind === 'start' && p.element) {
      const el = p.element;
      switch (p.state) {
        case 'name': {
          let end = offset;
          while (end < text.length && NAME_CHAR.test(text[end])) {
            end++;
          }
          const nameOnly = /^[^\S\n]*[^\s<]/.test(text.substring(end));
          return { items: elementItems(ctx, parent, el.nsMap, nameOnly, false), replaceStart: el.start + 1, replaceEnd: end };
        }
        case 'inTag':
          return { items: attributeItems(ctx, el), replaceStart: offset, replaceEnd: offset };
        case 'attrName': {
          let end = offset;
          while (end < text.length && NAME_CHAR.test(text[end])) {
            end++;
          }
          return { items: attributeItems(ctx, el), replaceStart: p.attrStart!, replaceEnd: end };
        }
        case 'afterEq': {
          const r = valueItems(ctx, el, p.attrName!, '', offset);
          if (!r) {
            return undefined;
          }
          r.items.forEach(i => (i.insertText = `"${i.insertText}"`));
          return r;
        }
        case 'attrValue': {
          const typed = text.substring(p.valueStart!, offset);
          let end = offset;
          while (end < text.length && text[end] !== p.quote && text[end] !== '\n' && text[end] !== '<') {
            end++;
          }
          if (text[end] !== p.quote) {
            end = offset;
          }
          return valueItems(ctx, el, p.attrName!, typed, p.valueStart!, end);
        }
        default:
          return undefined;
      }
    }
    if (p.kind === 'end') {
      if (!parent) {
        return undefined;
      }
      let end = offset;
      while (end < text.length && NAME_CHAR.test(text[end])) {
        end++;
      }
      const hasGt = text[end] === '>';
      return {
        items: [{ label: parent.name, kind: 'closeTag', insertText: parent.name + (hasGt ? '' : '>'), detail: 'close tag', sortText: '0' }],
        replaceStart: p.start + 2,
        replaceEnd: end,
      };
    }
    return undefined;
  }

  // in character content: offer elements including '<'
  if (!parent && pre.root) {
    return undefined;
  }
  return { items: elementItems(ctx, parent, parent?.nsMap ?? new Map(), false, true), replaceStart: offset, replaceEnd: offset, inContent: true };
}

function elementItems(ctx: Context, parent: XElement | undefined, nsMap: Map<string, string>, nameOnly: boolean, withLt: boolean): CompletionData[] {
  const { model, v } = ctx;
  const items: CompletionData[] = [];
  const lt = withLt ? '<' : '';
  if (!parent) {
    if (withLt && ctx.pre.root) {
      return items;
    }
    const xp = ctx.xp(nsMap);
    const decl = nsMap.get(xp) === XPROC_NS ? '' : xp ? ` xmlns:${xp}="${XPROC_NS}"` : ` xmlns="${XPROC_NS}"`;
    for (const [local, version] of [['declare-step', '3.1'], ['library', '3.1'], ['declare-step', '1.0'], ['library', '1.0']]) {
      const label = qn(xp, local);
      items.push({
        label: `${label} (XProc ${version})`, filterText: lt + label, kind: 'element', isSnippet: true,
        insertText: nameOnly ? label : `${lt}${label}${decl} version="${version}"${local === 'declare-step' ? ' name="${1:main}"' : ''}>\n\t$0\n</${label}>`,
        documentation: coreElement(version as XProcVersion, local)?.doc,
      });
    }
    return items;
  }
  if (inXslt(parent)) {
    return xsltElementItems(parent, nsMap, nameOnly, withLt);
  }
  const stylesheets = isXProc(parent, 'inline') && isStylesheetPort(parent.parent) || (isV3(v) && isStylesheetPort(parent))
    ? xsltRootItems(nsMap, nameOnly, withLt) : [];
  if (ctx.inForeignContent(parent)) {
    return stylesheets;
  }
  items.push(...stylesheets);

  const xp = ctx.xp(nsMap);
  const kind = classify(model, parent);
  let childNames: string[] = [];
  let steps = false;
  if (kind === 'core') {
    const def = coreElement(v, parent.local)!;
    childNames = def.children;
    steps = !!def.steps;
  } else if (kind === 'step' || kind === 'unknown-step') {
    childNames = atomicStepChildren(v);
  }

  if (steps) {
    childNames = [...childNames, ...compoundSteps(v).filter(c => !childNames.includes(c))];
  }
  const parentIsStep = kind === 'step' || kind === 'unknown-step';
  childNames.forEach((local, idx) => {
    const def = coreElement(v, local);
    if (!def) {
      return;
    }
    const label = qn(xp, local);
    items.push({
      label, kind: 'element', filterText: lt + label, sortText: `1${String(idx).padStart(2, '0')}`,
      detail: `XProc ${isV3(v) ? '3' : '1.0'} element`,
      documentation: coreDocumentation(def, label),
      isSnippet: true,
      insertText: lt + (nameOnly ? label : coreSnippet(label, def, parentIsStep && local === 'input')),
      retrigger: !nameOnly && def.attrs.some(a => a.required),
    });
  });

  if (steps) {
    const seen = new Set<string>();
    const add = (def: StepDef) => {
      const key = clark(def.ns, def.local);
      if (seen.has(key)) {
        return;
      }
      let pf = def.ns === XPROC_NS ? xp : prefixFor(nsMap, def.ns);
      let needDecl = false;
      if (pf === undefined) {
        if (def.group === 'standard' || def.group === 'optional' || !def.declaredIn) {
          return; // extension steps are only offered if their namespace is declared
        }
        pf = def.prefix || 'ns';
        needDecl = true;
      }
      seen.add(key);
      const label = qn(pf, def.local);
      items.push({
        label, kind: 'step', filterText: lt + label,
        sortText: (def.ns === XPROC_NS ? '2' : '3') + def.local,
        detail: stepLabel(def, v),
        documentation: stepDocumentation(def, label, v),
        isSnippet: true,
        insertText: lt + (nameOnly ? label : stepSnippet(ctx, label, def, xp, needDecl)),
      });
    };
    for (const def of model.steps.values()) {
      add(def);
    }
    for (const def of builtinSteps(v)) {
      add(def);
    }
  }

  items.push({
    label: `/${parent.name}`, kind: 'closeTag', filterText: lt + '/' + parent.name, sortText: '0',
    insertText: `${lt}/${parent.name}${nameOnly ? '' : '>'}`, detail: 'close tag',
  });
  return items;
}

function coreSnippet(label: string, def: CoreElementDef, forceBlock: boolean): string {
  let n = 1;
  let attrs = '';
  for (const a of def.attrs.filter(x => x.required)) {
    attrs += ` ${a.name}="${a.values ? `\${${n++}|${a.values.join(',')}|}` : `\${${n++}}`}"`;
  }
  if (def.block || forceBlock) {
    return `${label}${attrs}>\n\t$0\n</${label}>`;
  }
  return `${label}${attrs}/>`;
}

function stepSnippet(ctx: Context, label: string, def: StepDef, xp: string, needDecl: boolean): string {
  let n = 1;
  let attrs = needDecl ? ` xmlns:${def.prefix}="${escapeSnippet(def.ns)}"` : '';
  for (const o of def.options.filter(x => x.required)) {
    attrs += ` ${o.name}="${o.values ? `\${${n++}|${o.values.join(',')}|}` : `\${${n++}}`}"`;
  }
  const inputs = def.ports.filter(p => p.input && !p.primary && !p.parameter && !p.hasDefault);
  if (!inputs.length) {
    return `${label}${attrs}/>`;
  }
  const children = inputs.map(p => isV3(ctx.v)
    ? `\t<${qn(xp, 'with-input')} port="${p.port}" href="\${${n++}}"/>`
    : `\t<${qn(xp, 'input')} port="${p.port}">\n\t\t<${qn(xp, 'document')} href="\${${n++}}"/>\n\t</${qn(xp, 'input')}>`);
  return `${label}${attrs}>\n${children.join('\n')}\n</${label}>`;
}

/** an input port (declaration or connection) named "stylesheet", as on p:xslt */
function isStylesheetPort(el: XElement | undefined): boolean {
  return isXProc(el) && (el!.local === 'input' || el!.local === 'with-input') && getAttr(el, 'port') === 'stylesheet';
}

function attributeItems(ctx: Context, el: XElement): CompletionData[] {
  if (inXslt(el)) {
    return xsltAttributeItems(el);
  }
  const { model, v } = ctx;
  const present = new Set(el.attrs.map(a => a.name));
  const items: CompletionData[] = [];
  const add = (name: string, opts: { doc?: string; required?: boolean; detail?: string; value?: string } = {}) => {
    if (present.has(name) || items.some(i => i.label === name)) {
      return;
    }
    items.push({
      label: name, kind: 'attribute', isSnippet: true,
      insertText: opts.value !== undefined ? `${name}="${escapeSnippet(opts.value)}"` : `${name}="$1"`,
      sortText: (opts.required ? '0' : '1') + name,
      detail: opts.detail ?? (opts.required ? 'required' : undefined),
      documentation: opts.doc,
      retrigger: opts.value === undefined,
    });
  };
  const addDefs = (defs: AttrDef[], detail?: string) => defs.forEach(a => add(a.name, { required: a.required, doc: a.doc, detail: a.required ? 'required' : detail }));

  const kind = classify(model, el);
  if (kind === 'core') {
    const def = coreElement(v, el.local)!;
    addDefs(def.attrs);
    if (def.container) {
      addDefs(stepAttrs(v), 'common step attribute');
    }
    addDefs(commonAttrs(v), 'common attribute');
  } else if (kind === 'step' || kind === 'unknown-step') {
    const def = kind === 'step' ? lookupStep(model, el.ns, el.local) : undefined;
    for (const o of def?.options ?? []) {
      add(o.name, { required: o.required, doc: optionDoc(o), detail: o.required ? 'required option' : 'option' });
    }
    const xp = ctx.xp(el.nsMap);
    for (const a of stepAttrs(v)) {
      const qualified = el.ns !== XPROC_NS && isV3(v) && a.name !== 'name' && !a.name.startsWith('xml:');
      add(qualified ? qn(xp || 'p', a.name) : a.name, { detail: 'common step attribute' });
    }
  } else if (kind === 'unknown-xproc') {
    addDefs(commonAttrs(v));
  }

  if (!el.parent) {
    for (const [pf, ns] of COMMON_NAMESPACES) {
      if (!el.nsMap.has(pf) && ![...el.nsMap.values()].includes(ns)) {
        add(`xmlns:${pf}`, { value: ns, detail: ns });
      }
    }
  }
  return items;
}

function valueItems(ctx: Context, el: XElement, attrName: string, typed: string, valueStart: number, valueEnd = valueStart + typed.length): CompletionResult | undefined {
  if (inXslt(el) && attrName !== 'xmlns' && !attrName.startsWith('xmlns:')) {
    return xsltValueItems(el, attrName, typed, valueStart, valueEnd, ctx.model.doc.text, e => ctx.full(e));
  }
  const { model, v } = ctx;
  const items: CompletionData[] = [];
  let replaceStart = valueStart;
  const add = (label: string, detail?: string, doc?: string, kind: ItemKind = 'value') => {
    if (!items.some(i => i.label === label)) {
      items.push({ label, kind, insertText: label, detail, documentation: doc, sortText: String(items.length).padStart(4, '0') });
    }
  };
  const kind = classify(model, el);
  const anchor = ctx.anchor(el);
  const scope = anchor ? stepsInScope(anchor) : [];
  const parentStep = el.parent && classify(model, el.parent) === 'step' ? lookupStep(model, el.parent.ns, el.parent.local) : undefined;

  if (attrName === 'xmlns' || attrName.startsWith('xmlns:')) {
    const pf = attrName.substring(6);
    const sorted = [...COMMON_NAMESPACES].sort((a, b) => (a[0] === pf ? -1 : b[0] === pf ? 1 : 0));
    sorted.forEach(([p, ns]) => add(ns, p, undefined, 'namespace'));
  } else if (isXProc(el)) {
    const local = el.local;
    if (attrName === 'version' && !el.parent) {
      ['3.1', '3.0', '1.0'].forEach(x => add(x, `XProc ${x}`));
    }
    const def = coreElement(v, local);
    const ad = def?.attrs.find(a => a.name === attrName) ?? commonAttrs(v).find(a => a.name === attrName);
    ad?.values?.forEach(x => add(x));
    if (kind === 'step') {
      stepOptionValues(lookupStep(model, el.ns, el.local), attrName, add);
    }

    if (local === 'pipe' && attrName === 'step') {
      for (const s of scope) {
        add(getAttr(s, 'name')!, s.name, undefined, 'stepName');
      }
    } else if (local === 'pipe' && attrName === 'port') {
      const stepName = getAttr(el, 'step');
      const target = stepName && anchor ? findStep(anchor, stepName) : undefined;
      const ports = target && anchor ? readablePorts(model, target, anchor) : undefined;
      if (ports) {
        ports.forEach(pt => add(pt, `port of ${stepName}`, undefined, 'port'));
      } else {
        for (const s of scope) {
          (anchor ? readablePorts(model, s, anchor) : undefined)?.forEach(pt => add(pt, undefined, undefined, 'port'));
        }
      }
    } else if (attrName === 'port' && parentStep && ((isV3(v) && local === 'with-input') || (!isV3(v) && local === 'input'))) {
      const bound = new Set(el.parent!.children.filter(c => c !== el && c.local === local && isXProc(c)).map(c => getAttr(c, 'port')));
      parentStep.ports.filter(pt => pt.input && !bound.has(pt.port))
        .forEach(pt => add(pt.port, [pt.primary && 'primary', pt.sequence && 'sequence', pt.parameter && 'parameters'].filter(Boolean).join(', ') || 'input', undefined, 'port'));
    } else if (attrName === 'port' && local === 'with-param' && parentStep) {
      parentStep.ports.filter(pt => pt.parameter).forEach(pt => add(pt.port, 'parameter port', undefined, 'port'));
    } else if (attrName === 'name' && local === 'with-option' && parentStep) {
      const set = new Set(el.parent!.children.filter(c => c !== el && isXProc(c, 'with-option')).map(c => getAttr(c, 'name')));
      for (const o of parentStep.options) {
        if (!set.has(o.name) && !getAttr(el.parent, o.name)) {
          add(o.name, o.required ? 'required option' : 'option', optionDoc(o));
        }
      }
    } else if (attrName === 'pipe' && isV3(v)) {
      const sp = typed.lastIndexOf(' ');
      replaceStart = valueStart + sp + 1;
      valueEnd = Math.max(replaceStart, valueStart + typed.length);
      for (const s of scope) {
        const name = getAttr(s, 'name')!;
        for (const pt of (anchor ? readablePorts(model, s, anchor) : undefined) ?? []) {
          add(`${pt}@${name}`, s.name, undefined, 'port');
        }
        add(`@${name}`, `default readable port of ${s.name}`, undefined, 'stepName');
      }
    } else if (attrName === 'as') {
      SEQUENCE_TYPES.forEach(t => add(t));
    } else if (attrName === 'content-type' || attrName === 'content-types') {
      CONTENT_TYPES.forEach(t => add(t));
    } else if (attrName === 'type' && (local === 'declare-step' || local === 'pipeline')) {
      for (const [pf, ns] of el.nsMap) {
        if (pf && ns !== XPROC_NS && pf !== 'xml') {
          add(`${pf}:`, ns);
        }
      }
    } else if (attrName === 'href' && local === 'import') {
      return { items, replaceStart, replaceEnd: valueEnd, hrefCompletion: { typed, extensions: ['xpl', 'xproc'] } };
    } else if (attrName === 'href' && (isStylesheetPort(el) || (local === 'document' && isStylesheetPort(el.parent)))) {
      return { items, replaceStart, replaceEnd: valueEnd, hrefCompletion: { typed, extensions: ['xsl', 'xslt'] } };
    } else if (attrName === 'href' && local === 'import-functions') {
      return { items, replaceStart, replaceEnd: valueEnd, hrefCompletion: { typed, extensions: ['xsl', 'xslt', 'xq', 'xqm', 'xquery'] } };
    }
  } else if (kind === 'step') {
    stepOptionValues(lookupStep(model, el.ns, el.local), attrName, add);
  }
  if (!items.length) {
    return undefined;
  }
  return { items, replaceStart, replaceEnd: valueEnd };
}

function stepOptionValues(def: StepDef | undefined, attrName: string, add: (label: string, detail?: string) => void) {
  const o = def?.options.find(x => x.name === attrName);
  if (!o) {
    return;
  }
  o.values?.forEach(x => add(x, o.select === x ? 'default' : undefined));
  if (!o.values && o.select !== undefined && !/[$()"']/.test(o.select)) {
    add(o.select, 'default');
  }
}
