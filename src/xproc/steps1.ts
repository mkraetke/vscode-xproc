import { BOOL, CX_NS, makeSteps, POS_NS, PXF_NS, PXP_NS, StepDef, XPROC_NS } from './types';

const SER = [
  `byte-order-mark:${BOOL}`, 'cdata-section-elements', 'doctype-public', 'doctype-system', 'encoding',
  `escape-uri-attributes:${BOOL}`, `include-content-type:${BOOL}`, `indent:${BOOL}`, 'media-type',
  'method:xml|html|xhtml|text', 'normalization-form', `omit-xml-declaration:${BOOL}`,
  'standalone:true|false|omit', `undeclare-prefixes:${BOOL}`, 'version',
];

const SPEC = 'https://www.w3.org/TR/xproc/';

const standard = makeSteps({ group: 'standard', ns: XPROC_NS, prefix: 'p', specBase: SPEC }, [
  ['add-attribute', 'Adds a single attribute to a set of matching elements.', '<source >result',
    ['match!', 'attribute-name!', 'attribute-prefix', 'attribute-namespace', 'attribute-value!']],
  ['add-xml-base', 'Exposes the base URI via explicit xml:base attributes.', '<source >result',
    [`all:${BOOL}=false`, `relative:${BOOL}=true`]],
  ['compare', 'Compares two documents for equality.', '<source <alternate >result-',
    [`fail-if-not-equal:${BOOL}=false`]],
  ['count', 'Counts the number of documents in the source input sequence.', '<source* >result',
    ['limit=0']],
  ['delete', 'Deletes items matched by a match pattern.', '<source >result', ['match!']],
  ['directory-list', 'Produces a list of the contents of a directory.', '>result',
    ['path!', 'include-filter', 'exclude-filter']],
  ['error', 'Generates a dynamic error.', '<source- >result*', ['code!', 'code-prefix', 'code-namespace']],
  ['escape-markup', 'Applies XML serialization to the children of the document element.', '<source >result', SER],
  ['filter', 'Selects portions of a document with a (dynamically computed) XPath expression.', '<source >result*', ['select!']],
  ['http-request', 'Interacts with resources identified by IRIs over HTTP.', '<source >result', SER],
  ['identity', 'Makes a verbatim copy of its input available on its output.', '<source* >result*', []],
  ['insert', 'Inserts the insertion port\'s document into the source document relative to matching elements.', '<source <insertion* >result',
    ['match=/*', 'position!:first-child|last-child|before|after']],
  ['label-elements', 'Labels each matched element by adding an attribute.', '<source >result',
    ['attribute=xml:id', 'label=concat("_",$p:index)', 'match=*', `replace:${BOOL}=true`]],
  ['load', 'Loads an XML resource from an IRI.', '>result', ['href!', `dtd-validate:${BOOL}=false`]],
  ['make-absolute-uris', 'Makes the value of an element or attribute absolute.', '<source >result', ['match!', 'base-uri']],
  ['namespace-rename', 'Renames any namespace declaration or use of a namespace.', '<source >result',
    ['from', 'to', 'apply-to:all|elements|attributes=all']],
  ['pack', 'Merges two document sequences in a pair-wise fashion.', '<source* <alternate* >result*',
    ['wrapper!', 'wrapper-prefix', 'wrapper-namespace']],
  ['parameters', 'Exposes a set of parameters as a c:param-set document.', '<parameters% >result-', []],
  ['rename', 'Renames elements, attributes or processing-instruction targets.', '<source >result',
    ['match!', 'new-name!', 'new-prefix', 'new-namespace']],
  ['replace', 'Replaces matching elements with the replacement document.', '<source <replacement >result', ['match!']],
  ['set-attributes', 'Sets attributes on matching elements.', '<source <attributes >result', ['match!']],
  ['sink', 'Accepts a sequence of documents and discards them.', '<source*', []],
  ['split-sequence', 'Divides a single sequence into two.', '<source* >matched* >not-matched*',
    [`initial-only:${BOOL}=false`, 'test!']],
  ['store', 'Stores a serialized version of its source input to a URI.', '<source >result-', ['href!', ...SER]],
  ['string-replace', 'Matches nodes and replaces them with the result of evaluating an XPath expression.', '<source >result',
    ['match!', 'replace!']],
  ['unescape-markup', 'Takes the string value of the document element and parses it as XML.', '<source >result',
    ['namespace', 'content-type=application/xml', 'encoding', 'charset']],
  ['unwrap', 'Replaces matched elements with their children.', '<source >result', ['match!']],
  ['wrap', 'Wraps matching nodes in the source document with a new parent element.', '<source >result',
    ['wrapper!', 'wrapper-prefix', 'wrapper-namespace', 'match!', 'group-adjacent']],
  ['wrap-sequence', 'Produces a new sequence of documents by wrapping documents in a new element.', '<source* >result*',
    ['wrapper!', 'wrapper-prefix', 'wrapper-namespace', 'group-adjacent']],
  ['xinclude', 'Applies XInclude processing to the source document.', '<source >result',
    [`fixup-xml-base:${BOOL}=false`, `fixup-xml-lang:${BOOL}=false`]],
  ['xslt', 'Applies an XSLT stylesheet to a sequence of documents.', '<source* <stylesheet <parameters% >result >secondary*',
    ['initial-mode', 'template-name', 'output-base-uri', 'version']],
  ['in-scope-names', 'Exposes all in-scope options and variables as a c:param-set (XProc 1.0 Second Edition).', '>result', []],
  ['template', 'Instantiates a document template with {XPath} expressions (XProc 1.0 Second Edition).', '<template <source* <parameters% >result', []],
]);

