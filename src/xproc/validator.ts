import { getAttr, getAttrNode, XAttr, XElement } from '../xml/parser';
import { atomicStepChildren, builtinStep, commonAttrs, compoundSteps, coreElement, stepAttrs } from './core';
import {
  classify, findStep, isExtensionNamespace, isInsideAnyContent, isXProc, lookupStep, readablePorts, walk, XProcModel,
} from './model';
import { isV3, StepDef, XPROC_NS } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface XDiagnostic {
  message: string;
  start: number;
  end: number;
  severity: Severity;
  code?: string;
}

const V1_ONLY: Record<string, string> = {
  'pipeline': 'Use p:declare-step instead.',
  'with-param': 'Parameters are passed as maps in options (e.g. the "parameters" option of p:xslt).',
  'iteration-source': 'Use p:with-input instead.',
  'viewport-source': 'Use p:with-input instead.',
  'xpath-context': 'Use p:with-input instead.',
  'data': 'Use p:document with a content-type instead.',
  'log': '',
  'serialization': 'Use the serialization attribute on p:output instead.',
  'namespaces': '',
};
const V3_ONLY = new Set(['with-input', 'if', 'finally', 'import-functions', 'run-input', 'run-option']);
const NON_STEP_NAMED = new Set(['option', 'variable', 'with-option', 'with-param', 'run-option']);

function nameRange(el: XElement): [number, number] {
  return [el.start + 1, el.nameEnd];
}

function valueRange(a: XAttr): [number, number] {
  return a.valueEnd > a.valueStart ? [a.valueStart, a.valueEnd] : [a.start, a.end];
}

