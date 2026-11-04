import * as fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { getAttr, parseXml, XElement, XmlDocument } from '../xml/parser';
import { CatalogResolver } from './catalog';
import { mtimeOf } from './fsCache';
import { builtinStep, coreElement } from './core';
import { clark, CX_NS, OptionDef, PortDef, StepDef, XPROC_NS, XProcVersion } from './types';
import { XSL_NS } from '../xslt/schema';

export interface ImportInfo {
  el: XElement;
  href: string;
  /** resolved file URL */
  resolved?: string;
  error?: string;
  /** import of a processor-provided library (resolved internally by XML Calabash) */
  builtin?: boolean;
}

export interface XProcModel {
  uri: string;
  doc: XmlDocument;
  root?: XElement;
  isXProc: boolean;
  version: XProcVersion;
  versionAttr?: string;
  /** steps declared in the document or in imported libraries */
  steps: Map<string, StepDef>;
  imports: ImportInfo[];
  /** false if at least one import could not be loaded (step declarations may be missing) */
  importsComplete: boolean;
}

export interface AnalyzeOptions {
  defaultVersion: XProcVersion;
  catalogs: string[];
}

const SKIP_CONTENT = new Set(['inline', 'documentation', 'pipeinfo']);

export function isXProc(el: XElement | undefined, local?: string): boolean {
  return !!el && el.ns === XPROC_NS && (local === undefined || el.local === local);
}

export function detectVersion(root: XElement | undefined, defaultVersion: XProcVersion): XProcVersion {
  const v = getAttr(root, 'version')?.trim();
  if (v === '1.0' || v === '3.0' || v === '3.1') {
    return v;
  }
  if (v && v.startsWith('3')) {
    return '3.1';
  }
  if (isXProc(root, 'pipeline')) {
    return '1.0';
  }
  return defaultVersion;
}

/** Iterates over all elements below el, skipping the content of p:inline, p:documentation, p:pipeinfo and of (implicitly inlined) stylesheets. */
export function* walk(el: XElement): Generator<XElement> {
  yield el;
  if ((isXProc(el) && SKIP_CONTENT.has(el.local)) || el.ns === XSL_NS) {
    return;
  }
  for (const c of el.children) {
    yield* walk(c);
  }
}

export function isInsideAnyContent(el: XElement | undefined): boolean {
  for (let p = el?.parent; p; p = p.parent) {
    if ((isXProc(p) && SKIP_CONTENT.has(p.local)) || p.ns === XSL_NS) {
      return true;
    }
  }
  return false;
}

function parseValues(values: string | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }
  const result: string[] = [];
  const re = /'([^']*)'|"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(values))) {
    result.push(m[1] ?? m[2]);
  }
  return result.length ? result : undefined;
}

function bool(v: string | undefined): boolean | undefined {
  return v === undefined ? undefined : v.trim() === 'true';
}

