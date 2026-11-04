export const XSL_NS = 'http://www.w3.org/1999/XSL/Transform';

/** XSLT version: 1 (1.0), 2 (2.0) or 3 (3.0) */
export type XsltVersion = 1 | 2 | 3;

export interface XsltAttrDef {
  name: string;
  required?: boolean;
  values?: string[];
  /** first XSLT version that has the attribute */
  since?: XsltVersion;
}

export interface XsltElementDef {
  local: string;
  doc: string;
  since: XsltVersion;
  attrs: XsltAttrDef[];
  /** allowed XSLT children; '#sc' stands for the instructions of a sequence constructor, '#decl' for declarations */
  children: string[];
  /** element category (used for the completion detail) */
  category: 'root' | 'declaration' | 'instruction' | 'element';
  /** form of the snippet: empty element, content on one line or content on its own lines */
  form: 'empty' | 'inline' | 'block';
  /** attributes included in the snippet (default: the required ones) */
  snippetAttrs?: string[];
  /** content of block snippets; pf is the XSLT prefix including the colon */
  body?: (pf: string) => string;
}

const YN = ['yes', 'no'];
const VALIDATION = ['strict', 'lax', 'preserve', 'strip'];
const VISIBILITY = ['public', 'private', 'final', 'abstract'];
const COMPONENTS = ['template', 'function', 'attribute-set', 'variable', 'mode', '*'];
const USE = ['required', 'optional', 'absent'];
const STREAMABILITY = ['unclassified', 'absorbing', 'inspection', 'filter', 'shallow-descent', 'deep-descent', 'ascent'];

const a = (name: string, opts: Omit<XsltAttrDef, 'name'> = {}): XsltAttrDef => ({ name, ...opts });
const req = (name: string, opts: Omit<XsltAttrDef, 'name' | 'required'> = {}): XsltAttrDef => ({ name, required: true, ...opts });
const v2 = (name: string, opts: Omit<XsltAttrDef, 'name' | 'since'> = {}): XsltAttrDef => ({ name, since: 2, ...opts });
const v3 = (name: string, opts: Omit<XsltAttrDef, 'name' | 'since'> = {}): XsltAttrDef => ({ name, since: 3, ...opts });

const SERIALIZATION: XsltAttrDef[] = [
  a('method', { values: ['xml', 'html', 'xhtml', 'text', 'json', 'adaptive'] }), a('encoding', { values: ['UTF-8', 'UTF-16', 'ISO-8859-1', 'US-ASCII'] }),
  a('indent', { values: YN }), a('omit-xml-declaration', { values: YN }), a('standalone', { values: ['yes', 'no', 'omit'] }),
  a('doctype-public'), a('doctype-system'), a('cdata-section-elements'), a('media-type'),
  v2('byte-order-mark', { values: YN }), v2('escape-uri-attributes', { values: YN }), v2('include-content-type', { values: YN }),
  v2('normalization-form', { values: ['NFC', 'NFD', 'NFKC', 'NFKD', 'fully-normalized', 'none'] }), v2('undeclare-prefixes', { values: YN }),
  v2('use-character-maps'), v3('allow-duplicate-names', { values: YN }), v3('build-tree', { values: YN }), v3('html-version', { values: ['5'] }),
  v3('item-separator'), v3('json-node-output-method', { values: ['xml', 'html', 'xhtml', 'text'] }), v3('parameter-document'), v3('suppress-indentation'),
];

/** standard attributes, allowed (unprefixed) on every XSLT element */
export const STANDARD_ATTRS: XsltAttrDef[] = [
  v2('version', { values: ['3.0', '2.0', '1.0'] }), v2('exclude-result-prefixes'), v2('extension-element-prefixes'), v2('xpath-default-namespace'),
  v2('default-collation'), v2('use-when'), v3('default-mode'), v3('default-validation', { values: ['preserve', 'strip'] }), v3('expand-text', { values: YN }),
];

