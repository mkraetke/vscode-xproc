import { getAttr, XElement } from '../xml/parser';
import { a, descendants, req, VocabAttrDef, VocabElementDef, Vocabulary, XSD_NS } from './types';

const VC_NS = 'http://www.w3.org/2007/XMLSchema-versioning';

/** built-in datatypes (unprefixed) */
export const XSD_TYPES = ['string', 'boolean', 'decimal', 'integer', 'int', 'long', 'short', 'byte', 'double', 'float', 'date', 'dateTime', 'time',
  'duration', 'anyURI', 'QName', 'token', 'normalizedString', 'language', 'Name', 'NCName', 'ID', 'IDREF', 'IDREFS', 'ENTITY', 'ENTITIES', 'NMTOKEN',
  'NMTOKENS', 'NOTATION', 'positiveInteger', 'nonNegativeInteger', 'negativeInteger', 'nonPositiveInteger', 'unsignedLong', 'unsignedInt',
  'unsignedShort', 'unsignedByte', 'base64Binary', 'hexBinary', 'gYear', 'gYearMonth', 'gMonth', 'gMonthDay', 'gDay', 'dateTimeStamp',
  'dayTimeDuration', 'yearMonthDuration', 'anyAtomicType', 'anySimpleType'];

const TF = ['true', 'false'];
const FORM = ['qualified', 'unqualified'];
const DERIVATION = ['#all', 'extension', 'restriction'];
const PROCESS = ['strict', 'lax', 'skip'];
const WILDCARD_NS = ['##any', '##other', '##local', '##targetNamespace'];
const OCCURS = [a('minOccurs', { values: ['0', '1'] }), a('maxOccurs', { values: ['1', 'unbounded'] })];
const ID = a('id');
const FACETS = ['enumeration', 'pattern', 'minInclusive', 'minExclusive', 'maxInclusive', 'maxExclusive', 'length', 'minLength', 'maxLength',
  'totalDigits', 'fractionDigits', 'whiteSpace', 'assertion', 'explicitTimezone'];
const PARTICLES = ['group', 'all', 'choice', 'sequence'];
const ATTRS = ['attribute', 'attributeGroup', 'anyAttribute'];
const TOP = ['include', 'import', 'redefine', 'override', 'annotation', 'defaultOpenContent', 'element', 'attribute', 'complexType', 'simpleType', 'group',
  'attributeGroup', 'notation'];

const facet = (local: string, doc: string, attrs: VocabAttrDef[] = [req('value'), a('fixed', { values: TF })], note?: string): VocabElementDef =>
  ({ local, doc, form: 'empty', attrs: [...attrs, ID], children: ['annotation'], note });

const keyBody = (n: number) => (pf: string) => `<${pf}selector xpath="\${${n}}"/>\n\t<${pf}field xpath="\${${n + 1}}"/>`;

const isXs = (el: XElement | undefined, ...locals: string[]) => !!el && el.ns === XSD_NS && locals.includes(el.local);

function schemaVersion(root: XElement): string {
  return root.attrs.find(x => x.ns === VC_NS && x.local === 'minVersion')?.value ?? '1.0';
}