/** Builds the signature of a p:declare-step / p:pipeline. */
export function signatureOf(el: XElement, version: XProcVersion): { ports: PortDef[]; options: OptionDef[] } {
  const ports: PortDef[] = [];
  const options: OptionDef[] = [];
  if (isXProc(el, 'pipeline')) {
    ports.push({ port: 'source', input: true, primary: true, sequence: false });
    ports.push({ port: 'parameters', input: true, primary: true, sequence: false, parameter: true });
    ports.push({ port: 'result', input: false, primary: true, sequence: false });
  }
  for (const c of el.children) {
    if (!isXProc(c)) {
      continue;
    }
    if (c.local === 'input' || c.local === 'output') {
      const port = getAttr(c, 'port');
      if (!port) {
        continue;
      }
      const parameter = c.local === 'input' && getAttr(c, 'kind') === 'parameter';
      ports.push({
        port,
        input: c.local === 'input',
        primary: bool(getAttr(c, 'primary')) ?? false,
        sequence: bool(getAttr(c, 'sequence')) ?? false,
        parameter: parameter || undefined,
        hasDefault: c.local === 'input' && (c.children.length > 0 || getAttr(c, 'href') !== undefined) || undefined,
      });
    } else if (c.local === 'option') {
      const name = getAttr(c, 'name');
      if (name) {
        options.push({
          name,
          required: bool(getAttr(c, 'required')),
          select: getAttr(c, 'select'),
          as: getAttr(c, 'as'),
          values: parseValues(getAttr(c, 'values')),
          doc: docText(c),
        });
      }
    }
  }
  // a single input/output port is primary unless explicitly declared otherwise
  for (const input of [true, false]) {
    const candidates = ports.filter(p => p.input === input && !p.parameter);
    if (candidates.length === 1) {
      const decl = el.children.find(c => isXProc(c) && c.local === (input ? 'input' : 'output') && getAttr(c, 'port') === candidates[0].port);
      if (!decl || getAttr(decl, 'primary') === undefined) {
        candidates[0].primary = true;
      }
    }
  }
  if (version === '1.0') {
    const params = ports.filter(p => p.parameter);
    if (params.length === 1 && params[0].primary === false) {
      const decl = el.children.find(c => isXProc(c, 'input') && getAttr(c, 'port') === params[0].port);
      if (decl && getAttr(decl, 'primary') === undefined) {
        params[0].primary = true;
      }
    }
  }
  return { ports, options };
}

function docText(el: XElement): string | undefined {
  const d = el.children.find(c => isXProc(c, 'documentation'));
  if (!d) {
    return undefined;
  }
  const collect = (e: XElement): string => e.text + e.children.map(collect).join(' ');
  const t = collect(d).replace(/\s+/g, ' ').trim();
  return t || undefined;
}

function stepFromDeclaration(el: XElement, uri: string, version: XProcVersion): StepDef | undefined {
  const type = getAttr(el, 'type');
  if (!type) {
    return undefined;
  }
  const i = type.indexOf(':');
  const prefix = i < 0 ? '' : type.substring(0, i);
  const local = type.substring(i + 1).trim();
  const ns = el.nsMap.get(prefix) ?? '';
  const sig = signatureOf(el, version);
  return {
    ns, local, prefix,
    ports: sig.ports,
    options: sig.options,
    doc: docText(el),
    group: uri,
    declaredIn: { uri, start: el.start, end: el.startTagEnd },
  };
}

function collectDeclarations(root: XElement, uri: string, version: XProcVersion, into: Map<string, StepDef>, exportedOnly: boolean) {
  for (const el of walk(root)) {
    if (isXProc(el, 'declare-step') || isXProc(el, 'pipeline')) {
      if (exportedOnly && getAttr(el, 'visibility') === 'private') {
        continue;
      }
      const s = stepFromDeclaration(el, uri, version);
      if (s) {
        const key = clark(s.ns, s.local);
        if (!into.has(key)) {
          into.set(key, s);
        }
      }
    }
  }
}

function collectImportElements(root: XElement): XElement[] {
  const result: XElement[] = [];
  for (const el of walk(root)) {
    if (isXProc(el, 'import')) {
      result.push(el);
    }
  }
  return result;
}

interface LibraryCacheEntry {
  mtime: number;
  doc: XmlDocument;
}
const libraryCache = new Map<string, LibraryCacheEntry>();

function loadFile(path: string): XmlDocument | undefined {
  const mtime = mtimeOf(path);
  if (mtime === undefined) {
    return undefined;
  }
  const cached = libraryCache.get(path);
  if (cached && cached.mtime === mtime) {
    return cached.doc;
  }
  const doc = parseXml(fs.readFileSync(path, 'utf8'));
  libraryCache.set(path, { mtime, doc });
  return doc;
}

export function isProcessorLibrary(href: string): boolean {
  return /^https?:\/\/(www\.)?xmlcalabash\.com\//.test(href);
}

export function resolveHref(href: string, baseUri: string, resolver: CatalogResolver): string {
  const viaCatalog = resolver.resolve(href);
  if (viaCatalog) {
    return viaCatalog;
  }
  try {
    return new URL(href, baseUri).href;
  } catch {
    return href;
  }
}

