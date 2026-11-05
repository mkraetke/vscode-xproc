import type { XElement } from '../xml/parser';
import type { ItemKind } from '../xproc/completion';

export const SCH_NS = 'http://purl.oclc.org/dsdl/schematron';
export const RNG_NS = 'http://relaxng.org/ns/structure/1.0';
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema';

export interface VocabAttrDef {
  name: string;
  required?: boolean;
  values?: string[];
  doc?: string;
}

export interface VocabElementDef {
  local: string;
  doc: string;
  attrs: VocabAttrDef[];
  /** allowed children in the namespace of the vocabulary */
  children: string[];
  /** form of the snippet: empty element, content on one line or content on its own lines */
  form: 'empty' | 'inline' | 'block';
  /** attributes included in the snippet (default: the required ones) */
  snippetAttrs?: string[];
  /** content of block snippets; pf is the prefix including the colon */
  body?: (pf: string) => string;
  /** shown in the completion detail, e.g. "XSD 1.1" */
  note?: string;
}

export interface RootDef {
  local: string;
  /** appended to the label if there are several variants of a root element, e.g. "XSD 1.1" */
  variant?: string;
  detail: string;
  /** attributes of the snippet (after the namespace declaration) */
  attrs: string;
  /** content of the snippet; pf is the prefix including the colon */
  body?: (pf: string) => string;
  /** extra namespace declarations: prefix → URI */
  namespaces?: [string, string][];
}

export interface ValueContext {
  /** element in the document prefix */
  el: XElement;
  /** counterpart of el in the complete document (el itself if there is none) */
  full: XElement;
  /** outermost element of the schema in the complete document */
  root: XElement;
  attr: string;
  add(label: string, detail?: string, kind?: ItemKind): void;
}

export interface Vocabulary {
  ns: string;
  /** e.g. "ISO Schematron" */
  name: string;
  /** prefix used if the namespace is not declared ('' for the default namespace) */
  prefix: string;
  elements: VocabElementDef[];
  roots: RootDef[];
  /** extensions of schema files, for the href of the schema port */
  extensions: string[];
  specUrl: string;
  /** attributes allowed on all elements */
  commonAttrs?: VocabAttrDef[];
  /** attributes whose value is a whitespace-separated list */
  tokenLists?: Set<string>;
  /** context-dependent children (default: the children of the element definition) */
  children?(el: XElement): string[] | undefined;
  values?(c: ValueContext): void;
  /** variables that can be referenced with $name in attribute values of el */
  variables?(c: ValueContext): { name: string; detail: string }[];
}

export const a = (name: string, opts: Omit<VocabAttrDef, 'name'> = {}): VocabAttrDef => ({ name, ...opts });
export const req = (name: string, opts: Omit<VocabAttrDef, 'name' | 'required'> = {}): VocabAttrDef => ({ name, required: true, ...opts });

export function* descendants(el: XElement): Generator<XElement> {
  for (const c of el.children) {
    yield c;
    yield* descendants(c);
  }
}

/** values of attribute attr of the elements ns:local below root */
export function namesOf(root: XElement, ns: string, local: string, attr: string, filter: (e: XElement) => boolean = () => true): string[] {
  const result: string[] = [];
  for (const e of descendants(root)) {
    const v = e.ns === ns && e.local === local && filter(e) ? e.attrs.find(x => x.name === attr)?.value.trim() : undefined;
    if (v && !result.includes(v)) {
      result.push(v);
    }
  }
  return result;
}
