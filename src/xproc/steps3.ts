import { BOOL, makeSteps, StepDef, XPROC_NS } from './types';

const SPEC = 'https://spec.xproc.org/3.1/';
const g = (group: string, path: string) => ({ group, ns: XPROC_NS, prefix: 'p', specBase: SPEC + path + '/' });
const REPORT = 'report-format=xvrl';

const standard = makeSteps(g('standard', 'steps'), [
  ['add-attribute', 'Adds a single attribute to a set of matching elements.', '<source >result',
    ['match=/*', 'attribute-name!', 'attribute-value!']],
  ['add-xml-base', 'Exposes the base URI via explicit xml:base attributes.', '<source >result',
    [`all:${BOOL}=false`, `relative:${BOOL}=true`]],
  ['archive', 'Creates an archive (e.g. ZIP) from the documents on its inputs.', '<source* <manifest*~ <archive*~ >result >report',
    ['format=zip', 'relative-to', 'parameters']],
  ['archive-manifest', 'Creates an XML manifest of an archive.', '<source >result',
    ['format', 'relative-to', 'parameters', 'override-content-types']],
  ['cast-content-type', 'Changes the media type of a document, converting its representation if necessary.', '<source >result',
    ['content-type!', 'parameters']],
  ['compare', 'Compares two documents for equality.', '<source <alternate >result >differences*',
    ['method', `fail-if-not-equal:${BOOL}=false`, 'parameters']],
  ['compress', 'Compresses a document (e.g. with gzip).', '<source >result', ['format=gzip', 'serialization', 'parameters']],
  ['count', 'Counts the number of documents in the source input sequence.', '<source* >result', ['limit=0']],
  ['delete', 'Deletes nodes matched by a selection pattern.', '<source >result', ['match!']],
  ['directory-list', 'Produces a list of the contents of a directory.', '>result',
    ['path!', `detailed:${BOOL}=false`, 'max-depth=1', 'include-filter', 'exclude-filter', 'override-content-types']],
  ['encode', 'Encodes a document (base64).', '<source >result', ['encoding:base64=base64', 'serialization', 'parameters']],
  ['error', 'Raises a dynamic error.', '<source* >result*', ['code!']],
  ['filter', 'Selects portions of a document with a (dynamically computed) XPath expression.', '<source >result*', ['select!']],
  ['hash', 'Generates a hash for a string and replaces matched nodes with it.', '<source >result',
    ['value!', 'algorithm!:crc|md|sha', 'match=/*', 'parameters', 'version']],
  ['http-request', 'Interacts with resources identified by IRIs over HTTP.', '<source* >result* >report',
    ['href!', 'method=GET', 'serialization', 'headers', 'auth', 'parameters', 'assert=.?status-code lt 400', 'timeout']],
  ['identity', 'Makes a verbatim copy of its input available on its output.', '<source* >result*', []],
  ['insert', 'Inserts the insertion port\'s documents into the source document relative to matching nodes.', '<source <insertion* >result',
    ['match=/*', 'position:first-child|last-child|before|after=after']],
  ['json-join', 'Joins documents into a JSON array.', '<source* >result', ['flatten-to-depth=0']],
  ['json-merge', 'Merges documents into a JSON map.', '<source* >result',
    ['duplicates:reject|use-first|use-last|use-any|combine=use-first', 'key=concat("_",$p:index)']],
  ['label-elements', 'Labels each matched element by adding an attribute.', '<source >result',
    ['attribute=xml:id', 'label=concat("_",$p:index)', 'match=*', `replace:${BOOL}=true`]],
  ['load', 'Loads a resource from a URI.', '>result', ['href!', 'parameters', 'content-type', 'document-properties']],
  ['make-absolute-uris', 'Makes the value of an element or attribute absolute.', '<source >result', ['match!', 'base-uri']],
  ['markdown-to-html', 'Converts Markdown to HTML.', '<source >result', ['parameters']],
  ['message', 'Writes a message and passes its input through.', '<source* >result*', ['test=true()', 'select!']],
  ['namespace-delete', 'Deletes namespaces from a document.', '<source >result', ['prefixes!']],
  ['namespace-rename', 'Renames any namespace declaration or use of a namespace.', '<source >result',
    ['from', 'to', 'apply-to:all|elements|attributes=all']],
  ['pack', 'Merges two document sequences in a pair-wise fashion.', '<source* <alternate* >result*', ['wrapper!']],
  ['rename', 'Renames elements, attributes or processing-instruction targets.', '<source >result', ['match=/*', 'new-name!']],
  ['replace', 'Replaces matching nodes with the replacement document.', '<source <replacement >result', ['match!']],
  ['set-attributes', 'Sets attributes on matching elements.', '<source >result', ['match=/*', 'attributes!']],
  ['set-properties', 'Sets document properties.', '<source >result', ['properties!', `merge:${BOOL}=true`]],
  ['sink', 'Accepts a sequence of documents and discards them.', '<source*', []],
  ['sleep', 'Pauses the pipeline for a given duration.', '<source* >result*', ['duration!']],
  ['split-sequence', 'Divides a single sequence into two.', '<source* >matched* >not-matched*',
    ['test!', `initial-only:${BOOL}=false`]],
  ['store', 'Stores a serialized version of its source input to a URI.', '<source >result >result-uri',
    ['href!', 'serialization']],
  ['string-replace', 'Matches nodes and replaces them with the result of evaluating an XPath expression.', '<source >result',
    ['match!', 'replace!']],
  ['text-count', 'Counts the lines in a text document.', '<source >result', []],
  ['text-head', 'Returns the first lines of a text document.', '<source >result', ['count!']],
  ['text-join', 'Concatenates text documents.', '<source* >result', ['separator', 'prefix', 'suffix', 'override-content-type']],
  ['text-replace', 'Replaces all matches of a regular expression in a text document.', '<source >result', ['pattern!', 'replacement!', 'flags']],
  ['text-sort', 'Sorts the lines of a text document.', '<source >result',
    ['sort-key=.', 'order:ascending|descending=ascending', 'case-order:upper-first|lower-first', 'lang', 'collation', `stable:${BOOL}=true`]],
  ['text-tail', 'Returns the last lines of a text document.', '<source >result', ['count!']],
  ['unarchive', 'Extracts documents from an archive.', '<source >result*',
    ['include-filter', 'exclude-filter', 'format', 'relative-to', 'parameters', 'override-content-types']],
  ['uncompress', 'Uncompresses a document.', '<source >result', ['format', 'parameters', 'content-type=application/octet-stream']],
  ['unwrap', 'Replaces matched elements with their children.', '<source >result', ['match!']],
  ['uuid', 'Generates a UUID and replaces matched nodes with it.', '<source >result', ['match=/*', 'version']],
  ['wrap', 'Wraps matching nodes in a new parent element.', '<source >result', ['wrapper!', 'match!', 'group-adjacent']],
  ['wrap-sequence', 'Wraps a sequence of documents in a new element.', '<source* >result*', ['wrapper!', 'group-adjacent']],
  ['www-form-urldecode', 'Decodes a x-www-form-urlencoded string into a map.', '>result', ['value!']],
  ['www-form-urlencode', 'Encodes a map as x-www-form-urlencoded string.', '>result', ['parameters!']],
  ['xinclude', 'Applies XInclude processing to the source document.', '<source >result',
    [`fixup-xml-base:${BOOL}=false`, `fixup-xml-lang:${BOOL}=false`]],
  ['xquery', 'Applies an XQuery query.', '<source* <query >result*', ['parameters', 'version']],
  ['xslt', 'Applies an XSLT stylesheet.', '<source* <stylesheet >result* >secondary*',
    ['initial-mode', 'template-name', 'output-base-uri', 'version', 'parameters', 'static-parameters',
      'global-context-item', `populate-default-collection:${BOOL}=true`]],
]);