function resolveImport(el: XElement, baseUri: string, resolver: CatalogResolver): ImportInfo {
  const href = (getAttr(el, 'href') ?? '').trim();
  const info: ImportInfo = { el, href };
  if (!href) {
    info.error = 'p:import without href';
    return info;
  }
  const xmlBase = getAttr(el, 'xml:base');
  if (xmlBase) {
    try {
      baseUri = new URL(xmlBase, baseUri).href;
    } catch {
      // ignore
    }
  }
  const resolved = resolveHref(href, baseUri, resolver);
  if (isProcessorLibrary(resolved)) {
    info.builtin = true;
    info.resolved = resolved;
    return info;
  }
  if (!resolved.startsWith('file:')) {
    info.error = `Cannot resolve "${href}" (not a local file and not mapped by an XML catalog)`;
    return info;
  }
  info.resolved = resolved;
  try {
    if (mtimeOf(fileURLToPath(resolved)) === undefined) {
      info.error = resolved === new URL(href, baseUri).href
        ? `Imported file not found: ${fileURLToPath(resolved)}`
        : `Imported file not found: ${fileURLToPath(resolved)} (resolved from "${href}" via XML catalog)`;
    }
  } catch (e) {
    info.error = `Cannot resolve "${href}": ${e}`;
  }
  return info;
}

function loadLibrarySteps(fileUrl: string, version: XProcVersion, resolver: CatalogResolver, into: Map<string, StepDef>, visited: Set<string>): boolean {
  if (visited.has(fileUrl)) {
    return true;
  }
  visited.add(fileUrl);
  let doc: XmlDocument | undefined;
  try {
    doc = loadFile(fileURLToPath(fileUrl));
  } catch {
    return false;
  }
  if (!doc?.root) {
    return false;
  }
  let complete = true;
  const libVersion = detectVersion(doc.root, version);
  collectDeclarations(doc.root, fileUrl, libVersion, into, true);
  for (const imp of collectImportElements(doc.root)) {
    const info = resolveImport(imp, fileUrl, resolver);
    if (info.builtin) {
      continue;
    }
    if (info.error || !info.resolved) {
      complete = false;
      continue;
    }
    complete = loadLibrarySteps(info.resolved, libVersion, resolver, into, visited) && complete;
  }
  return complete;
}

export function analyze(text: string, uri: string, options: AnalyzeOptions): XProcModel {
  const doc = parseXml(text);
  const root = doc.root ?? doc.partial?.element ?? doc.openStack[0];
  const version = detectVersion(root, options.defaultVersion);
  const model: XProcModel = {
    uri, doc, root,
    isXProc: isXProc(root),
    version,
    versionAttr: getAttr(root, 'version'),
    steps: new Map(),
    imports: [],
    importsComplete: true,
  };
  if (!doc.root || !model.isXProc) {
    return model;
  }
  collectDeclarations(doc.root, uri, version, model.steps, false);
  const resolver = new CatalogResolver(options.catalogs);
  const visited = new Set<string>([uri]);
  for (const imp of collectImportElements(doc.root)) {
    const info = resolveImport(imp, uri, resolver);
    model.imports.push(info);
    if (info.builtin) {
      continue;
    }
    if (info.error || !info.resolved) {
      model.importsComplete = false;
      continue;
    }
    if (!loadLibrarySteps(info.resolved, version, resolver, model.steps, visited)) {
      model.importsComplete = false;
      if (!info.error) {
        info.error = `Could not load all step declarations from "${info.href}"`;
      }
    }
  }
  return model;
}

/** Looks up a step declaration: user-declared steps first, then the built-in library. */
export function lookupStep(model: XProcModel, ns: string, local: string): StepDef | undefined {
  return model.steps.get(clark(ns, local)) ?? builtinStep(model.version, ns, local);
}

