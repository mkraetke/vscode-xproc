import { STEPS_1 } from './steps1';
import { STEPS_3, STEPS_31_ONLY } from './steps3';
import { AttrDef, BOOL, clark, CoreElementDef, StepDef, XProcVersion, isV3 } from './types';

const B = BOOL.split('|');
const a = (name: string, opts: Partial<AttrDef> = {}): AttrDef => ({ name, ...opts });
const req = (name: string, doc?: string): AttrDef => ({ name, required: true, doc });

const SERIALIZATION_ATTRS: AttrDef[] = [
  a('byte-order-mark', { values: B }), a('cdata-section-elements'), a('doctype-public'), a('doctype-system'), a('encoding'),
  a('escape-uri-attributes', { values: B }), a('include-content-type', { values: B }), a('indent', { values: B }), a('media-type'),
  a('method', { values: ['xml', 'html', 'xhtml', 'text'] }), a('normalization-form'), a('omit-xml-declaration', { values: B }),
  a('standalone', { values: ['true', 'false', 'omit'] }), a('undeclare-prefixes', { values: B }), a('version'),
];

// ---------------------------------------------------------------------------------------------
// XProc 1.0

const SPEC1 = 'https://www.w3.org/TR/xproc/';
const STEP_CHILDREN_1 = ['input', 'with-option', 'with-param', 'log', 'documentation', 'pipeinfo'];
const BINDINGS_1 = ['empty', 'pipe', 'document', 'inline', 'data', 'documentation', 'pipeinfo'];
const SUBPIPELINE_1 = ['output', 'log', 'variable', 'documentation', 'pipeinfo'];
const DECL_1 = ['input', 'output', 'option', 'log', 'serialization', 'import', 'declare-step', 'pipeline', 'variable', 'documentation', 'pipeinfo'];
const PIPELINE_ATTRS_1 = [a('name'), a('type'), a('psvi-required', { values: B }), a('xpath-version', { values: ['1.0', '2.0'] }),
  a('exclude-inline-prefixes'), a('version', { values: ['1.0'] })];