const file = makeSteps(g('file', 'file'), [
  ['file-copy', 'Copies a file or directory.', '>result', ['href!', 'target!', `fail-on-error:${BOOL}=true`, `overwrite:${BOOL}=true`]],
  ['file-create-tempfile', 'Creates a temporary file.', '>result',
    ['href', 'suffix', 'prefix', `delete-on-exit:${BOOL}=false`, `fail-on-error:${BOOL}=true`]],
  ['file-delete', 'Deletes a file or directory.', '>result', ['href!', `recursive:${BOOL}=false`, `fail-on-error:${BOOL}=true`]],
  ['file-info', 'Returns information about a file or directory.', '>result', ['href!', `fail-on-error:${BOOL}=true`, 'override-content-types']],
  ['file-mkdir', 'Creates a directory.', '>result', ['href!', `fail-on-error:${BOOL}=true`]],
  ['file-move', 'Moves a file or directory.', '>result', ['href!', 'target!', `fail-on-error:${BOOL}=true`]],
  ['file-touch', 'Updates the modification timestamp of a file.', '>result', ['href!', 'timestamp', `fail-on-error:${BOOL}=true`]],
]);

const os = makeSteps(g('os', 'os'), [
  ['os-exec', 'Runs an external command.', '<source* >result >error >exit-status',
    ['command!', 'args', 'cwd', 'result-content-type=text/plain', 'error-content-type=text/plain',
      'path-separator', 'failure-threshold', 'serialization']],
  ['os-info', 'Returns information about the operating system.', '>result', []],
]);