export const XMLSCHEMA: Vocabulary = {
  ns: XSD_NS,
  name: 'XML Schema',
  prefix: 'xs',
  extensions: ['xsd'],
  specUrl: 'https://www.w3.org/TR/xmlschema11-1/',
  tokenLists: new Set(['memberTypes', 'namespace', 'notNamespace', 'notQName', 'blockDefault', 'finalDefault', 'block', 'final']),
  roots: [
    { local: 'schema', variant: 'XSD 1.0', detail: 'XML Schema 1.0', attrs: ' elementFormDefault="qualified"' },
    {
      local: 'schema', variant: 'XSD 1.1', detail: 'XML Schema 1.1', attrs: ' elementFormDefault="qualified" vc:minVersion="1.1"',
      namespaces: [['vc', VC_NS]],
    },
  ],
  elements: [
    {
      local: 'schema', form: 'block', doc: 'The root element of an XML Schema document.',
      attrs: [a('targetNamespace'), a('elementFormDefault', { values: FORM }), a('attributeFormDefault', { values: FORM }), a('version'),
        a('blockDefault', { values: [...DERIVATION, 'substitution'] }), a('finalDefault', { values: [...DERIVATION, 'list', 'union'] }), a('defaultAttributes'),
        a('xpathDefaultNamespace', { values: ['##defaultNamespace', '##targetNamespace', '##local'] }), a('xml:lang'), ID],
      children: TOP,
    },
    { local: 'include', form: 'empty', doc: 'Includes a schema document with the same target namespace (or none).', attrs: [req('schemaLocation'), ID], children: ['annotation'] },
    { local: 'import', form: 'empty', doc: 'Imports the components of another target namespace.', attrs: [a('namespace'), a('schemaLocation'), ID], children: ['annotation'], snippetAttrs: ['namespace', 'schemaLocation'] },
    { local: 'redefine', form: 'block', doc: 'Includes a schema document and redefines some of its components (deprecated in XSD 1.1, use xs:override).', attrs: [req('schemaLocation'), ID], children: ['annotation', 'simpleType', 'complexType', 'group', 'attributeGroup'] },
    { local: 'override', form: 'block', doc: 'Includes a schema document and replaces some of its components.', attrs: [req('schemaLocation'), ID], children: TOP.filter(x => !['include', 'import', 'redefine', 'override', 'defaultOpenContent'].includes(x)), note: 'XSD 1.1' },
    { local: 'annotation', form: 'block', doc: 'Documentation (`xs:documentation`) and application information (`xs:appinfo`).', attrs: [ID], children: ['documentation', 'appinfo'] },
    { local: 'documentation', form: 'inline', doc: 'Human-readable documentation (any content).', attrs: [a('source'), a('xml:lang')], children: [] },
    { local: 'appinfo', form: 'block', doc: 'Information for applications (any content).', attrs: [a('source')], children: [] },
    {
      local: 'element', form: 'empty', doc: 'Declares an element (global as a child of xs:schema, local otherwise) or references a global element (`ref`).',
      attrs: [a('name'), a('type'), a('ref'), ...OCCURS, a('default'), a('fixed'), a('nillable', { values: TF }), a('abstract', { values: TF }),
        a('substitutionGroup'), a('form', { values: FORM }), a('block', { values: [...DERIVATION, 'substitution'] }), a('final', { values: DERIVATION }),
        a('targetNamespace'), ID],
      children: ['annotation', 'simpleType', 'complexType', 'alternative', 'unique', 'key', 'keyref'], snippetAttrs: ['name', 'type'],
    },
    {
      local: 'attribute', form: 'empty', doc: 'Declares an attribute or references a global attribute (`ref`).',
      attrs: [a('name'), a('type'), a('ref'), a('use', { values: ['optional', 'required', 'prohibited'] }), a('default'), a('fixed'), a('form', { values: FORM }),
        a('inheritable', { values: TF }), a('targetNamespace'), ID],
      children: ['annotation', 'simpleType'], snippetAttrs: ['name', 'type'],
    },
    {
      local: 'complexType', form: 'block', doc: 'Defines a complex type: content model (elements) and attributes.',
      attrs: [a('name'), a('mixed', { values: TF }), a('abstract', { values: TF }), a('block', { values: DERIVATION }), a('final', { values: DERIVATION }),
        a('defaultAttributesApply', { values: TF }), ID],
      children: ['annotation', 'simpleContent', 'complexContent', 'openContent', ...PARTICLES, ...ATTRS, 'assert'], snippetAttrs: [],
      body: pf => `<${pf}sequence>\n\t\t$0\n\t</${pf}sequence>`,
    },
    {
      local: 'simpleType', form: 'block', doc: 'Defines a simple type by restriction, list or union.',
      attrs: [a('name'), a('final', { values: ['#all', 'restriction', 'list', 'union'] }), ID], children: ['annotation', 'restriction', 'list', 'union'], snippetAttrs: [],
      body: pf => `<${pf}restriction base="\${1}">\n\t\t$0\n\t</${pf}restriction>`,
    },
    { local: 'simpleContent', form: 'block', doc: 'Content of a complex type that is a simple type (text with attributes).', attrs: [ID], children: ['annotation', 'restriction', 'extension'] },
    { local: 'complexContent', form: 'block', doc: 'Content of a complex type derived from another complex type.', attrs: [a('mixed', { values: TF }), ID], children: ['annotation', 'restriction', 'extension'] },
    { local: 'restriction', form: 'block', doc: 'Derives a type by restricting the `base` type.', attrs: [a('base'), ID], children: ['annotation', 'simpleType', ...FACETS], snippetAttrs: ['base'] },
    { local: 'extension', form: 'block', doc: 'Derives a type by extending the `base` type with attributes (and content).', attrs: [req('base'), ID], children: ['annotation', 'openContent', ...PARTICLES, ...ATTRS, 'assert'] },
    { local: 'list', form: 'empty', doc: 'A simple type whose values are whitespace-separated lists of `itemType` values.', attrs: [a('itemType'), ID], children: ['annotation', 'simpleType'], snippetAttrs: ['itemType'] },
    { local: 'union', form: 'empty', doc: 'A simple type whose values are values of one of the `memberTypes`.', attrs: [a('memberTypes'), ID], children: ['annotation', 'simpleType'], snippetAttrs: ['memberTypes'] },
    { local: 'sequence', form: 'block', doc: 'The child elements must appear in the given order.', attrs: [...OCCURS, ID], children: ['annotation', 'element', 'group', 'choice', 'sequence', 'any'] },
    { local: 'choice', form: 'block', doc: 'One of the child particles must appear.', attrs: [...OCCURS, ID], children: ['annotation', 'element', 'group', 'choice', 'sequence', 'any'] },
    { local: 'all', form: 'block', doc: 'The child elements may appear in any order.', attrs: [...OCCURS, ID], children: ['annotation', 'element', 'any', 'group'] },
    { local: 'group', form: 'block', doc: 'Defines a named model group, or references one (`ref`).', attrs: [a('name'), a('ref'), ...OCCURS, ID], children: ['annotation', 'all', 'choice', 'sequence'], snippetAttrs: ['name'] },
    { local: 'attributeGroup', form: 'block', doc: 'Defines a named group of attributes, or references one (`ref`).', attrs: [a('name'), a('ref'), ID], children: ['annotation', ...ATTRS], snippetAttrs: ['name'] },
    {
      local: 'any', form: 'empty', doc: 'An element wildcard.',
      attrs: [a('namespace', { values: WILDCARD_NS }), a('notNamespace'), a('notQName'), a('processContents', { values: PROCESS }), ...OCCURS, ID],
      children: ['annotation'], snippetAttrs: ['namespace', 'processContents'],
    },
    {
      local: 'anyAttribute', form: 'empty', doc: 'An attribute wildcard.',
      attrs: [a('namespace', { values: WILDCARD_NS }), a('notNamespace'), a('notQName'), a('processContents', { values: PROCESS }), ID],
      children: ['annotation'], snippetAttrs: ['namespace', 'processContents'],
    },
    { local: 'unique', form: 'block', doc: 'The values selected by the fields must be unique within the element.', attrs: [a('name'), a('ref'), ID], children: ['annotation', 'selector', 'field'], snippetAttrs: ['name'], body: keyBody(2) },
    { local: 'key', form: 'block', doc: 'The values selected by the fields must be unique and present (a key that can be referenced by xs:keyref).', attrs: [a('name'), a('ref'), ID], children: ['annotation', 'selector', 'field'], snippetAttrs: ['name'], body: keyBody(2) },
    { local: 'keyref', form: 'block', doc: 'The values selected by the fields must match the values of a key (`refer`).', attrs: [a('name'), a('ref'), a('refer'), ID], children: ['annotation', 'selector', 'field'], snippetAttrs: ['name', 'refer'], body: keyBody(3) },
    { local: 'selector', form: 'empty', doc: 'Selects the elements for an identity constraint (restricted XPath).', attrs: [req('xpath'), a('xpathDefaultNamespace'), ID], children: ['annotation'] },
    { local: 'field', form: 'empty', doc: 'Selects a field (element or attribute) of an identity constraint (restricted XPath).', attrs: [req('xpath'), a('xpathDefaultNamespace'), ID], children: ['annotation'] },
    { local: 'notation', form: 'empty', doc: 'Declares a notation.', attrs: [req('name'), a('public'), a('system'), ID], children: ['annotation'] },
    { local: 'assert', form: 'empty', doc: 'An assertion (XPath 2.0 `test`) on the content of a complex type.', attrs: [req('test'), a('xpathDefaultNamespace'), ID], children: ['annotation'], note: 'XSD 1.1' },
    { local: 'alternative', form: 'empty', doc: 'Conditional type assignment: the element has the `type` if the `test` is true.', attrs: [a('test'), a('type'), a('xpathDefaultNamespace'), ID], children: ['annotation', 'simpleType', 'complexType'], snippetAttrs: ['test', 'type'], note: 'XSD 1.1' },
    { local: 'openContent', form: 'block', doc: 'Allows wildcard elements in the content of a complex type.', attrs: [a('mode', { values: ['interleave', 'suffix', 'none'] }), ID], children: ['annotation', 'any'], note: 'XSD 1.1' },
    { local: 'defaultOpenContent', form: 'block', doc: 'Open content for all complex types of the schema document.', attrs: [a('mode', { values: ['interleave', 'suffix'] }), a('appliesToEmpty', { values: TF }), ID], children: ['annotation', 'any'], note: 'XSD 1.1' },
    facet('enumeration', 'One of the allowed values.', [req('value')]),
    facet('pattern', 'A regular expression the lexical value must match.', [req('value')]),
    facet('minInclusive', 'The minimum value (inclusive).'),
    facet('minExclusive', 'The minimum value (exclusive).'),
    facet('maxInclusive', 'The maximum value (inclusive).'),
    facet('maxExclusive', 'The maximum value (exclusive).'),
    facet('length', 'The exact length (characters, octets or list items).'),
    facet('minLength', 'The minimum length.'),
    facet('maxLength', 'The maximum length.'),
    facet('totalDigits', 'The maximum number of digits.'),
    facet('fractionDigits', 'The maximum number of fraction digits.'),
    facet('whiteSpace', 'Whitespace normalization.', [req('value', { values: ['preserve', 'replace', 'collapse'] }), a('fixed', { values: TF })]),
    facet('assertion', 'An XPath 2.0 assertion on the value (`$value`).', [req('test'), a('xpathDefaultNamespace')], 'XSD 1.1'),
    facet('explicitTimezone', 'Whether a timezone is required, prohibited or optional.', [req('value', { values: ['optional', 'required', 'prohibited'] }), a('fixed', { values: TF })], 'XSD 1.1'),
  ],

  children(el) {
    if (isXs(el, 'restriction')) {
      if (isXs(el.parent, 'simpleContent')) {
        return ['annotation', 'simpleType', ...FACETS, ...ATTRS, 'assert'];
      }
      if (isXs(el.parent, 'complexContent')) {
        return ['annotation', 'openContent', ...PARTICLES, ...ATTRS, 'assert'];
      }
    } else if (isXs(el, 'extension') && isXs(el.parent, 'simpleContent')) {
      return ['annotation', ...ATTRS, 'assert'];
    } else if (isXs(el, 'group', 'attributeGroup', 'element', 'attribute') && getAttr(el, 'ref') !== undefined) {
      return ['annotation'];
    }
    return undefined;
  },

  values({ el, attr, root, add }) {
    const xs = el.prefix;
    const builtin = (simple: boolean) => {
      const v11 = schemaVersion(root) >= '1.1';
      for (const t of [...(simple ? [] : ['anyType']), ...XSD_TYPES]) {
        if (v11 || !['dateTimeStamp', 'dayTimeDuration', 'yearMonthDuration', 'anyAtomicType'].includes(t)) {
          add(xs ? `${xs}:${t}` : t, 'built-in type');
        }
      }
    };
    const tns = getAttr(root, 'targetNamespace');
    const tnsPrefix = tns ? [...el.nsMap].find(([, ns]) => ns === tns)?.[0] : '';
    const ref = (name: string) => (tnsPrefix ? `${tnsPrefix}:${name}` : name);
    const globals = (local: string, detail: string) => {
      if (tnsPrefix === undefined) {
        return;
      }
      for (const c of root.children) {
        const name = isXs(c, local) ? getAttr(c, 'name') : undefined;
        if (name) {
          add(ref(name), detail, 'stepName');
        }
      }
    };
    const simpleTypes = () => {
      globals('simpleType', 'simple type');
      builtin(true);
    };
    const allTypes = () => {
      globals('complexType', 'complex type');
      globals('simpleType', 'simple type');
      builtin(false);
    };

    if (attr === 'type' && isXs(el, 'attribute')) {
      simpleTypes();
    } else if (attr === 'type' && isXs(el, 'element', 'alternative')) {
      allTypes();
    } else if (attr === 'base') {
      isXs(el.parent, 'simpleType') ? simpleTypes() : allTypes();
    } else if (attr === 'itemType' || attr === 'memberTypes') {
      simpleTypes();
    } else if ((attr === 'ref' && isXs(el, 'element')) || attr === 'substitutionGroup') {
      globals('element', 'global element');
    } else if (attr === 'ref' && isXs(el, 'attribute')) {
      globals('attribute', 'global attribute');
    } else if (attr === 'ref' && isXs(el, 'group')) {
      globals('group', 'model group');
    } else if ((attr === 'ref' && isXs(el, 'attributeGroup')) || attr === 'defaultAttributes') {
      globals('attributeGroup', 'attribute group');
    } else if (attr === 'refer' || (attr === 'ref' && isXs(el, 'key', 'unique', 'keyref'))) {
      for (const e of descendants(root)) {
        const name = isXs(e, 'key', 'unique') ? getAttr(e, 'name') : undefined;
        if (name && tnsPrefix !== undefined) {
          add(ref(name), e.local, 'stepName');
        }
      }
    } else if ((attr === 'namespace' && isXs(el, 'import')) || attr === 'targetNamespace') {
      for (const [p, ns] of el.nsMap) {
        if (p !== 'xml' && ns !== XSD_NS && ns !== VC_NS) {
          add(ns, p || 'default namespace', 'namespace');
        }
      }
    }
  },
};