export function validate(model: XProcModel): XDiagnostic[] {
  const diags: XDiagnostic[] = [];
  const add = (range: [number, number], message: string, severity: Severity = 'error', code?: string) =>
    diags.push({ start: range[0], end: range[1], message, severity, code });

  for (const e of model.doc.errors) {
    add([e.start, e.end], e.message, 'error', 'XML');
  }
  const root = model.doc.root;
  if (!root) {
    return diags;
  }
  const v = model.version;
  if (!model.isXProc) {
    if (['declare-step', 'library', 'pipeline'].includes(root.local)) {
      add(nameRange(root), `<${root.name}> is not in the XProc namespace (${XPROC_NS}).`, 'error', 'XS0059');
    }
    return diags;
  }

  const validRoots = isV3(v) ? ['declare-step', 'library'] : ['declare-step', 'pipeline', 'library'];
  if (!validRoots.includes(root.local)) {
    add(nameRange(root), `<${root.name}> is not allowed as document element (expected ${validRoots.map(r => `p:${r}`).join(', ')}).`, 'error', 'XS0059');
  }
  const versionAttr = getAttrNode(root, 'version');
  if (!versionAttr) {
    add(nameRange(root), `The document element must have a version attribute ("1.0", "3.0" or "3.1"). Assuming XProc ${v}.`, 'error', 'XS0062');
  } else if (!['1.0', '3.0', '3.1'].includes(versionAttr.value.trim())) {
    add(valueRange(versionAttr), `Unsupported XProc version "${versionAttr.value}" (expected "1.0", "3.0" or "3.1").`, 'error', 'XS0063');
  }

  for (const imp of model.imports) {
    if (imp.error) {
      const href = getAttrNode(imp.el, 'href');
      add(href ? valueRange(href) : nameRange(imp.el), imp.error, 'warning', 'import');
    }
  }

  for (const el of walk(root)) {
    if (isInsideAnyContent(el)) {
      continue;
    }
    switch (classify(model, el)) {
      case 'unknown-xproc':
        checkUnknownXProc(el);
        break;
      case 'core':
        checkCore(el);
        break;
      case 'step':
        checkStep(el, lookupStep(model, el.ns, el.local)!);
        break;
      case 'unknown-step':
        if (!isExtensionNamespace(el.ns)) {
          if (model.importsComplete) {
            add(nameRange(el), `No declaration found for step <${el.name}> (namespace "${el.ns}"). Is a p:import missing?`, 'warning', 'XS0044');
          } else {
            add(nameRange(el), `No declaration found for step <${el.name}> (some imports could not be resolved).`, 'info', 'XS0044');
          }
        }
        break;
    }
  }
  checkDuplicateNames(root);
  return diags;

  function checkUnknownXProc(el: XElement) {
    let msg = `Unknown XProc element or step <${el.name}>.`;
    if (isV3(v) && el.local in V1_ONLY) {
      msg = `<${el.name}> exists only in XProc 1.0. ${V1_ONLY[el.local]}`.trim();
    } else if (!isV3(v) && (V3_ONLY.has(el.local) || builtinStep('3.1', XPROC_NS, el.local))) {
      msg = `<${el.name}> is not available in XProc 1.0 (it is an XProc 3 element/step).`;
    } else if (v === '3.0' && builtinStep('3.1', XPROC_NS, el.local)) {
      msg = `<${el.name}> requires XProc 3.1 (version="3.1").`;
    }
    add(nameRange(el), msg, 'error', 'XS0044');
  }

  function checkAttributes(el: XElement, allowed: Set<string>, what: (a: XAttr) => [string, string]) {
    for (const a of el.attrs) {
      if (a.prefix === 'xmlns' || a.name === 'xmlns' || a.prefix === 'xml') {
        continue;
      }
      if (a.prefix) {
        if (a.ns === XPROC_NS && el.ns === XPROC_NS) {
          add([a.start, a.nameEnd], `Attributes in the XProc namespace are not allowed on <${el.name}>.`, 'error', 'XS0008');
        }
        continue;
      }
      if (!allowed.has(a.name)) {
        const [msg, code] = what(a);
        add([a.start, a.nameEnd], msg, 'error', code);
      }
    }
  }

  function checkCore(el: XElement) {
    const def = coreElement(v, el.local)!;
    const allowed = new Set([...def.attrs, ...commonAttrs(v)].map(a => a.name));
    if (def.container || el.local === 'when' || el.local === 'otherwise') {
      for (const a of stepAttrs(v)) {
        allowed.add(a.name);
      }
    }
    checkAttributes(el, allowed, a => [`Attribute "${a.name}" is not allowed on <${el.name}>.`, 'XS0008']);

    const parent = el.parent;
    const parentStep = parent && classify(model, parent) === 'step' ? lookupStep(model, parent.ns, parent.local) : undefined;
    const inDeclaration = !parent || isXProc(parent, 'declare-step') || isXProc(parent, 'pipeline') || isXProc(parent, 'library');

    for (const ad of def.attrs) {
      if (!ad.required || getAttrNode(el, ad.name)) {
        continue;
      }
      add(nameRange(el), `<${el.name}> requires the attribute "${ad.name}".`, 'error', 'XS0038');
    }
    for (const ad of def.attrs) {
      const a = getAttrNode(el, ad.name);
      if (a && ad.values && !/[{}]/.test(a.value) && !ad.values.includes(a.value.trim())) {
        add(valueRange(a), `Invalid value "${a.value}" for "${ad.name}" (expected ${ad.values.map(x => `"${x}"`).join(', ')}).`, 'error');
      }
    }

    // children
    for (const c of el.children) {
      if (c.ns !== XPROC_NS) {
        continue;
      }
      if (def.anyContent || def.children.includes(c.local) || c.local === 'documentation' || c.local === 'pipeinfo') {
        continue;
      }
      if (def.steps && (!coreElement(v, c.local) || compoundSteps(v).includes(c.local))) {
        continue; // step (unknown steps are reported elsewhere)
      }
      if (!coreElement(v, c.local) && !lookupStep(model, c.ns, c.local)) {
        continue; // reported as unknown element
      }
      add(nameRange(c), `<${c.name}> is not allowed as a child of <${el.name}>.`, 'error', 'XS0044');
    }

    // port connections of step invocations
    const connectsPort = (isV3(v) && el.local === 'with-input') || (!isV3(v) && el.local === 'input' && !inDeclaration);
    if (connectsPort && parentStep) {
      const port = getAttrNode(el, 'port');
      if (port && !parentStep.ports.some(p => p.input && p.port === port.value)) {
        const avail = parentStep.ports.filter(p => p.input).map(p => `"${p.port}"`).join(', ') || 'none';
        add(valueRange(port), `Step <${parent!.name}> has no input port "${port.value}" (available: ${avail}).`, 'error', 'XS0010');
      } else if (!port && isV3(v) && !parentStep.ports.some(p => p.input && p.primary)) {
        add(nameRange(el), `Step <${parent!.name}> has no primary input port; specify the port attribute.`, 'error', 'XS0086');
      }
    }
    if (el.local === 'with-option' && parentStep) {
      const name = getAttrNode(el, 'name');
      if (name && !parentStep.options.some(o => o.name === name.value)) {
        add(valueRange(name), `Step <${parent!.name}> has no option "${name.value}".`, 'error', 'XS0031');
      }
    }
    if (el.local === 'with-param' && parentStep) {
      const port = getAttrNode(el, 'port');
      if (port && !parentStep.ports.some(p => p.parameter && p.port === port.value)) {
        add(valueRange(port), `Step <${parent!.name}> has no parameter input port "${port.value}".`, 'error', 'XS0034');
      }
    }

    if (el.local === 'pipe') {
      const step = getAttrNode(el, 'step');
      const port = getAttrNode(el, 'port');
      if (step) {
        checkStepRef(el, step, step.value, port?.value, port);
      }
    }
    const pipeAttr = isV3(v) ? getAttrNode(el, 'pipe') : undefined;
    if (pipeAttr) {
      for (const m of pipeAttr.value.matchAll(/\S+/g)) {
        const tok = m[0];
        const at = tok.indexOf('@');
        if (at >= 0) {
          const start = pipeAttr.valueStart + (pipeAttr.rawValue === pipeAttr.value ? m.index! : 0);
          checkStepRef(el, pipeAttr, tok.substring(at + 1), at > 0 ? tok.substring(0, at) : undefined, undefined, [start, start + tok.length]);
        }
      }
    }
  }

  function checkStepRef(from: XElement, attr: XAttr, stepName: string, port: string | undefined, portAttr?: XAttr, range?: [number, number]) {
    if (/[{}]/.test(stepName)) {
      return;
    }
    const target = findStep(from, stepName);
    if (!target) {
      add(range ?? valueRange(attr), `There is no step named "${stepName}" in scope.`, 'error', 'XS0022');
      return;
    }
    if (port) {
      const ports = readablePorts(model, target, from);
      if (ports && !ports.includes(port)) {
        add(range ?? (portAttr ? valueRange(portAttr) : valueRange(attr)),
          `Step "${stepName}" has no readable port "${port}"${ports.length ? ` (available: ${ports.map(p => `"${p}"`).join(', ')})` : ''}.`, 'error', 'XS0022');
      }
    }
  }

  function checkStep(el: XElement, def: StepDef) {
    const allowed = new Set([...stepAttrs(v).map(a => a.name), ...def.options.map(o => o.name)]);
    const label = `<${el.name}>`;
    checkAttributes(el, allowed, a => [`Step ${label} has no option "${a.name}".`, 'XS0031']);
    for (const o of def.options) {
      if (!o.required) {
        continue;
      }
      const viaAttr = getAttrNode(el, o.name);
      const viaChild = el.children.some(c => isXProc(c, 'with-option') && getAttr(c, 'name') === o.name);
      if (!viaAttr && !viaChild) {
        add(nameRange(el), `Required option "${o.name}" of step ${label} is not set.`, 'error', 'XS0018');
      }
    }
    for (const o of def.options) {
      const a = getAttrNode(el, o.name);
      if (a && o.values && !/[{}]/.test(a.value) && !o.values.includes(a.value.trim())) {
        add(valueRange(a), `Invalid value "${a.value}" for option "${o.name}" (expected ${o.values.map(x => `"${x}"`).join(', ')}).`, isV3(v) ? 'warning' : 'error');
      }
    }
    const allowedChildren = atomicStepChildren(v);
    for (const c of el.children) {
      if (c.ns === XPROC_NS && !allowedChildren.includes(c.local) && c.local !== 'documentation' && c.local !== 'pipeinfo' && (coreElement(v, c.local) || lookupStep(model, c.ns, c.local))) {
        add(nameRange(c), `<${c.name}> is not allowed as a child of step ${label}.`, 'error', 'XS0044');
      }
    }
    if (isV3(v)) {
      const seen = new Map<string, XElement>();
      for (const c of el.children) {
        if (!isXProc(c, 'with-input')) {
          continue;
        }
        const port = getAttr(c, 'port') ?? def.ports.find(p => p.input && p.primary)?.port;
        if (!port) {
          continue;
        }
        if (seen.has(port)) {
          add(nameRange(c), `Input port "${port}" of step ${label} is connected more than once.`, 'error', 'XS0011');
        }
        seen.set(port, c);
      }
    }
  }

  function checkDuplicateNames(rootEl: XElement) {
    const isNamedStep = (e: XElement) => getAttr(e, 'name') !== undefined && !(isXProc(e) && NON_STEP_NAMED.has(e.local))
      && !(isXProc(e) && ['input', 'output', 'import'].includes(e.local));
    for (const el of walk(rootEl)) {
      if (!isNamedStep(el) || isInsideAnyContent(el)) {
        continue;
      }
      const name = getAttr(el, 'name')!;
      const a = getAttrNode(el, 'name')!;
      // clash with a preceding sibling
      const siblings = el.parent ? el.parent.children : [];
      const dup = siblings.find(s => s !== el && s.start < el.start && isNamedStep(s) && getAttr(s, 'name') === name);
      if (dup) {
        add(valueRange(a), `Duplicate step name "${name}".`, 'error', 'XS0002');
        continue;
      }
      // clash with an ancestor within the same pipeline
      for (let p = el.parent; p; p = p.parent) {
        if (isNamedStep(p) && getAttr(p, 'name') === name && !(isXProc(el, 'declare-step') || isXProc(el, 'pipeline'))) {
          add(valueRange(a), `Step name "${name}" is already used by an ancestor step.`, 'error', 'XS0002');
          break;
        }
        if (isXProc(p, 'declare-step') || isXProc(p, 'pipeline')) {
          break;
        }
      }
    }
  }
}