const optional = makeSteps({ group: 'optional', ns: XPROC_NS, prefix: 'p', specBase: SPEC }, [
  ['exec', 'Runs an external command.', '<source* >result >errors >exit-status',
    ['command!', 'args', 'cwd', `source-is-xml:${BOOL}=true`, `result-is-xml:${BOOL}=true`, `wrap-result-lines:${BOOL}=false`,
      `errors-is-xml:${BOOL}=false`, `wrap-error-lines:${BOOL}=false`, 'path-separator', 'failure-threshold', 'arg-separator', ...SER]],
  ['hash', 'Generates a hash for a string and replaces matched nodes with it.', '<source <parameters% >result',
    ['value!', 'algorithm!:crc|md|sha', 'match!', 'version']],
  ['uuid', 'Generates a UUID and replaces matched nodes with it.', '<source >result', ['match!', 'version']],
  ['validate-with-relax-ng', 'Validates the source document against a RELAX NG grammar.', '<source <schema >result',
    [`dtd-attribute-values:${BOOL}=false`, `dtd-id-idref-warnings:${BOOL}=false`, `assert-valid:${BOOL}=true`]],
  ['validate-with-schematron', 'Validates the source document against a Schematron schema.', '<source <schema <parameters% >result >report*',
    ['phase=#ALL', `assert-valid:${BOOL}=true`]],
  ['validate-with-xml-schema', 'Validates the source document against W3C XML Schema(s).', '<source <schema* >result',
    [`use-location-hints:${BOOL}=false`, `try-namespaces:${BOOL}=false`, `assert-valid:${BOOL}=true`, 'mode:strict|lax=strict']],
  ['www-form-urldecode', 'Decodes a x-www-form-urlencoded string into a c:param-set.', '>result', ['value!']],
  ['www-form-urlencode', 'Encodes parameters as x-www-form-urlencoded string.', '<source <parameters% >result', ['match!']],
  ['xquery', 'Applies an XQuery query to a sequence of documents.', '<source* <query <parameters% >result*', []],
  ['xsl-formatter', 'Renders an XSL FO document (e.g. to PDF).', '<source <parameters% >result-', ['href!', 'content-type']],
]);

