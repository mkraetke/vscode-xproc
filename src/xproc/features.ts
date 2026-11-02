import { elementAt, getAttr, XAttr, XElement } from '../xml/parser';
import { commonAttrs, coreElement, stepAttrs } from './core';
import { coreDocumentation, optionDoc, stepDocumentation } from './completion';
import { classify, findStep, isXProc, lookupStep, XProcModel } from './model';

export interface HoverResult {
  markdown: string;
  start: number;
  end: number;
}

function elementDoc(model: XProcModel, el: XElement): string | undefined {
  const kind = classify(model, el);
  if (kind === 'core') {
    return coreDocumentation(coreElement(model.version, el.local)!, el.name);
  }
  if (kind === 'step') {
    return stepDocumentation(lookupStep(model, el.ns, el.local)!, el.name, model.version);
  }
  return undefined;
}

function attrDoc(model: XProcModel, el: XElement, a: XAttr): string | undefined {
  const kind = classify(model, el);
  if (kind === 'step') {
    const o = lookupStep(model, el.ns, el.local)?.options.find(x => x.name === a.name);
    if (o) {
      return `**${a.name}** — option of \`${el.name}\`\n\n${optionDoc(o)}`;
    }
  }
  if (kind === 'core') {
    const ad = coreElement(model.version, el.local)?.attrs.find(x => x.name === a.name);
    if (ad) {
      return `**${a.name}** — attribute of \`${el.name}\`${ad.required ? ' *(required)*' : ''}${ad.values ? `\n\nvalues: ${ad.values.map(x => `\`${x}\``).join(', ')}` : ''}`;
    }
  }
  if ([...commonAttrs(model.version), ...stepAttrs(model.version)].some(x => x.name === a.local)) {
    return `**${a.name}** — common XProc attribute`;
  }
  return undefined;
}

export function hover(model: XProcModel, offset: number): HoverResult | undefined {
  const el = elementAt(model.doc, offset);
  if (!el) {
    return undefined;
  }
  const inStartName = offset > el.start && offset <= el.nameEnd;
  const endNameStart = el.contentEnd + 2;
  const inEndName = el.closed && !el.selfClosing && offset >= endNameStart && offset <= endNameStart + el.name.length;
  if (inStartName || inEndName) {
    const md = elementDoc(model, el);
    return md ? { markdown: md, start: inStartName ? el.start + 1 : endNameStart, end: inStartName ? el.nameEnd : endNameStart + el.name.length } : undefined;
  }
  const a = el.attrs.find(x => offset >= x.start && offset <= x.nameEnd);
  if (a) {
    const md = attrDoc(model, el, a);
    return md ? { markdown: md, start: a.start, end: a.nameEnd } : undefined;
  }
  // step reference: show the referenced step
  const ref = stepReferenceAt(el, offset);
  if (ref) {
    const target = findStep(el, ref.name);
    if (target) {
      const md = elementDoc(model, target);
      return { markdown: `Step **${ref.name}** (\`${target.name}\`)${md ? '\n\n---\n\n' + md : ''}`, start: ref.start, end: ref.end };
    }
  }
  return undefined;
}

function stepReferenceAt(el: XElement, offset: number): { name: string; start: number; end: number } | undefined {
  const a = el.attrs.find(x => offset >= x.valueStart && offset <= x.valueEnd);
  if (!a || !isXProc(el)) {
    return undefined;
  }
  if (el.local === 'pipe' && a.name === 'step') {
    return { name: a.value, start: a.valueStart, end: a.valueEnd };
  }
  if (a.name === 'pipe') {
    const rel = offset - a.valueStart;
    for (const m of a.rawValue.matchAll(/\S+/g)) {
      if (rel >= m.index! && rel <= m.index! + m[0].length) {
        const at = m[0].indexOf('@');
        if (at >= 0) {
          return { name: m[0].substring(at + 1), start: a.valueStart + m.index! + at + 1, end: a.valueStart + m.index! + m[0].length };
        }
      }
    }
  }
  return undefined;
}