const CORE_1: CoreElementDef[] = [
  { local: 'declare-step', doc: 'Declares a step or defines a pipeline.', attrs: PIPELINE_ATTRS_1, children: DECL_1, steps: true, container: true, block: true },
  { local: 'pipeline', doc: 'Declares a pipeline with an implicit primary `source` input, `parameters` input and `result` output.', attrs: PIPELINE_ATTRS_1, children: DECL_1, steps: true, container: true, block: true },
  { local: 'library', doc: 'A collection of step declarations and/or pipeline definitions.', attrs: [a('psvi-required', { values: B }), a('xpath-version', { values: ['1.0', '2.0'] }), a('exclude-inline-prefixes'), a('version', { values: ['1.0'] })], children: ['import', 'declare-step', 'pipeline', 'documentation', 'pipeinfo'], block: true },
  { local: 'import', doc: 'Loads a pipeline or pipeline library, making the steps it declares available.', attrs: [req('href')], children: ['documentation', 'pipeinfo'] },
  { local: 'input', doc: 'Declares an input port (in a step declaration) or connects an input port (in a step invocation).', attrs: [req('port'), a('sequence', { values: B }), a('primary', { values: B }), a('kind', { values: ['document', 'parameter'] }), a('select')], children: BINDINGS_1 },
  { local: 'output', doc: 'Declares an output port.', attrs: [req('port'), a('sequence', { values: B }), a('primary', { values: B })], children: BINDINGS_1 },
  { local: 'option', doc: 'Declares an option.', attrs: [req('name'), a('required', { values: B }), a('select')], children: ['documentation', 'pipeinfo'] },
  { local: 'with-option', doc: 'Provides an actual value for an option.', attrs: [req('name'), req('select')], children: ['namespaces', ...BINDINGS_1] },
  { local: 'with-param', doc: 'Provides an actual value for a parameter.', attrs: [req('name'), req('select'), a('port')], children: ['namespaces', ...BINDINGS_1] },
  { local: 'variable', doc: 'Declares a variable.', attrs: [req('name'), req('select')], children: ['namespaces', ...BINDINGS_1] },
  { local: 'serialization', doc: 'Specifies serialization options for an output port.', attrs: [req('port'), ...SERIALIZATION_ATTRS], children: [] },
  { local: 'log', doc: 'Writes the documents that appear on a port to a log.', attrs: [req('port'), a('href')], children: [] },
  { local: 'namespaces', doc: 'Specifies the namespace bindings used to evaluate an XPath expression.', attrs: [a('binding'), a('element'), a('except-prefixes')], children: ['documentation', 'pipeinfo'] },
  { local: 'for-each', doc: 'Processes a sequence of documents, applying its subpipeline to each one.', attrs: [a('name')], children: ['iteration-source', ...SUBPIPELINE_1], steps: true, container: true, block: true },
  { local: 'viewport', doc: 'Processes a single document, applying its subpipeline to matching subtrees.', attrs: [a('name'), req('match')], children: ['viewport-source', ...SUBPIPELINE_1], steps: true, container: true, block: true },
  { local: 'choose', doc: 'Selects exactly one of a list of alternative subpipelines.', attrs: [a('name')], children: ['xpath-context', 'variable', 'when', 'otherwise', 'documentation', 'pipeinfo'], container: true, block: true },
  { local: 'when', doc: 'A branch of p:choose.', attrs: [req('test')], children: ['xpath-context', ...SUBPIPELINE_1], steps: true, block: true },
  { local: 'otherwise', doc: 'The default branch of p:choose.', attrs: [], children: SUBPIPELINE_1, steps: true, block: true },
  { local: 'group', doc: 'Groups steps (a wrapper for a subpipeline).', attrs: [a('name')], children: SUBPIPELINE_1, steps: true, container: true, block: true },
  { local: 'try', doc: 'Recovers from dynamic errors: runs p:group and, if it fails, p:catch.', attrs: [a('name')], children: ['group', 'catch', 'documentation', 'pipeinfo'], container: true, block: true },
  { local: 'catch', doc: 'The recovery subpipeline of p:try. Errors are available on the `error` port.', attrs: [a('name')], children: SUBPIPELINE_1, steps: true, container: true, block: true },
  { local: 'iteration-source', doc: 'The sequence of documents p:for-each iterates over.', attrs: [a('select')], children: BINDINGS_1 },
  { local: 'viewport-source', doc: 'The document p:viewport operates on.', attrs: [], children: BINDINGS_1 },
  { local: 'xpath-context', doc: 'The context for the p:when test expressions.', attrs: [], children: BINDINGS_1 },
  { local: 'pipe', doc: 'Connects to an output port of another step.', attrs: [req('step'), req('port')], children: [] },
  { local: 'document', doc: 'Reads an XML document from a URI.', attrs: [req('href')], children: [] },
  { local: 'inline', doc: 'Provides an inline XML document.', attrs: [a('exclude-inline-prefixes')], children: [], anyContent: true, block: true },
  { local: 'data', doc: 'Reads a (non-XML) resource and wraps it in an element.', attrs: [req('href'), a('wrapper'), a('wrapper-prefix'), a('wrapper-namespace'), a('content-type')], children: [] },
  { local: 'empty', doc: 'Connects to an empty sequence of documents.', attrs: [], children: [] },
  { local: 'documentation', doc: 'Human-readable documentation (ignored by the processor).', attrs: [], children: [], anyContent: true, block: true },
  { local: 'pipeinfo', doc: 'Information for processors (ignored by other processors).', attrs: [], children: [], anyContent: true, block: true },
];

// ---------------------------------------------------------------------------------------------
// XProc 3.x

const SPEC3 = 'https://spec.xproc.org/3.1/xproc/';
const STEP_CHILDREN_3 = ['with-input', 'with-option', 'documentation', 'pipeinfo'];
const CONNECTIONS_3 = ['empty', 'pipe', 'document', 'inline', 'documentation', 'pipeinfo'];
const SUBPIPELINE_3 = ['output', 'variable', 'documentation', 'pipeinfo'];
const DECL_3 = ['input', 'output', 'option', 'import', 'import-functions', 'declare-step', 'variable', 'documentation', 'pipeinfo'];
const CONNECTION_ATTRS_3 = [a('href'), a('pipe')];

