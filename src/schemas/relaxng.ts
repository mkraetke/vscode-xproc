import { getAttr, XElement } from '../xml/parser';
import { a, namesOf, req, RNG_NS, Vocabulary } from './types';
import { XSD_TYPES } from './xmlschema';

const XSD_DATATYPES = 'http://www.w3.org/2001/XMLSchema-datatypes';
const PATTERNS = ['element', 'attribute', 'group', 'interleave', 'choice', 'optional', 'zeroOrMore', 'oneOrMore', 'list', 'mixed', 'ref', 'parentRef',
  'empty', 'text', 'value', 'data', 'notAllowed', 'externalRef', 'grammar'];
const NAME_CLASSES = ['name', 'anyName', 'nsName', 'choice'];
const GRAMMAR = ['start', 'define', 'div', 'include'];
const FACETS = ['length', 'minLength', 'maxLength', 'pattern', 'enumeration', 'whiteSpace', 'minInclusive', 'minExclusive', 'maxInclusive',
  'maxExclusive', 'totalDigits', 'fractionDigits'];
const COMBINE = ['choice', 'interleave'];

const isRng = (el: XElement | undefined, ...locals: string[]) => !!el && el.ns === RNG_NS && locals.includes(el.local);

/** true if el (choice or except) contains name classes instead of patterns */
function inNameClass(el: XElement): boolean {
  const parent = el.parent;
  if (isRng(el, 'except')) {
    return isRng(parent, 'anyName', 'nsName');
  }
  if (!isRng(el, 'choice') || !parent) {
    return false;
  }
  if (isRng(parent, 'choice', 'except')) {
    return inNameClass(parent);
  }
  // the first child of an element or attribute without a name attribute is its name class
  return isRng(parent, 'element', 'attribute') && getAttr(parent, 'name') === undefined && parent.children.find(c => c.ns === RNG_NS) === el;
}

function datatypeLibrary(el: XElement): string {
  for (let e: XElement | undefined = el; e; e = e.parent) {
    const lib = e.ns === RNG_NS ? getAttr(e, 'datatypeLibrary') : undefined;
    if (lib !== undefined) {
      return lib;
    }
  }
  return '';
}