/** attributes in the XSLT namespace that are allowed on literal result elements */
export const LRE_ATTRS: XsltAttrDef[] = [
  a('exclude-result-prefixes'), a('extension-element-prefixes'), a('use-attribute-sets'), v2('xpath-default-namespace'), v2('default-collation'),
  v2('use-when'), v2('inherit-namespaces', { values: YN }), v2('type'), v2('validation', { values: VALIDATION }), v3('default-mode'),
  v3('default-validation', { values: ['preserve', 'strip'] }), v3('expand-text', { values: YN }),
];

const ROOT_ATTRS: XsltAttrDef[] = [
  req('version', { values: ['3.0', '2.0', '1.0'] }), a('id'), a('exclude-result-prefixes'), a('extension-element-prefixes'),
  v2('xpath-default-namespace'), v2('default-validation', { values: ['preserve', 'strip'] }), v2('default-collation'),
  v2('input-type-annotations', { values: ['preserve', 'strip', 'unspecified'] }), v2('use-when'), v3('default-mode'), v3('expand-text', { values: YN }),
];

const choose = (pf: string) => `\t<${pf}when test="\${1}">\n\t\t$2\n\t</${pf}when>\n\t<${pf}otherwise>\n\t\t$0\n\t</${pf}otherwise>`;