/** Classifies an element in a pipeline. */
export type ElementKind = 'core' | 'step' | 'unknown-step' | 'foreign' | 'unknown-xproc';

export function classify(model: XProcModel, el: XElement): ElementKind {
  if (el.ns === XPROC_NS) {
    if (coreElement(model.version, el.local)) {
      return 'core';
    }
    return lookupStep(model, el.ns, el.local) ? 'step' : 'unknown-xproc';
  }
  if (lookupStep(model, el.ns, el.local)) {
    return 'step';
  }
  const parentDef = el.parent && el.parent.ns === XPROC_NS ? coreElement(model.version, el.parent.local) : undefined;
  if (parentDef?.steps) {
    return 'unknown-step';
  }
  return 'foreign';
}

export function isExtensionNamespace(ns: string): boolean {
  return ns === CX_NS || ns.startsWith('http://exproc.org/') || ns.startsWith('http://xmlcalabash.com/') || ns.startsWith('https://xmlcalabash.com/');
}

/** Ports a p:pipe may read from a step (or container) with the given name. */
export function readablePorts(model: XProcModel, target: XElement, from: XElement): string[] | undefined {
  let isAncestor = false;
  for (let p = from.parent; p; p = p.parent) {
    if (p === target) {
      isAncestor = true;
      break;
    }
  }
  if (target.ns === XPROC_NS) {
    const local = target.local;
    if (isAncestor) {
      if (local === 'declare-step' || local === 'pipeline') {
        return signatureOf(target, model.version).ports.filter(p => p.input).map(p => p.port);
      }
      if (local === 'for-each' || local === 'viewport') {
        return ['current'];
      }
      if (local === 'catch' || local === 'finally') {
        return ['error'];
      }
      return undefined;
    }
    if (coreElement(model.version, local)) {
      const outs = target.children.filter(c => isXProc(c, 'output')).map(c => getAttr(c, 'port')).filter((p): p is string => !!p);
      if (local === 'viewport') {
        return outs.length ? outs : ['result'];
      }
      if (local === 'pipeline' || local === 'choose' || local === 'try' || !outs.length) {
        return undefined; // outputs are declared in the branches, or implicit
      }
      return outs;
    }
  }
  const def = lookupStep(model, target.ns, target.local);
  return def ? def.ports.filter(p => !p.input).map(p => p.port) : undefined;
}

/** All named steps that are in scope for a reference from el (siblings of ancestors and their descendants). */
export function stepsInScope(el: XElement): XElement[] {
  // find the enclosing pipeline
  let pipeline: XElement | undefined = el;
  while (pipeline && !(isXProc(pipeline, 'declare-step') || isXProc(pipeline, 'pipeline'))) {
    pipeline = pipeline.parent;
  }
  if (!pipeline) {
    return [];
  }
  const result: XElement[] = [];
  const visit = (e: XElement) => {
    if (getAttr(e, 'name') !== undefined && !(isXProc(e) && ['option', 'variable', 'with-option', 'with-param', 'run-option'].includes(e.local))) {
      result.push(e);
    }
    if (isXProc(e) && SKIP_CONTENT.has(e.local)) {
      return;
    }
    for (const c of e.children) {
      if (isXProc(c, 'declare-step') || isXProc(c, 'pipeline')) {
        continue;
      }
      visit(c);
    }
  };
  visit(pipeline);
  return result;
}

/** Resolves a step name referenced from el: the nearest ancestor with that name, otherwise any step in scope. */
export function findStep(el: XElement, name: string): XElement | undefined {
  for (let p = el.parent; p; p = p.parent) {
    if (getAttr(p, 'name') === name && !(isXProc(p) && NON_STEP_NAMED.has(p.local))) {
      return p;
    }
  }
  return stepsInScope(el).find(s => getAttr(s, 'name') === name);
}

const NON_STEP_NAMED = new Set(['option', 'variable', 'with-option', 'with-param', 'run-option']);

export function fileUrl(path: string): string {
  return pathToFileURL(path).href;
}