const validation = makeSteps(g('validation', 'validation'), [
  ['validate-with-dtd', 'Validates a document against its DTD.', '<source >result >report*',
    ['serialization', `assert-valid:${BOOL}=true`, REPORT]],
  ['validate-with-json-schema', 'Validates a JSON document against a JSON schema.', '<source <schema >result >report*',
    [`assert-valid:${BOOL}=true`, 'default-version', REPORT, 'parameters']],
  ['validate-with-nvdl', 'Validates a document with NVDL.', '<source <nvdl <schemas*~ >result >report*',
    [`assert-valid:${BOOL}=true`, REPORT, 'parameters']],
  ['validate-with-relax-ng', 'Validates a document against a RELAX NG grammar.', '<source <schema >result >report*',
    [`dtd-attribute-values:${BOOL}=false`, `dtd-id-idref-warnings:${BOOL}=false`, `assert-valid:${BOOL}=true`, REPORT, 'parameters']],
  ['validate-with-schematron', 'Validates a document against a Schematron schema.', '<source <schema >result >report*',
    ['phase=#DEFAULT', `assert-valid:${BOOL}=true`, 'report-format=svrl', 'parameters']],
  ['validate-with-xml-schema', 'Validates a document against W3C XML Schema(s).', '<source <schema* >result >report*',
    [`use-location-hints:${BOOL}=false`, `try-namespaces:${BOOL}=false`, `assert-valid:${BOOL}=true`, 'mode:strict|lax=strict',
      'version', REPORT, 'parameters']],
]);

const paged = makeSteps(g('paged-media', 'paged-media'), [
  ['css-formatter', 'Renders a document with CSS (paged media, e.g. to PDF).', '<source <stylesheet*~ >result', ['parameters', 'content-type']],
  ['xsl-formatter', 'Renders an XSL FO document (e.g. to PDF).', '<source >result', ['parameters', 'content-type']],
]);

const misc = [
  ...makeSteps(g('mail', 'mail'), [
    ['send-mail', 'Sends an email.', '<source* >result', ['serialization', 'auth', 'parameters']],
  ]),
  ...makeSteps(g('ixml', 'ixml'), [
    ['invisible-xml', 'Parses a non-XML document with an Invisible XML grammar.', '<source <grammar*~ >result',
      ['parameters', `fail-on-error:${BOOL}=true`]],
  ]),
  ...makeSteps(g('run', 'run'), [
    ['run', 'Runs a dynamically loaded pipeline (ports and options are given with p:run-input / p:run-option).', '<pipeline-', []],
  ]),
];

export const STEPS_3: StepDef[] = [...standard, ...file, ...os, ...validation, ...paged, ...misc];

/** steps that were added in XProc 3.1 */
export const STEPS_31_ONLY = new Set(['message', 'validate-with-dtd', 'invisible-xml']);