export const XSLT_ELEMENTS: XsltElementDef[] = [
  // stylesheet roots
  { local: 'stylesheet', since: 1, category: 'root', form: 'block', doc: 'The root element of a stylesheet module.', attrs: ROOT_ATTRS, children: ['#decl'] },
  { local: 'transform', since: 1, category: 'root', form: 'block', doc: 'The root element of a stylesheet module (synonym of xsl:stylesheet).', attrs: ROOT_ATTRS, children: ['#decl'] },
  { local: 'package', since: 3, category: 'root', form: 'block', doc: 'The root element of a stylesheet package.', attrs: [...ROOT_ATTRS, a('name'), a('package-version'), a('declared-modes', { values: YN })], children: ['expose', '#decl'] },

  // declarations
  { local: 'import', since: 1, category: 'declaration', form: 'empty', doc: 'Imports another stylesheet module; imported declarations have lower import precedence. Must come before all other declarations.', attrs: [req('href')], children: [] },
  { local: 'include', since: 1, category: 'declaration', form: 'empty', doc: 'Includes the declarations of another stylesheet module.', attrs: [req('href')], children: [] },
  { local: 'strip-space', since: 1, category: 'declaration', form: 'empty', doc: 'Removes whitespace-only text nodes from the listed elements of source documents.', attrs: [req('elements')], children: [] },
  { local: 'preserve-space', since: 1, category: 'declaration', form: 'empty', doc: 'Keeps whitespace-only text nodes in the listed elements of source documents.', attrs: [req('elements')], children: [] },
  { local: 'output', since: 1, category: 'declaration', form: 'empty', doc: 'Declares serialization parameters for the result (or, with a name, an output definition for xsl:result-document).', attrs: [v2('name'), a('version'), ...SERIALIZATION], children: [], snippetAttrs: ['method', 'indent'] },
  { local: 'key', since: 1, category: 'declaration', form: 'empty', doc: 'Declares a key that can be used with the `key()` function.', attrs: [req('name'), req('match'), a('use'), v2('collation'), v3('composite', { values: YN })], children: ['#sc'], snippetAttrs: ['name', 'match', 'use'] },
  { local: 'decimal-format', since: 1, category: 'declaration', form: 'empty', doc: 'Declares a decimal format used by `format-number()`.', attrs: [a('name'), a('decimal-separator'), a('grouping-separator'), a('infinity'), a('minus-sign'), v3('exponent-separator'), a('NaN'), a('percent'), a('per-mille'), a('zero-digit'), a('digit'), a('pattern-separator')], children: [] },
  { local: 'namespace-alias', since: 1, category: 'declaration', form: 'empty', doc: 'Declares that a namespace URI in the stylesheet is replaced by another one in the result.', attrs: [req('stylesheet-prefix'), req('result-prefix')], children: [] },
  { local: 'attribute-set', since: 1, category: 'declaration', form: 'block', doc: 'Defines a named set of attributes.', attrs: [req('name'), a('use-attribute-sets'), v3('visibility', { values: VISIBILITY }), v3('streamable', { values: YN })], children: ['attribute'] },
  { local: 'variable', since: 1, category: 'instruction', form: 'empty', doc: 'Declares a (global or local) variable.', attrs: [req('name'), a('select'), v2('as'), v3('static', { values: YN }), v3('visibility', { values: VISIBILITY })], children: ['#sc'], snippetAttrs: ['name', 'select'] },
  { local: 'param', since: 1, category: 'element', form: 'empty', doc: 'Declares a parameter of the stylesheet, a template, a function or xsl:iterate.', attrs: [req('name'), a('select'), v2('as'), v2('required', { values: YN }), v2('tunnel', { values: YN }), v3('static', { values: YN })], children: ['#sc'] },
  { local: 'template', since: 1, category: 'declaration', form: 'block', doc: 'Defines a template rule (`match`) and/or a named template (`name`).', attrs: [a('match'), a('name'), a('priority'), a('mode'), v2('as'), v3('visibility', { values: VISIBILITY })], children: ['context-item', 'param', '#sc'], snippetAttrs: ['match'] },
  { local: 'function', since: 2, category: 'declaration', form: 'block', doc: 'Defines a stylesheet function that can be called from XPath expressions. The name must be in a namespace.', attrs: [req('name'), a('as'), v3('visibility', { values: VISIBILITY }), v3('streamability', { values: STREAMABILITY }), v3('override-extension-function', { values: YN }), a('override', { values: YN }), v3('new-each-time', { values: ['yes', 'no', 'maybe'] }), v3('cache', { values: YN })], children: ['param', '#sc'], snippetAttrs: ['name', 'as'] },
  { local: 'character-map', since: 2, category: 'declaration', form: 'block', doc: 'Defines a character map used during serialization.', attrs: [req('name'), a('use-character-maps')], children: ['output-character'] },
  { local: 'output-character', since: 2, category: 'element', form: 'empty', doc: 'Maps a character to a string in a character map.', attrs: [req('character'), req('string')], children: [] },
  { local: 'import-schema', since: 2, category: 'declaration', form: 'empty', doc: 'Imports a schema (schema-aware processors only).', attrs: [a('namespace'), a('schema-location')], children: [] },
  { local: 'mode', since: 3, category: 'declaration', form: 'empty', doc: 'Declares a mode and its properties, e.g. the behaviour when no template rule matches.', attrs: [a('name'), a('on-no-match', { values: ['shallow-copy', 'deep-copy', 'deep-skip', 'shallow-skip', 'text-only-copy', 'fail'] }), a('on-multiple-match', { values: ['use-last', 'fail'] }), a('warning-on-no-match', { values: YN }), a('warning-on-multiple-match', { values: YN }), a('streamable', { values: YN }), a('use-accumulators'), a('typed', { values: ['yes', 'no', 'strict', 'lax', 'unspecified'] }), a('visibility', { values: ['public', 'private', 'final'] })], children: [], snippetAttrs: ['on-no-match'] },
  { local: 'accumulator', since: 3, category: 'declaration', form: 'block', doc: 'Declares an accumulator: a value computed during a traversal of a document.', attrs: [req('name'), req('initial-value'), a('as'), a('streamable', { values: YN })], children: ['accumulator-rule'] },
  { local: 'accumulator-rule', since: 3, category: 'element', form: 'empty', doc: 'Computes the new value of an accumulator for matching nodes.', attrs: [req('match'), a('phase', { values: ['start', 'end'] }), a('select')], children: ['#sc'], snippetAttrs: ['match', 'select'] },
  { local: 'global-context-item', since: 3, category: 'declaration', form: 'empty', doc: 'Declares whether and how the global context item is used.', attrs: [a('as'), a('use', { values: USE })], children: [] },
  { local: 'use-package', since: 3, category: 'declaration', form: 'empty', doc: 'Uses the components of another package.', attrs: [req('name'), a('package-version')], children: ['accept', 'override'] },
  { local: 'accept', since: 3, category: 'element', form: 'empty', doc: 'Restricts or changes the visibility of components accepted from a used package.', attrs: [req('component', { values: COMPONENTS }), req('names'), req('visibility', { values: [...VISIBILITY, 'hidden'] })], children: [] },
  { local: 'expose', since: 3, category: 'element', form: 'empty', doc: 'Changes the visibility of components of a package.', attrs: [req('component', { values: COMPONENTS }), req('names'), req('visibility', { values: [...VISIBILITY, 'hidden'] })], children: [] },
  { local: 'override', since: 3, category: 'element', form: 'block', doc: 'Overrides components of a used package.', attrs: [], children: ['template', 'function', 'variable', 'param', 'attribute-set'] },

  // instructions
  { local: 'apply-templates', since: 1, category: 'instruction', form: 'empty', doc: 'Applies template rules to the selected nodes (by default the children of the context node).', attrs: [a('select'), a('mode')], children: ['sort', 'with-param'], snippetAttrs: ['select'] },
  { local: 'call-template', since: 1, category: 'instruction', form: 'empty', doc: 'Invokes a named template.', attrs: [req('name')], children: ['with-param'] },
  { local: 'apply-imports', since: 1, category: 'instruction', form: 'empty', doc: 'Applies the template rules of imported stylesheet modules to the context node.', attrs: [], children: ['with-param'] },
  { local: 'next-match', since: 2, category: 'instruction', form: 'empty', doc: 'Applies the next matching template rule (with lower precedence or priority) to the context node.', attrs: [], children: ['with-param', 'fallback'] },
  { local: 'for-each', since: 1, category: 'instruction', form: 'block', doc: 'Evaluates the sequence constructor for each item of the selected sequence.', attrs: [req('select')], children: ['sort', '#sc'] },
  { local: 'for-each-group', since: 2, category: 'instruction', form: 'block', doc: 'Groups the selected items and evaluates the sequence constructor once per group (`current-group()`, `current-grouping-key()`).', attrs: [req('select'), a('group-by'), a('group-adjacent'), a('group-starting-with'), a('group-ending-with'), v3('composite', { values: YN }), a('collation')], children: ['sort', '#sc'], snippetAttrs: ['select', 'group-by'] },
  { local: 'value-of', since: 1, category: 'instruction', form: 'empty', doc: 'Creates a text node with the string value of the selected items.', attrs: [a('select'), v2('separator'), a('disable-output-escaping', { values: YN })], children: ['#sc'], snippetAttrs: ['select'] },
  { local: 'copy-of', since: 1, category: 'instruction', form: 'empty', doc: 'Copies the selected items (deep copy of nodes).', attrs: [req('select'), v2('copy-namespaces', { values: YN }), v3('copy-accumulators', { values: YN }), v2('type'), v2('validation', { values: VALIDATION })], children: [] },
  { local: 'sequence', since: 2, category: 'instruction', form: 'empty', doc: 'Returns the selected sequence (nodes are not copied).', attrs: [a('select')], children: ['fallback', '#sc'], snippetAttrs: ['select'] },
  { local: 'number', since: 1, category: 'instruction', form: 'empty', doc: 'Creates a formatted number, e.g. the position of the context node.', attrs: [a('value'), v2('select'), a('level', { values: ['single', 'multiple', 'any'] }), a('count'), a('from'), a('format'), a('lang'), a('letter-value', { values: ['alphabetic', 'traditional'] }), v2('ordinal'), v3('start-at'), a('grouping-separator'), a('grouping-size')], children: [] },
  { local: 'choose', since: 1, category: 'instruction', form: 'block', doc: 'Selects the first xsl:when branch whose test is true, otherwise xsl:otherwise.', attrs: [], children: ['when', 'otherwise'], body: choose },
  { local: 'when', since: 1, category: 'element', form: 'block', doc: 'A conditional branch of xsl:choose.', attrs: [req('test')], children: ['#sc'] },
  { local: 'otherwise', since: 1, category: 'element', form: 'block', doc: 'The default branch of xsl:choose.', attrs: [], children: ['#sc'] },
  { local: 'if', since: 1, category: 'instruction', form: 'block', doc: 'Evaluates the sequence constructor only if the test expression is true.', attrs: [req('test')], children: ['#sc'] },
  { local: 'text', since: 1, category: 'instruction', form: 'inline', doc: 'Creates a text node (whitespace is preserved).', attrs: [a('disable-output-escaping', { values: YN })], children: [] },
  { local: 'copy', since: 1, category: 'instruction', form: 'block', doc: 'Creates a shallow copy of the context item; the sequence constructor creates the content.', attrs: [v3('select'), a('use-attribute-sets'), v2('copy-namespaces', { values: YN }), v2('inherit-namespaces', { values: YN }), v2('type'), v2('validation', { values: VALIDATION })], children: ['#sc'], body: pf => `<${pf}apply-templates select="@*, node()"/>$0` },
  { local: 'element', since: 1, category: 'instruction', form: 'block', doc: 'Creates an element node with a computed name.', attrs: [req('name'), a('namespace'), a('use-attribute-sets'), v2('inherit-namespaces', { values: YN }), v2('type'), v2('validation', { values: VALIDATION })], children: ['#sc'] },
  { local: 'attribute', since: 1, category: 'instruction', form: 'inline', doc: 'Creates an attribute node with a computed name.', attrs: [req('name'), a('namespace'), v2('select'), v2('separator'), v2('type'), v2('validation', { values: VALIDATION })], children: ['#sc'] },
  { local: 'namespace', since: 2, category: 'instruction', form: 'inline', doc: 'Creates a namespace node.', attrs: [req('name'), a('select')], children: ['#sc'] },
  { local: 'comment', since: 1, category: 'instruction', form: 'inline', doc: 'Creates a comment node.', attrs: [v2('select')], children: ['#sc'] },
  { local: 'processing-instruction', since: 1, category: 'instruction', form: 'inline', doc: 'Creates a processing instruction node.', attrs: [req('name'), v2('select')], children: ['#sc'] },
  { local: 'message', since: 1, category: 'instruction', form: 'inline', doc: 'Outputs a message (and terminates the transformation with `terminate="yes"`).', attrs: [a('terminate', { values: YN }), v2('select'), v3('error-code')], children: ['#sc'] },
  { local: 'fallback', since: 1, category: 'instruction', form: 'block', doc: 'Fallback for an instruction that is not supported by the processor.', attrs: [], children: ['#sc'] },
  { local: 'perform-sort', since: 2, category: 'instruction', form: 'block', doc: 'Sorts a sequence.', attrs: [a('select')], children: ['sort', '#sc'], snippetAttrs: ['select'], body: pf => `<${pf}sort select="\${2}"/>$0` },
  { local: 'sort', since: 1, category: 'element', form: 'empty', doc: 'A sort key for xsl:apply-templates, xsl:for-each, xsl:for-each-group or xsl:perform-sort.', attrs: [a('select'), a('lang'), a('data-type', { values: ['text', 'number'] }), a('order', { values: ['ascending', 'descending'] }), a('case-order', { values: ['upper-first', 'lower-first'] }), v2('collation'), v2('stable', { values: YN })], children: ['#sc'], snippetAttrs: ['select'] },
  { local: 'with-param', since: 1, category: 'element', form: 'empty', doc: 'Passes a parameter to a template, xsl:iterate or xsl:evaluate.', attrs: [req('name'), a('select'), v2('as'), v2('tunnel', { values: YN })], children: ['#sc'], snippetAttrs: ['name', 'select'] },
  { local: 'result-document', since: 2, category: 'instruction', form: 'block', doc: 'Creates a secondary result document (in XProc available on the `secondary` port of p:xslt).', attrs: [a('href'), a('format'), a('output-version'), a('type'), a('validation', { values: VALIDATION }), ...SERIALIZATION], children: ['#sc'], snippetAttrs: ['href'] },
  { local: 'document', since: 2, category: 'instruction', form: 'block', doc: 'Creates a document node.', attrs: [a('type'), a('validation', { values: VALIDATION })], children: ['#sc'] },
  { local: 'analyze-string', since: 2, category: 'instruction', form: 'block', doc: 'Applies a regular expression to a string (`regex-group()` returns the captured groups).', attrs: [req('select'), req('regex'), a('flags')], children: ['matching-substring', 'non-matching-substring', 'fallback'], body: pf => `<${pf}matching-substring>\n\t\t$0\n\t</${pf}matching-substring>\n\t<${pf}non-matching-substring>\n\t\t<${pf}value-of select="."/>\n\t</${pf}non-matching-substring>` },
  { local: 'matching-substring', since: 2, category: 'element', form: 'block', doc: 'Processes the substrings matched by the regular expression of xsl:analyze-string.', attrs: [], children: ['#sc'] },
  { local: 'non-matching-substring', since: 2, category: 'element', form: 'block', doc: 'Processes the substrings that are not matched by the regular expression of xsl:analyze-string.', attrs: [], children: ['#sc'] },
  { local: 'iterate', since: 3, category: 'instruction', form: 'block', doc: 'Iterates over a sequence, passing parameters from one iteration to the next.', attrs: [req('select')], children: ['param', 'on-completion', '#sc'] },
  { local: 'next-iteration', since: 3, category: 'instruction', form: 'block', doc: 'Continues with the next iteration of xsl:iterate with new parameter values.', attrs: [], children: ['with-param'] },
  { local: 'break', since: 3, category: 'instruction', form: 'empty', doc: 'Terminates xsl:iterate.', attrs: [a('select')], children: ['#sc'] },
  { local: 'on-completion', since: 3, category: 'element', form: 'block', doc: 'Evaluated when xsl:iterate has processed all items (not after xsl:break).', attrs: [a('select')], children: ['#sc'] },
  { local: 'try', since: 3, category: 'instruction', form: 'block', doc: 'Catches dynamic errors raised by the sequence constructor.', attrs: [a('select'), a('rollback-output', { values: YN })], children: ['#sc', 'catch'], body: pf => `$0\n\t<${pf}catch>\n\t\t$1\n\t</${pf}catch>` },
  { local: 'catch', since: 3, category: 'element', form: 'block', doc: 'Handles errors in xsl:try (`$err:code`, `$err:description`, …).', attrs: [a('errors'), a('select')], children: ['#sc'] },
  { local: 'fork', since: 3, category: 'instruction', form: 'block', doc: 'Evaluates several instructions independently (streaming).', attrs: [], children: ['sequence', 'for-each-group', 'fallback'] },
  { local: 'merge', since: 3, category: 'instruction', form: 'block', doc: 'Merges several sorted input sequences.', attrs: [], children: ['merge-source', 'merge-action', 'fallback'] },
  { local: 'merge-source', since: 3, category: 'element', form: 'block', doc: 'An input of xsl:merge.', attrs: [a('name'), a('for-each-item'), a('for-each-source'), req('select'), a('streamable', { values: YN }), a('use-accumulators'), a('sort-before-merge', { values: YN }), a('type'), a('validation', { values: VALIDATION })], children: ['merge-key'] },
  { local: 'merge-key', since: 3, category: 'element', form: 'empty', doc: 'A merge key of xsl:merge-source.', attrs: [a('select'), a('lang'), a('order', { values: ['ascending', 'descending'] }), a('collation'), a('case-order', { values: ['upper-first', 'lower-first'] }), a('data-type', { values: ['text', 'number'] })], children: ['#sc'], snippetAttrs: ['select'] },
  { local: 'merge-action', since: 3, category: 'element', form: 'block', doc: 'Processes each group of merged items (`current-merge-group()`).', attrs: [], children: ['#sc'] },
  { local: 'evaluate', since: 3, category: 'instruction', form: 'empty', doc: 'Evaluates an XPath expression that is constructed dynamically.', attrs: [req('xpath'), a('as'), a('base-uri'), a('with-params'), a('context-item'), a('namespace-context'), a('schema-aware', { values: YN })], children: ['with-param', 'fallback'] },
  { local: 'assert', since: 3, category: 'instruction', form: 'empty', doc: 'Raises an error if the test expression is false (when assertions are enabled).', attrs: [req('test'), a('select'), a('error-code')], children: ['#sc'] },
  { local: 'map', since: 3, category: 'instruction', form: 'block', doc: 'Creates a map from the xsl:map-entry instructions (or maps) in its content.', attrs: [], children: ['#sc'], body: pf => `<${pf}map-entry key="\${1}" select="\${2}"/>$0` },
  { local: 'map-entry', since: 3, category: 'instruction', form: 'empty', doc: 'Creates a map with a single entry.', attrs: [req('key'), a('select')], children: ['#sc'], snippetAttrs: ['key', 'select'] },
  { local: 'source-document', since: 3, category: 'instruction', form: 'block', doc: 'Reads a source document (optionally streamed) and makes it the context item.', attrs: [req('href'), a('streamable', { values: YN }), a('use-accumulators'), a('type'), a('validation', { values: VALIDATION })], children: ['#sc'] },
  { local: 'where-populated', since: 3, category: 'instruction', form: 'block', doc: 'Discards the result of the sequence constructor if it is empty (e.g. an element without content).', attrs: [], children: ['#sc'] },
  { local: 'on-empty', since: 3, category: 'instruction', form: 'inline', doc: 'Evaluated only if the rest of the containing sequence constructor produces an empty result.', attrs: [a('select')], children: ['#sc'] },
  { local: 'on-non-empty', since: 3, category: 'instruction', form: 'inline', doc: 'Evaluated only if the rest of the containing sequence constructor produces a non-empty result.', attrs: [a('select')], children: ['#sc'] },
  { local: 'context-item', since: 3, category: 'element', form: 'empty', doc: 'Declares the required type of the context item of a template.', attrs: [a('as'), a('use', { values: USE })], children: [] },
];