const calabash = makeSteps({ group: 'calabash', ns: CX_NS, prefix: 'cx' }, [
  ['message', 'Writes a message to the console and passes its input through (XML Calabash extension).', '<source* >result*', ['message!']],
  ['pretty-print', 'Pretty-prints (indents) its input (XML Calabash extension).', '<source >result', []],
  ['eval', 'Evaluates a dynamically constructed pipeline (XML Calabash extension).', '<pipeline <source* <options* >result*', ['step', `detailed:${BOOL}=false`]],
  ['css-formatter', 'Renders a document with CSS (XML Calabash extension).', '<source <css* <parameters% >result-', ['href!', 'content-type']],
  ['java-properties', 'Loads a Java properties file as c:param-set (XML Calabash extension).', '>result', ['href!']],
  ['collection-manager', 'Manages (stores into or reads from) a collection (XML Calabash extension).', '<source* >result*', ['href!']],
]);

const exprocFile = makeSteps({ group: 'exproc-file', ns: PXF_NS, prefix: 'pxf' }, [
  ['copy', 'Copies a file (EXProc file utilities).', '>result', ['href!', 'target!', `fail-on-error:${BOOL}=true`]],
  ['delete', 'Deletes a file or directory (EXProc file utilities).', '>result', ['href!', `recursive:${BOOL}=false`, `fail-on-error:${BOOL}=true`]],
  ['head', 'Returns the first lines of a text file (EXProc file utilities).', '>result', ['href!', 'count!', `fail-on-error:${BOOL}=true`]],
  ['info', 'Returns information about a file or directory (EXProc file utilities).', '>result*', ['href!', `fail-on-error:${BOOL}=true`]],
  ['mkdir', 'Creates a directory (EXProc file utilities).', '>result', ['href!', `fail-on-error:${BOOL}=true`]],
  ['move', 'Moves a file or directory (EXProc file utilities).', '>result', ['href!', 'target!', `fail-on-error:${BOOL}=true`]],
  ['tail', 'Returns the last lines of a text file (EXProc file utilities).', '>result', ['href!', 'count!', `fail-on-error:${BOOL}=true`]],
  ['tempfile', 'Creates a temporary file (EXProc file utilities).', '>result',
    ['href!', 'prefix', 'suffix', `delete-on-exit:${BOOL}=false`, `fail-on-error:${BOOL}=true`]],
  ['touch', 'Updates the modification timestamp of a file (EXProc file utilities).', '>result', ['href!', 'timestamp', `fail-on-error:${BOOL}=true`]],
]);

const exprocOs = makeSteps({ group: 'exproc-os', ns: POS_NS, prefix: 'pos' }, [
  ['info', 'Returns information about the operating system (EXProc OS utilities).', '>result', []],
  ['cwd', 'Returns the current working directory (EXProc OS utilities).', '>result', []],
  ['env', 'Returns the environment variables (EXProc OS utilities).', '>result', []],
]);

const exproc = makeSteps({ group: 'exproc', ns: PXP_NS, prefix: 'pxp' }, [
  ['zip', 'Creates, updates or deletes entries of a ZIP archive (EXProc).', '<source* <manifest >result',
    ['href!', 'compression-method:stored|deflated', 'compression-level:smallest|fastest|default|huffman|none', 'command:update|freshen|create|delete=update', ...SER]],
  ['unzip', 'Extracts entries from a ZIP archive (EXProc).', '>result', ['href!', 'file', 'content-type']],
  ['set-base-uri', 'Sets the base URI of a document (EXProc).', '<source >result', ['uri!']],
  ['nvdl', 'Validates a document with NVDL (EXProc).', '<source <nvdl <schemas* >result', [`assert-valid:${BOOL}=true`]],
]);

export const STEPS_1: StepDef[] = [...standard, ...optional, ...calabash, ...exprocFile, ...exprocOs, ...exproc];