export interface DefinitionResult {
  uri: string;
  start: number;
  end: number;
  originStart?: number;
  originEnd?: number;
}

export function definition(model: XProcModel, offset: number): DefinitionResult | undefined {
  const el = elementAt(model.doc, offset);
  if (!el) {
    return undefined;
  }
  if (offset > el.start && offset <= el.nameEnd) {
    const def = classify(model, el) === 'step' ? lookupStep(model, el.ns, el.local) : undefined;
    if (def?.declaredIn) {
      return { ...def.declaredIn, originStart: el.start + 1, originEnd: el.nameEnd };
    }
    return undefined;
  }
  const ref = stepReferenceAt(el, offset);
  if (ref) {
    const target = findStep(el, ref.name);
    if (target) {
      return { uri: model.uri, start: target.start, end: target.startTagEnd, originStart: ref.start, originEnd: ref.end };
    }
  }
  if (isXProc(el, 'import')) {
    const href = el.attrs.find(a => a.name === 'href');
    const imp = model.imports.find(i => i.el.start === el.start);
    if (href && imp?.resolved?.startsWith('file:') && offset >= href.valueStart && offset <= href.valueEnd) {
      return { uri: imp.resolved, start: 0, end: 0, originStart: href.valueStart, originEnd: href.valueEnd };
    }
  }
  return undefined;
}

export type SymbolKind = 'pipeline' | 'library' | 'compound' | 'step' | 'input' | 'output' | 'option' | 'variable' | 'import';

export interface SymbolData {
  name: string;
  detail: string;
  kind: SymbolKind;
  start: number;
  end: number;
  selStart: number;
  selEnd: number;
  children: SymbolData[];
}

export function symbols(model: XProcModel): SymbolData[] {
  if (!model.doc.root || !model.isXProc) {
    return [];
  }
  const visit = (el: XElement): SymbolData[] => {
    const kind = classify(model, el);
    let sym: SymbolData | undefined;
    const base = { start: el.start, end: el.end, selStart: el.start + 1, selEnd: el.nameEnd, children: [] as SymbolData[] };
    if (kind === 'core') {
      const name = getAttr(el, 'name');
      switch (el.local) {
        case 'declare-step':
        case 'pipeline':
          sym = { ...base, kind: 'pipeline', name: getAttr(el, 'type') ?? name ?? el.name, detail: el.name };
          break;
        case 'library':
          sym = { ...base, kind: 'library', name: el.name, detail: getAttr(el, 'version') ? `version ${getAttr(el, 'version')}` : '' };
          break;
        case 'input':
        case 'output':
          if (!el.parent || isXProc(el.parent, 'declare-step') || isXProc(el.parent, 'pipeline') || el.local === 'output') {
            sym = { ...base, kind: el.local, name: getAttr(el, 'port') ?? '?', detail: el.name };
          }
          break;
        case 'option':
        case 'variable':
          sym = { ...base, kind: el.local, name: '$' + (name ?? '?'), detail: el.name };
          break;
        case 'import':
          sym = { ...base, kind: 'import', name: getAttr(el, 'href') ?? '?', detail: el.name };
          break;
        default:
          if (coreElement(model.version, el.local)?.steps || ['choose', 'try'].includes(el.local)) {
            sym = { ...base, kind: 'compound', name: name ? `${el.name} ${name}` : el.name, detail: name ? '' : '' };
          }
      }
    } else if (kind === 'step' || kind === 'unknown-step') {
      const name = getAttr(el, 'name');
      sym = { ...base, kind: 'step', name: name ? `${el.name} ${name}` : el.name, detail: '' };
    }
    const children = el.children.flatMap(visit);
    if (sym) {
      sym.children = children;
      return [sym];
    }
    return children;
  };
  return visit(model.doc.root);
}