const CORE_3: CoreElementDef[] = [
  { local: 'declare-step', doc: 'Declares a step or defines a pipeline.', attrs: [a('name'), a('type'), a('psvi-required', { values: B }), a('xpath-version'), a('exclude-inline-prefixes'), a('version', { values: ['3.0', '3.1'] }), a('visibility', { values: ['public', 'private'] })], children: DECL_3, steps: true, container: true, block: true },
  { local: 'library', doc: 'A collection of step declarations, static options and functions.', attrs: [a('psvi-required', { values: B }), a('xpath-version'), a('exclude-inline-prefixes'), a('version', { values: ['3.0', '3.1'] })], children: ['import', 'import-functions', 'option', 'declare-step', 'documentation', 'pipeinfo'], block: true },
  { local: 'import', doc: 'Loads a pipeline or pipeline library, making the steps it declares available.', attrs: [req('href')], children: ['documentation', 'pipeinfo'] },
  { local: 'import-functions', doc: 'Imports XPath functions from an XSLT stylesheet, XQuery module or other library.', attrs: [req('href'), a('content-type'), a('namespace')], children: [] },
  { local: 'input', doc: 'Declares an input port. Children (if any) provide the default connection.', attrs: [req('port'), a('sequence', { values: B }), a('primary', { values: B }), a('select'), a('content-types'), a('href'), a('exclude-inline-prefixes')], children: ['empty', 'document', 'inline', 'documentation', 'pipeinfo'] },
  { local: 'output', doc: 'Declares an output port.', attrs: [req('port'), a('sequence', { values: B }), a('primary', { values: B }), a('content-types'), a('serialization'), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'option', doc: 'Declares an option.', attrs: [req('name'), a('as'), a('values'), a('static', { values: B }), a('required', { values: B }), a('select'), a('visibility', { values: ['public', 'private'] })], children: ['documentation', 'pipeinfo'] },
  { local: 'with-input', doc: 'Connects an input port of a step.', attrs: [a('port'), a('select'), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'with-option', doc: 'Provides an actual value for an option.', attrs: [req('name'), a('as'), req('select'), a('collection', { values: B }), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'variable', doc: 'Declares a variable.', attrs: [req('name'), a('as'), req('select'), a('collection', { values: B }), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'for-each', doc: 'Processes a sequence of documents, applying its subpipeline to each one. The current document is available on the `current` port.', attrs: [a('name')], children: ['with-input', ...SUBPIPELINE_3], steps: true, container: true, block: true },
  { local: 'viewport', doc: 'Processes a single document, applying its subpipeline to matching subtrees (`current` port).', attrs: [a('name'), req('match')], children: ['with-input', ...SUBPIPELINE_3], steps: true, container: true, block: true },
  { local: 'choose', doc: 'Selects exactly one of a list of alternative subpipelines.', attrs: [a('name')], children: ['with-input', 'when', 'otherwise', 'documentation', 'pipeinfo'], container: true, block: true },
  { local: 'when', doc: 'A branch of p:choose.', attrs: [a('name'), req('test'), a('collection', { values: B })], children: ['with-input', ...SUBPIPELINE_3], steps: true, container: true, block: true },
  { local: 'otherwise', doc: 'The default branch of p:choose.', attrs: [a('name')], children: SUBPIPELINE_3, steps: true, container: true, block: true },
  { local: 'if', doc: 'Runs its subpipeline only if the test expression is true.', attrs: [a('name'), req('test'), a('collection', { values: B })], children: ['with-input', ...SUBPIPELINE_3], steps: true, container: true, block: true },
  { local: 'group', doc: 'Groups steps (a wrapper for a subpipeline).', attrs: [a('name')], children: SUBPIPELINE_3, steps: true, container: true, block: true },
  { local: 'try', doc: 'Recovers from dynamic errors with p:catch and runs cleanup code in p:finally.', attrs: [a('name')], children: ['catch', 'finally', ...SUBPIPELINE_3], steps: true, container: true, block: true },
  { local: 'catch', doc: 'Recovery subpipeline of p:try. Errors are available on the `error` port.', attrs: [a('name'), a('code')], children: SUBPIPELINE_3, steps: true, container: true, block: true },
  { local: 'finally', doc: 'Cleanup subpipeline of p:try that always runs. Errors (if any) are on the `error` port.', attrs: [a('name')], children: SUBPIPELINE_3, steps: true, container: true, block: true },
  { local: 'pipe', doc: 'Connects to an output port of another step.', attrs: [a('step'), a('port')], children: [] },
  { local: 'document', doc: 'Reads a document from a URI.', attrs: [req('href'), a('content-type'), a('document-properties'), a('parameters')], children: [] },
  { local: 'inline', doc: 'Provides an inline document.', attrs: [a('exclude-inline-prefixes'), a('content-type'), a('document-properties'), a('encoding')], children: [], anyContent: true, block: true },
  { local: 'empty', doc: 'Connects to an empty sequence of documents.', attrs: [], children: [] },
  { local: 'run-input', doc: 'Connects an input port of the pipeline run by p:run.', attrs: [req('port'), a('select'), a('primary', { values: B }), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'run-option', doc: 'Provides an option value for the pipeline run by p:run.', attrs: [req('name'), a('as'), req('select'), a('collection', { values: B }), a('static', { values: B }), a('exclude-inline-prefixes'), ...CONNECTION_ATTRS_3], children: CONNECTIONS_3 },
  { local: 'documentation', doc: 'Human-readable documentation (ignored by the processor).', attrs: [], children: [], anyContent: true, block: true },
  { local: 'pipeinfo', doc: 'Information for processors (ignored by other processors).', attrs: [], children: [], anyContent: true, block: true },
];

for (const d of CORE_1) {
  d.specUrl = `${SPEC1}#p.${d.local}`;
}
for (const d of CORE_3) {
  d.specUrl = `${SPEC3}#p.${d.local}`;
}

const core1 = new Map(CORE_1.map(d => [d.local, d]));
const core3 = new Map(CORE_3.map(d => [d.local, d]));

export function coreElement(version: XProcVersion, local: string): CoreElementDef | undefined {
  return (isV3(version) ? core3 : core1).get(local);
}

export function coreElements(version: XProcVersion): CoreElementDef[] {
  return isV3(version) ? CORE_3 : CORE_1;
}

const COMPOUND_1 = ['for-each', 'viewport', 'choose', 'group', 'try'];
const COMPOUND_3 = ['for-each', 'viewport', 'choose', 'if', 'group', 'try'];

/** compound steps (core elements that may appear wherever steps are allowed) */
export function compoundSteps(version: XProcVersion): string[] {
  return isV3(version) ? COMPOUND_3 : COMPOUND_1;
}

export function atomicStepChildren(version: XProcVersion): string[] {
  return isV3(version) ? STEP_CHILDREN_3 : STEP_CHILDREN_1;
}

/** attributes allowed on every element in the XProc namespace */
export function commonAttrs(version: XProcVersion): AttrDef[] {
  return isV3(version)
    ? [a('use-when'), a('expand-text', { values: B }), a('xml:id'), a('xml:base')]
    : [a('xml:id'), a('xml:base')];
}

/** attributes allowed on step invocations (unqualified on steps in the XProc namespace) */
export function stepAttrs(version: XProcVersion): AttrDef[] {
  return isV3(version)
    ? [a('name'), a('depends'), a('timeout'), a('message'), a('use-when'), a('expand-text', { values: B }), a('xml:id'), a('xml:base')]
    : [a('name'), a('xml:id'), a('xml:base')];
}

const builtin1 = new Map(STEPS_1.map(s => [clark(s.ns, s.local), s]));
const builtin3 = new Map(STEPS_3.map(s => [clark(s.ns, s.local), s]));

export function builtinStep(version: XProcVersion, ns: string, local: string): StepDef | undefined {
  if (version === '3.0' && STEPS_31_ONLY.has(local)) {
    return undefined;
  }
  return (isV3(version) ? builtin3 : builtin1).get(clark(ns, local));
}

export function builtinSteps(version: XProcVersion): StepDef[] {
  if (!isV3(version)) {
    return STEPS_1;
  }
  return version === '3.0' ? STEPS_3.filter(s => !STEPS_31_ONLY.has(s.local)) : STEPS_3;
}

export const SEQUENCE_TYPES = [
  'xs:string', 'xs:boolean', 'xs:integer', 'xs:decimal', 'xs:double', 'xs:anyURI', 'xs:QName', 'xs:date', 'xs:dateTime',
  'xs:string?', 'xs:string*', 'xs:boolean?', 'xs:integer?', 'xs:anyURI?', 'item()', 'item()*', 'node()', 'node()*',
  'element()', 'document-node()', 'map(*)', 'map(xs:string, item()*)', 'map(xs:QName, item()*)', 'array(*)', 'function(*)',
];

export const CONTENT_TYPES = [
  'application/xml', 'text/xml', 'application/xhtml+xml', 'text/html', 'text/plain', 'application/json',
  'application/octet-stream', 'application/zip', 'application/pdf', 'image/svg+xml', 'text/css', 'xml', 'html', 'text', 'json', 'any',
];

export const COMMON_NAMESPACES: [string, string][] = [
  ['p', 'http://www.w3.org/ns/xproc'],
  ['c', 'http://www.w3.org/ns/xproc-step'],
  ['err', 'http://www.w3.org/ns/xproc-error'],
  ['cx', 'http://xmlcalabash.com/ns/extensions'],
  ['xs', 'http://www.w3.org/2001/XMLSchema'],
  ['xsl', 'http://www.w3.org/1999/XSL/Transform'],
  ['map', 'http://www.w3.org/2005/xpath-functions/map'],
  ['array', 'http://www.w3.org/2005/xpath-functions/array'],
  ['fn', 'http://www.w3.org/2005/xpath-functions'],
  ['pxf', 'http://exproc.org/proposed/steps/file'],
  ['pxp', 'http://exproc.org/proposed/steps'],
  ['pos', 'http://exproc.org/proposed/steps/os'],
  ['tr', 'http://transpect.io'],
  ['svrl', 'http://purl.oclc.org/dsdl/svrl'],
  ['html', 'http://www.w3.org/1999/xhtml'],
];