export const RELAXNG: Vocabulary = {
  ns: RNG_NS,
  name: 'RELAX NG',
  prefix: '',
  extensions: ['rng', 'rnc'],
  specUrl: 'https://relaxng.org/spec-20011203.html',
  commonAttrs: [a('ns'), a('datatypeLibrary', { values: [XSD_DATATYPES] })],
  roots: [
    {
      local: 'grammar', detail: 'RELAX NG grammar', attrs: ` datatypeLibrary="${XSD_DATATYPES}"`,
      body: pf => `<${pf}start>\n\t\t$0\n\t</${pf}start>`,
    },
    { local: 'element', detail: 'RELAX NG element pattern', attrs: ' name="${1}"' },
  ],
  elements: [
    { local: 'grammar', form: 'block', doc: 'A grammar: a `start` pattern and named pattern definitions (`define`).', attrs: [], children: GRAMMAR },
    { local: 'start', form: 'block', doc: 'The start pattern of the grammar (the pattern of the document element).', attrs: [a('combine', { values: COMBINE })], children: PATTERNS },
    { local: 'define', form: 'block', doc: 'Defines a named pattern that can be referenced with `ref`.', attrs: [req('name'), a('combine', { values: COMBINE })], children: PATTERNS },
    { local: 'div', form: 'block', doc: 'Groups definitions of a grammar (e.g. for documentation).', attrs: [], children: GRAMMAR },
    { local: 'include', form: 'empty', doc: 'Includes the definitions of another grammar; the content overrides definitions of the included grammar.', attrs: [req('href')], children: ['start', 'define', 'div'] },
    { local: 'element', form: 'block', doc: 'Matches an element with the given name (or name class) whose content matches the content patterns.', attrs: [a('name')], children: [...NAME_CLASSES, ...PATTERNS], snippetAttrs: ['name'] },
    { local: 'attribute', form: 'block', doc: 'Matches an attribute with the given name (or name class). Without content, the value is `text`.', attrs: [a('name')], children: [...NAME_CLASSES, ...PATTERNS], snippetAttrs: ['name'] },
    { local: 'group', form: 'block', doc: 'Matches the content patterns in order.', attrs: [], children: PATTERNS },
    { local: 'interleave', form: 'block', doc: 'Matches the content patterns in any order (interleaved).', attrs: [], children: PATTERNS },
    { local: 'choice', form: 'block', doc: 'Matches one of the content patterns (or name classes).', attrs: [], children: PATTERNS },
    { local: 'optional', form: 'block', doc: 'Matches the content patterns or nothing.', attrs: [], children: PATTERNS },
    { local: 'zeroOrMore', form: 'block', doc: 'Matches the content patterns zero or more times.', attrs: [], children: PATTERNS },
    { local: 'oneOrMore', form: 'block', doc: 'Matches the content patterns one or more times.', attrs: [], children: PATTERNS },
    { local: 'list', form: 'block', doc: 'Matches a whitespace-separated list of tokens against the content patterns.', attrs: [], children: PATTERNS },
    { local: 'mixed', form: 'block', doc: 'Matches the content patterns interleaved with text.', attrs: [], children: PATTERNS },
    { local: 'ref', form: 'empty', doc: 'References a pattern defined with `define` in the current grammar.', attrs: [req('name')], children: [] },
    { local: 'parentRef', form: 'empty', doc: 'References a pattern defined in the parent grammar.', attrs: [req('name')], children: [] },
    { local: 'externalRef', form: 'empty', doc: 'References the pattern of an external grammar.', attrs: [req('href')], children: [] },
    { local: 'empty', form: 'empty', doc: 'Matches empty content.', attrs: [], children: [] },
    { local: 'text', form: 'empty', doc: 'Matches any text (zero or more text nodes).', attrs: [], children: [] },
    { local: 'notAllowed', form: 'empty', doc: 'Matches nothing.', attrs: [], children: [] },
    { local: 'value', form: 'inline', doc: 'Matches a value of a datatype (default: `token`).', attrs: [a('type')], children: [] },
    { local: 'data', form: 'empty', doc: 'Matches a value of a datatype, optionally restricted by `param`s and an `except` pattern.', attrs: [req('type')], children: ['param', 'except'] },
    { local: 'param', form: 'inline', doc: 'A datatype parameter (facet) of `data`.', attrs: [req('name')], children: [] },
    { local: 'except', form: 'block', doc: 'Excludes values (in `data`) or names (in `anyName` and `nsName`).', attrs: [], children: PATTERNS },
    { local: 'name', form: 'inline', doc: 'A name class matching a single (qualified) name.', attrs: [], children: [] },
    { local: 'anyName', form: 'empty', doc: 'A name class matching any name, optionally with an `except` name class.', attrs: [], children: ['except'] },
    { local: 'nsName', form: 'empty', doc: 'A name class matching any name in a namespace (`ns`), optionally with an `except` name class.', attrs: [], children: ['except'] },
  ],

  children(el) {
    if (isRng(el, 'choice', 'except') && inNameClass(el)) {
      return NAME_CLASSES;
    }
    if (isRng(el, 'except') && isRng(el.parent, 'data')) {
      return ['value', 'data', 'choice'];
    }
    if (isRng(el, 'element', 'attribute') && (getAttr(el, 'name') !== undefined || el.children.some(c => c.ns === RNG_NS))) {
      return PATTERNS;
    }
    return undefined;
  },

  values({ el, attr, root, add }) {
    if (attr === 'name' && isRng(el, 'ref', 'parentRef')) {
      namesOf(root, RNG_NS, 'define', 'name').forEach(n => add(n, 'definition', 'stepName'));
    } else if (attr === 'type' && isRng(el, 'data', 'value')) {
      if (datatypeLibrary(el) === XSD_DATATYPES) {
        XSD_TYPES.forEach(t => add(t, 'XML Schema datatype'));
      } else {
        ['string', 'token'].forEach(t => add(t, 'built-in datatype'));
      }
    } else if (attr === 'name' && isRng(el, 'param')) {
      FACETS.forEach(f => add(f, 'facet'));
    } else if (attr === 'ns') {
      for (const [p, ns] of el.nsMap) {
        if (p !== 'xml' && ns !== RNG_NS) {
          add(ns, p || 'default namespace', 'namespace');
        }
      }
    }
  },
};