export const DECLARATIONS = ['import', 'include', 'use-package', 'output', 'strip-space', 'preserve-space', 'key', 'decimal-format', 'namespace-alias',
  'character-map', 'import-schema', 'global-context-item', 'mode', 'accumulator', 'attribute-set', 'param', 'variable', 'function', 'template'];

export const INSTRUCTIONS = ['apply-templates', 'call-template', 'value-of', 'copy-of', 'sequence', 'copy', 'element', 'attribute', 'text', 'if', 'choose',
  'for-each', 'for-each-group', 'variable', 'apply-imports', 'next-match', 'number', 'namespace', 'comment', 'processing-instruction', 'message',
  'fallback', 'perform-sort', 'result-document', 'document', 'analyze-string', 'iterate', 'next-iteration', 'break', 'try', 'fork', 'merge', 'evaluate',
  'assert', 'map', 'map-entry', 'source-document', 'where-populated', 'on-empty', 'on-non-empty'];

const byName = new Map(XSLT_ELEMENTS.map(d => [d.local, d]));

export function xsltElement(local: string): XsltElementDef | undefined {
  return byName.get(local);
}

export function xsltSpecUrl(def: XsltElementDef, version: XsltVersion): string {
  if (version === 1 && def.since === 1) {
    return 'https://www.w3.org/TR/xslt-10/';
  }
  return version === 2 && def.since <= 2 ? `https://www.w3.org/TR/xslt20/#element-${def.local}` : `https://www.w3.org/TR/xslt-30/#element-${def.local}`;
}
