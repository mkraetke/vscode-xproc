import * as assert from 'assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import { pathToFileURL } from 'url';
import { buildRunArgs, injectType, parseProcessorOutput, splitArgs } from '../processor/calabash';
import { tagClosedAt } from '../xml/autoClose';
import { parseXml } from '../xml/parser';
import { complete } from '../xproc/completion';
import { definition, hover, symbols } from '../xproc/features';
import { analyze } from '../xproc/model';
import { validate } from '../xproc/validator';

const P = 'xmlns:p="http://www.w3.org/ns/xproc"';
const opts = { defaultVersion: '3.1' as const, catalogs: [] };
const model = (text: string, uri = 'file:///tmp/test.xpl') => analyze(text, uri, opts);
const errors = (text: string) => validate(model(text)).map(d => `${d.severity}:${d.code ?? ''}:${d.message}`);

/** completion at the position of "|" */
function completeAt(textWithCursor: string) {
  const offset = textWithCursor.indexOf('|');
  const text = textWithCursor.replace('|', '');
  return complete(model(text), offset);
}
const labels = (textWithCursor: string) => completeAt(textWithCursor)?.items.map(i => i.label) ?? [];

test('parser: positions, namespaces and well-formedness errors', () => {
  const doc = parseXml(`<a xmlns:x="u"><x:b c="1 &amp; 2"/></a>`);
  assert.equal(doc.errors.length, 0);
  const b = doc.root!.children[0];
  assert.equal(b.ns, 'u');
  assert.equal(b.attrs[0].value, '1 & 2');
  assert.equal(doc.text.substring(b.attrs[0].valueStart, b.attrs[0].valueEnd), '1 &amp; 2');

  assert.match(parseXml('<a><b></a>').errors[0].message, /<b> is not closed/);
  assert.match(parseXml('<a x="1" x="2"/>').errors[0].message, /Duplicate attribute/);
  assert.match(parseXml('<y:a/>').errors[0].message, /not bound/);
  assert.match(parseXml('<a>&</a>').errors[0].message, /Unescaped/);
});

test('parser: partial input for completion', () => {
  let doc = parseXml('<a><p:ad');
  assert.equal(doc.partial?.kind, 'start');
  assert.equal(doc.partial?.state, 'name');
  assert.equal(doc.openStack[0].name, 'a');
  doc = parseXml('<a><b c="x" d="ab');
  assert.equal(doc.partial?.state, 'attrValue');
  assert.equal(doc.partial?.attrName, 'd');
  doc = parseXml('<a><b c="x" ');
  assert.equal(doc.partial?.state, 'inTag');
});

test('validator: valid 3.1 pipeline has no diagnostics', () => {
  const text = `<p:declare-step ${P} version="3.1" name="main">
  <p:input port="source"/>
  <p:output port="result" pipe="result@xslt"/>
  <p:option name="debug" select="false()"/>
  <p:add-attribute attribute-name="a" attribute-value="1"/>
  <p:xslt name="xslt">
    <p:with-input port="stylesheet" href="x.xsl"/>
    <p:with-option name="parameters" select="map{}"/>
  </p:xslt>
  <p:for-each name="loop">
    <p:identity><p:with-input pipe="current@loop"/></p:identity>
  </p:for-each>
  <p:sink/>
</p:declare-step>`;
  assert.deepEqual(errors(text), []);
});

test('validator: valid 1.0 pipeline has no diagnostics', () => {
  const text = `<p:declare-step ${P} xmlns:cx="http://xmlcalabash.com/ns/extensions" version="1.0" name="main">
  <p:input port="source"/>
  <p:input port="parameters" kind="parameter"/>
  <p:output port="result"><p:pipe port="result" step="xslt"/></p:output>
  <p:import href="http://xmlcalabash.com/extension/steps/library-1.0.xpl"/>
  <p:xslt name="xslt">
    <p:input port="stylesheet"><p:document href="x.xsl"/></p:input>
    <p:input port="source"><p:pipe port="source" step="main"/></p:input>
    <p:with-param name="a" select="1"/>
  </p:xslt>
  <cx:message message="hi"/>
  <p:sink/>
</p:declare-step>`;
  assert.deepEqual(errors(text), []);
});

test('validator: static errors', () => {
  const text = `<p:declare-step ${P} version="3.1">
  <p:identty/>
  <p:add-attribute attribute-value="1" foo="bar"/>
  <p:identity name="a"><p:with-input port="nope"/></p:identity>
  <p:identity name="a"/>
  <p:sink><p:with-input pipe="result@missing"/></p:sink>
  <p:pipeline/>
</p:declare-step>`;
  const e = errors(text).join('\n');
  assert.match(e, /XS0044:Unknown XProc element or step <p:identty>/);
  assert.match(e, /XS0018:Required option "attribute-name"/);
  assert.match(e, /XS0031:Step <p:add-attribute> has no option "foo"/);
  assert.match(e, /XS0010:.*no input port "nope"/);
  assert.match(e, /XS0002:Duplicate step name "a"/);
  assert.match(e, /XS0022:There is no step named "missing"/);
  assert.match(e, /p:pipeline> exists only in XProc 1.0/);
});

test('validator: version specific elements and missing version', () => {
  assert.match(errors(`<p:declare-step ${P} version="1.0"><p:if test="1"/></p:declare-step>`).join(), /not available in XProc 1.0/);
  assert.match(errors(`<p:declare-step ${P} version="3.0"><p:message select="1"/></p:declare-step>`).join(), /requires XProc 3.1/);
  assert.match(errors(`<p:declare-step ${P}/>`).join(), /XS0062/);
});

test('validator: imported library steps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xproc-test-'));
  fs.writeFileSync(path.join(dir, 'lib.xpl'), `<p:library ${P} xmlns:ex="urn:ex" version="3.1">
  <p:declare-step type="ex:hello"><p:input port="source"/><p:output port="result"/><p:option name="who" required="true"/><p:identity/></p:declare-step>
</p:library>`);
  const uri = pathToFileURL(path.join(dir, 'main.xpl')).href;
  const text = `<p:declare-step ${P} xmlns:ex="urn:ex" version="3.1">
  <p:import href="lib.xpl"/>
  <ex:hello/>
  <ex:unknown/>
</p:declare-step>`;
  const m = model(text, uri);
  assert.equal(m.steps.size, 1);
  const e = validate(m).map(d => d.message).join('\n');
  assert.match(e, /Required option "who" of step <ex:hello>/);
  assert.match(e, /No declaration found for step <ex:unknown>/);

  const r = complete(model(text.replace('<ex:hello/>', '<ex:hello/><'), uri), text.indexOf('<ex:hello/>') + '<ex:hello/><'.length);
  const hello = r!.items.find(i => i.label === 'ex:hello');
  assert.ok(hello, 'declared step is offered');
  assert.match(hello!.insertText, /who="\$\{1\}"/);

  const d = definition(m, text.indexOf('ex:hello') + 2);
  assert.equal(d?.uri, pathToFileURL(path.join(dir, 'lib.xpl')).href);
});

test('completion: elements and steps in a 3.x subpipeline', () => {
  const l = labels(`<p:declare-step ${P} version="3.1">\n  <p:|\n</p:declare-step>`);
  for (const x of ['p:input', 'p:output', 'p:option', 'p:for-each', 'p:xslt', 'p:file-copy', 'p:with-input', '/p:declare-step']) {
    if (x === 'p:with-input') {
      assert.ok(!l.includes(x), 'p:with-input is not allowed in p:declare-step');
    } else {
      assert.ok(l.includes(x), `${x} expected`);
    }
  }
  assert.ok(!l.includes('p:pipeline'));
  const xslt = completeAt(`<p:declare-step ${P} version="3.1">\n  <p:|\n</p:declare-step>`)!.items.find(i => i.label === 'p:xslt')!;
  assert.match(xslt.insertText, /<p:with-input port="stylesheet"/);
});

test('completion: XProc 1.0 vocabulary', () => {
  const l = labels(`<p:declare-step ${P} version="1.0">\n  <p:xslt>\n    <p:|\n  </p:xslt>\n</p:declare-step>`);
  assert.deepEqual(l.filter(x => !x.startsWith('/')).sort(), ['p:documentation', 'p:input', 'p:log', 'p:pipeinfo', 'p:with-option', 'p:with-param']);
  const steps = labels(`<p:declare-step ${P} version="1.0">\n  <p:|\n</p:declare-step>`);
  assert.ok(steps.includes('p:pipeline') && steps.includes('p:exec') && !steps.includes('p:if'));
});

test('completion: attributes, ports, step names and option values', () => {
  const base = (body: string) => `<p:declare-step ${P} version="3.1" name="main">\n<p:input port="source"/>\n${body}\n</p:declare-step>`;
  const attrs = completeAt(base('<p:add-attribute |/>'))!.items.sort((a, b) => a.sortText!.localeCompare(b.sortText!));
  assert.deepEqual(attrs.slice(0, 2).map(i => i.label), ['attribute-name', 'attribute-value']);
  assert.ok(labels(base('<p:add-attribute |/>')).includes('match'));
  assert.deepEqual(labels(base('<p:xslt><p:with-input port="|"/></p:xslt>')), ['source', 'stylesheet']);
  assert.deepEqual(labels(base('<p:identity name="id"/><p:sink><p:with-input><p:pipe step="|"/></p:with-input></p:sink>')), ['main', 'id']);
  assert.deepEqual(labels(base('<p:identity name="id"/><p:sink><p:with-input><p:pipe step="id" port="|"/></p:with-input></p:sink>')), ['result']);
  assert.deepEqual(labels(base('<p:identity name="id"/><p:sink><p:with-input><p:pipe step="main" port="|"/></p:with-input></p:sink>')), ['source']);
  assert.ok(labels(base('<p:identity name="id"/><p:sink><p:with-input pipe="|"/></p:sink>')).includes('result@id'));
  assert.deepEqual(labels(base('<p:insert position="|"/>')), ['first-child', 'last-child', 'before', 'after']);
  assert.ok(labels(base('<p:xslt><p:with-option name="|"/></p:xslt>')).includes('parameters'));
});

test('completion: close tag and root element', () => {
  assert.deepEqual(labels(`<p:declare-step ${P} version="3.1"><p:group></|`), ['p:group']);
  assert.ok(labels('<|').includes('p:declare-step (XProc 3.1)'));
});

const XSL = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"';
const xslt3 = (body: string) => `<p:declare-step ${P} version="3.1">
  <p:xslt>
    <p:with-input port="stylesheet">
      <p:inline>
        <xsl:stylesheet ${XSL} version="3.0">
          ${body}
        </xsl:stylesheet>
      </p:inline>
    </p:with-input>
  </p:xslt>
</p:declare-step>`;

test('completion: xsl:stylesheet in the stylesheet port of p:xslt', () => {
  const inline = labels(`<p:declare-step ${P} version="3.1"><p:xslt><p:with-input port="stylesheet"><p:inline><|</p:inline></p:with-input></p:xslt></p:declare-step>`);
  assert.deepEqual(inline.filter(l => !l.startsWith('/')), ['xsl:stylesheet (XSLT 3.0)', 'xsl:stylesheet (XSLT 2.0)', 'xsl:stylesheet (XSLT 1.0)']);
  const implicit = completeAt(`<p:declare-step ${P} version="3.1"><p:xslt><p:with-input port="stylesheet"><|</p:with-input></p:xslt></p:declare-step>`)!;
  const ss = implicit.items.find(i => i.label === 'xsl:stylesheet (XSLT 3.0)')!;
  assert.match(ss.insertText, /xmlns:xsl="http:\/\/www.w3.org\/1999\/XSL\/Transform".* version="3.0">/);
  assert.ok(implicit.items.some(i => i.label === 'p:inline'), 'XProc connections are still offered');
  const v1 = labels(`<p:declare-step ${P} version="1.0"><p:xslt><p:input port="stylesheet"><p:inline><|</p:inline></p:input></p:xslt></p:declare-step>`);
  assert.ok(v1.includes('xsl:stylesheet (XSLT 2.0)'));
  assert.ok(!labels(`<p:declare-step ${P} version="3.1"><p:xslt><p:with-input port="source"><p:inline><|</p:inline></p:with-input></p:xslt></p:declare-step>`)
    .some(l => l.startsWith('xsl:')));
});

test('completion: XSLT elements, version specific', () => {
  const top = labels(xslt3('<xsl:|'));
  for (const x of ['xsl:template', 'xsl:function', 'xsl:mode', 'xsl:import', 'xsl:output', '/xsl:stylesheet']) {
    assert.ok(top.includes(x), `${x} expected`);
  }
  assert.ok(!top.includes('xsl:value-of'), 'instructions are not allowed at the top level');
  const inTemplate = labels(xslt3('<xsl:template match="/"><|</xsl:template>'));
  for (const x of ['xsl:apply-templates', 'xsl:value-of', 'xsl:iterate', 'xsl:param', 'xsl:choose', '/xsl:template']) {
    assert.ok(inTemplate.includes(x), `${x} expected`);
  }
  assert.ok(!inTemplate.includes('xsl:break') && !inTemplate.includes('xsl:when') && !inTemplate.includes('p:identity'));
  assert.ok(labels(xslt3('<xsl:template match="/"><xsl:iterate select="*"><|</xsl:iterate></xsl:template>')).includes('xsl:break'));
  assert.deepEqual(labels(xslt3('<xsl:template match="/"><xsl:choose><|</xsl:choose></xsl:template>')).sort(), ['/xsl:choose', 'xsl:otherwise', 'xsl:when']);
  // literal result elements contain a sequence constructor
  assert.ok(labels(xslt3('<xsl:template match="/"><html><body><|</body></html></xsl:template>')).includes('xsl:for-each'));

  const v1 = labels(xslt3('<xsl:template match="/"><|</xsl:template>').replace('version="3.0"', 'version="1.0"'));
  assert.ok(v1.includes('xsl:value-of') && !v1.includes('xsl:sequence') && !v1.includes('xsl:iterate'));
  const v2 = labels(xslt3('<xsl:|').replace('version="3.0"', 'version="2.0"'));
  assert.ok(v2.includes('xsl:function') && !v2.includes('xsl:mode'));

  const tpl = completeAt(xslt3('<xsl:|'))!.items.find(i => i.label === 'xsl:template')!;
  assert.equal(tpl.insertText, 'xsl:template match="${1}">\n\t$0\n</xsl:template>');
  const ct = completeAt(xslt3('<xsl:template match="/"><|</xsl:template>'))!.items.find(i => i.label === 'xsl:call-template')!;
  assert.equal(ct.insertText, 'xsl:call-template name="${1}"/>');
});

test('completion: XSLT attributes and values', () => {
  const attrs = labels(xslt3('<xsl:template match="/"><xsl:apply-templates |/></xsl:template>'));
  assert.ok(attrs.includes('select') && attrs.includes('mode') && attrs.includes('use-when') && !attrs.includes('match'));
  const lre = labels(xslt3('<xsl:template match="/"><div |/></xsl:template>'));
  assert.ok(lre.includes('xsl:use-attribute-sets') && lre.includes('xsl:expand-text'));
  assert.deepEqual(labels(xslt3('<xsl:output method="|"/>')), ['xml', 'html', 'xhtml', 'text', 'json', 'adaptive']);
  assert.ok(labels(xslt3('<xsl:mode on-no-match="|"/>')).includes('shallow-copy'));

  const body = `<xsl:variable name="g" select="1"/>
    <xsl:attribute-set name="as1"/>
    <xsl:template name="named"><xsl:param name="p1"/><xsl:param name="p2"/></xsl:template>
    <xsl:template match="x" mode="m1 m2"><xsl:variable name="local" select="1"/>CURSOR</xsl:template>
    <xsl:variable name="later" select="2"/>`;
  const at = (s: string) => labels(xslt3(body.replace('CURSOR', s)));
  assert.deepEqual(at('<xsl:call-template name="|"/>'), ['named']);
  assert.deepEqual(at('<xsl:call-template name="named"><xsl:with-param name="p1"/><xsl:with-param name="|"/></xsl:call-template>'), ['p2']);
  assert.deepEqual(at('<xsl:apply-templates mode="|"/>'), ['#current', '#unnamed', 'm1', 'm2']);
  assert.deepEqual(at('<div xsl:use-attribute-sets="|"/>'), ['as1']);
  assert.deepEqual(at('<xsl:value-of select="concat($|"/>'), ['$local', '$g', '$later']);
  const r = completeAt(xslt3(body.replace('CURSOR', '<xsl:value-of select="$lo|cal"/>')))!;
  const text = xslt3(body.replace('CURSOR', '<xsl:value-of select="$local"/>'));
  assert.equal(text.substring(r.replaceStart, r.replaceEnd), '$local');
  assert.deepEqual(at('<a href="{$|}"/>'), ['$local', '$g', '$later']);
});

test('XSLT: hover, implicit inline and validation', () => {
  const text = xslt3('<xsl:template match="/"><xsl:apply-templates/></xsl:template>');
  const h = hover(model(text), text.indexOf('xsl:apply-templates') + 4);
  assert.match(h!.markdown, /\*\*xsl:apply-templates\*\* — XSLT instruction/);
  assert.match(h!.markdown, /xslt-30\/#element-apply-templates/);

  const implicit = `<p:declare-step ${P} version="3.1">
  <p:xslt>
    <p:with-input port="stylesheet">
      <xsl:stylesheet ${XSL} version="3.0">
        <xsl:template match="/"><p:declare-step version="3.1"><p:foo/></p:declare-step></xsl:template>
      </xsl:stylesheet>
    </p:with-input>
  </p:xslt>
</p:declare-step>`;
  assert.deepEqual(errors(implicit), [], 'literal result elements in the XProc namespace are not validated');
  assert.ok(labels(implicit.replace('<p:foo/>', '<p:foo/><|')).includes('xsl:value-of'));
});

const SCH = 'xmlns:sch="http://purl.oclc.org/dsdl/schematron"';
const RNG = 'xmlns="http://relaxng.org/ns/structure/1.0"';
const XS = 'xmlns:xs="http://www.w3.org/2001/XMLSchema"';
const schemaPort = (step: string, body: string, version = '3.1') => {
  const port = version === '1.0' ? 'p:input' : 'p:with-input';
  return `<p:declare-step ${P} version="${version}"><p:${step}><${port} port="schema">${body}</${port}></p:${step}></p:declare-step>`;
};
const inline = (step: string, body: string) => schemaPort(step, `<p:inline>${body}</p:inline>`);
const rootLabels = (text: string) => labels(text).filter(l => !l.startsWith('/') && !l.startsWith('p:'));

test('completion: schema root elements in the schema port of the validation steps', () => {
  assert.deepEqual(rootLabels(inline('validate-with-schematron', '<|')), ['sch:schema']);
  assert.deepEqual(rootLabels(inline('validate-with-relax-ng', '<|')), ['grammar', 'element']);
  assert.deepEqual(rootLabels(inline('validate-with-xml-schema', '<|')), ['xs:schema (XSD 1.0)', 'xs:schema (XSD 1.1)']);
  assert.deepEqual(rootLabels(schemaPort('validate-with-schematron', '<p:inline><|</p:inline>', '1.0')), ['sch:schema']);
  // XProc 3: implicit inline, XProc connections are still offered
  const implicit = labels(schemaPort('validate-with-xml-schema', '<|'));
  assert.ok(implicit.includes('xs:schema (XSD 1.0)') && implicit.includes('p:inline'));
  // no schemas on other ports or steps
  assert.deepEqual(rootLabels(`<p:declare-step ${P} version="3.1"><p:validate-with-schematron><p:with-input port="source"><p:inline><|</p:inline></p:with-input></p:validate-with-schematron></p:declare-step>`), []);
  assert.deepEqual(rootLabels(`<p:declare-step ${P} version="3.1"><p:identity><p:with-input port="schema"><p:inline><|</p:inline></p:with-input></p:identity></p:declare-step>`), []);

  const sch = completeAt(inline('validate-with-schematron', '<|'))!.items[0];
  assert.match(sch.insertText, /^sch:schema xmlns:sch="http:\/\/purl.oclc.org\/dsdl\/schematron" queryBinding="\$\{1\|xslt3,xslt2,xslt\|\}">/);
  const rng = completeAt(inline('validate-with-relax-ng', '<|'))!.items[0];
  assert.match(rng.insertText, /^grammar xmlns="http:\/\/relaxng.org\/ns\/structure\/1.0" datatypeLibrary="[^"]+">\n\t<start>/);
  const xsd11 = completeAt(inline('validate-with-xml-schema', '<|'))!.items[1];
  assert.match(xsd11.insertText, /xmlns:xs="http:\/\/www.w3.org\/2001\/XMLSchema" xmlns:vc="[^"]+" elementFormDefault="qualified" vc:minVersion="1.1"/);
  // a prefix declared in the pipeline is used
  const declared = completeAt(`<p:declare-step ${P} xmlns:s="http://purl.oclc.org/dsdl/schematron" version="3.1"><p:validate-with-schematron><p:with-input port="schema"><p:inline><|</p:inline></p:with-input></p:validate-with-schematron></p:declare-step>`)!.items[0];
  assert.match(declared.insertText, /^s:schema queryBinding/);
});

test('completion: Schematron', () => {
  const sch = (body: string) => inline('validate-with-schematron', `<sch:schema ${SCH} queryBinding="xslt2">${body}</sch:schema>`);
  const top = labels(sch('<|'));
  for (const x of ['sch:pattern', 'sch:ns', 'sch:let', 'sch:phase', 'sch:diagnostics', '/sch:schema']) {
    assert.ok(top.includes(x), `${x} expected`);
  }
  assert.ok(!top.includes('sch:assert') && !top.includes('p:identity'));
  assert.deepEqual(labels(sch('<sch:pattern><sch:rule context="x"><sch:assert test="y"><|</sch:assert></sch:rule></sch:pattern>')).sort(),
    ['/sch:assert', 'sch:dir', 'sch:emph', 'sch:name', 'sch:span', 'sch:value-of']);
  const rule = completeAt(sch('<sch:pattern><|</sch:pattern>'))!.items.find(i => i.label === 'sch:rule')!;
  assert.equal(rule.insertText, 'sch:rule context="${1}">\n\t$0\n</sch:rule>');
  assert.ok(labels(sch('<sch:pattern><sch:rule |')).includes('context'));
  assert.deepEqual(labels(`<p:declare-step ${P} version="3.1"><p:validate-with-schematron><p:with-input port="schema"><sch:schema ${SCH} queryBinding="|"/></p:with-input></p:validate-with-schematron></p:declare-step>`).slice(0, 3),
    ['xslt3', 'xslt2', 'xslt']);

  const body = `<sch:let name="g" value="1"/><sch:phase id="ph1"><sch:active pattern="|"/></sch:phase>
    <sch:pattern id="p1"><sch:rule context="x"><sch:let name="r" value="1"/><sch:assert test="$|" diagnostics="d1 |">m</sch:assert></sch:rule></sch:pattern>
    <sch:pattern id="abs" abstract="true"/>
    <sch:diagnostics><sch:diagnostic id="d1">a</sch:diagnostic><sch:diagnostic id="d2">b</sch:diagnostic></sch:diagnostics>`;
  const at = (n: number) => {
    let i = -1;
    for (let k = 0; k <= n; k++) {
      i = body.indexOf('|', i + 1);
    }
    return labels(sch(body.substring(0, i).replace(/\|/g, '') + '|' + body.substring(i + 1).replace(/\|/g, '')));
  };
  assert.deepEqual(at(0), ['p1']);
  assert.deepEqual(at(1), ['$r', '$g']);
  assert.deepEqual(at(2), ['d1', 'd2']);
});

test('completion: RELAX NG', () => {
  const rng = (body: string) => inline('validate-with-relax-ng', `<grammar ${RNG} datatypeLibrary="http://www.w3.org/2001/XMLSchema-datatypes">${body}</grammar>`);
  assert.deepEqual(labels(rng('<|')).sort(), ['/grammar', 'define', 'div', 'include', 'start']);
  const inStart = labels(rng('<start><|</start>'));
  assert.ok(inStart.includes('element') && inStart.includes('zeroOrMore') && inStart.includes('ref') && !inStart.includes('anyName'));
  // name classes only where a name class is expected
  assert.ok(labels(rng('<start><element><|</element></start>')).includes('anyName'));
  assert.ok(!labels(rng('<start><element name="a"><|</element></start>')).includes('anyName'));
  assert.deepEqual(labels(rng('<start><element><choice><|</choice></element></start>')).sort(), ['/choice', 'anyName', 'choice', 'name', 'nsName']);
  assert.ok(labels(rng('<start><element name="a"><choice><|</choice></element></start>')).includes('oneOrMore'));

  assert.deepEqual(labels(rng('<start><ref name="|"/></start><define name="d1"/><define name="d2"/>')), ['d1', 'd2']);
  assert.ok(labels(rng('<start><element name="a"><data type="|"/></element></start>')).includes('dateTime'));
  assert.deepEqual(labels(inline('validate-with-relax-ng', `<element ${RNG} name="a"><data type="|"/></element>`)), ['string', 'token']);
  assert.ok(labels(rng('<start><element |')).includes('datatypeLibrary'));
});

test('completion: XML Schema', () => {
  const xsd = (body: string, attrs = '') => inline('validate-with-xml-schema', `<xs:schema ${XS} xmlns:t="urn:t" targetNamespace="urn:t"${attrs}>${body}</xs:schema>`);
  const top = labels(xsd('<|'));
  for (const x of ['xs:element', 'xs:complexType', 'xs:simpleType', 'xs:import', 'xs:annotation', '/xs:schema']) {
    assert.ok(top.includes(x), `${x} expected`);
  }
  assert.ok(!top.includes('xs:sequence'));
  assert.ok(labels(xsd('<xs:complexType><|')).includes('xs:sequence'));
  const simple = labels(xsd('<xs:simpleType><xs:restriction base="xs:string"><|</xs:restriction></xs:simpleType>'));
  assert.ok(simple.includes('xs:enumeration') && simple.includes('xs:pattern') && !simple.includes('xs:sequence'));
  const complex = labels(xsd('<xs:complexType><xs:complexContent><xs:restriction base="t:x"><|</xs:restriction></xs:complexContent></xs:complexType>'));
  assert.ok(complex.includes('xs:sequence') && !complex.includes('xs:enumeration'));
  assert.equal(completeAt(xsd('<|'))!.items.find(i => i.label === 'xs:element')!.insertText, 'xs:element name="${1}" type="${2}"/>');

  const types = labels(xsd('<xs:complexType name="ct"/><xs:simpleType name="st"/><xs:element name="e" type="|"/>'));
  assert.deepEqual(types.slice(0, 3), ['t:ct', 't:st', 'xs:anyType']);
  assert.ok(types.includes('xs:string') && !types.includes('xs:dateTimeStamp'));
  assert.ok(labels(xsd('<xs:element name="e" type="|"/>', ' xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning" vc:minVersion="1.1"')).includes('xs:dateTimeStamp'));
  const attrTypes = labels(xsd('<xs:complexType name="ct"/><xs:simpleType name="st"/><xs:attribute name="a" type="|"/>'));
  assert.ok(attrTypes.includes('t:st') && !attrTypes.includes('t:ct') && !attrTypes.includes('xs:anyType'));
  assert.deepEqual(labels(xsd('<xs:element name="root"/><xs:complexType><xs:sequence><xs:element ref="|"/></xs:sequence></xs:complexType>')), ['t:root']);
  assert.deepEqual(labels(xsd('<xs:element name="e" maxOccurs="|"/>')), ['1', 'unbounded']);
});

test('schemas: hover, href completion and validation', () => {
  const text = inline('validate-with-schematron', `<sch:schema ${SCH}><sch:pattern><sch:rule context="x"/></sch:pattern></sch:schema>`);
  assert.match(hover(model(text), text.indexOf('sch:rule') + 4)!.markdown, /\*\*sch:rule\*\* — ISO Schematron element/);
  assert.match(hover(model(text), text.indexOf('context') + 2)!.markdown, /\*\*context\*\* — attribute of `sch:rule`/);

  const href = completeAt(schemaPort('validate-with-relax-ng', '<p:document href="|"/>'))!;
  assert.deepEqual(href.hrefCompletion?.extensions, ['rng', 'rnc']);
  assert.deepEqual(completeAt(schemaPort('validate-with-xml-schema', '', '3.1').replace('port="schema"', 'port="schema" href="|"'))!.hrefCompletion?.extensions, ['xsd']);

  const implicit = `<p:declare-step ${P} version="3.1">
  <p:validate-with-xml-schema>
    <p:with-input port="schema">
      <xs:schema ${XS}><xs:annotation><xs:appinfo><p:foo/></xs:appinfo></xs:annotation></xs:schema>
    </p:with-input>
  </p:validate-with-xml-schema>
</p:declare-step>`;
  assert.deepEqual(errors(implicit), [], 'the content of implicitly inlined schemas is not validated');
  assert.equal(symbols(model(implicit))[0].children.length, 1);
});

test('hover and symbols', () => {
  const text = `<p:declare-step ${P} version="3.1" name="main"><p:xslt name="x"/></p:declare-step>`;
  const m = model(text);
  const h = hover(m, text.indexOf('p:xslt') + 3);
  assert.match(h!.markdown, /\*\*p:xslt\*\*/);
  assert.match(h!.markdown, /stylesheet/);
  const s = symbols(m);
  assert.equal(s[0].name, 'main');
  assert.equal(s[0].children[0].name, 'p:xslt x');
});

test('processor: output parsing', () => {
  const c3 = parseProcessorOutput('Error: err:XS0044 at file:/tmp/t3.xpl:5:15: No declaration for step “p:identty”.');
  assert.deepEqual(c3[0], { code: 'XS0044', file: 'file:/tmp/t3.xpl', line: 5, column: 15, message: 'No declaration for step “p:identty”.', severity: 'error' });
  const c1 = parseProcessorOutput('ERROR: err:XS0044:Unexpected step name: p:identty\nERROR: It is a static error if any element in the XProc namespace …');
  assert.equal(c1.length, 1);
  assert.equal(c1[0].code, 'XS0044');
  assert.match(c1[0].message, /Unexpected step name: p:identty — It is a static error/);
  const c1loc = parseProcessorOutput('ERROR: file:/tmp/t1.xpl:1:68:err:XS0053:No type attribute on imported pipeline.');
  assert.equal(c1loc[0].line, 1);
  assert.equal(c1loc[0].code, 'XS0053');
  const sax = parseProcessorOutput('ERROR:     cause: org.xml.sax.SAXParseException; systemId: file:/tmp/t1b.xpl; lineNumber: 3; columnNumber: 3; The element type "p:sink" must be terminated');
  assert.equal(sax[0].line, 3);
});

test('auto-close tags', () => {
  const t = `<p:declare-step ${P} version="3.1"><p:group name="g">`;
  assert.equal(tagClosedAt(t, t.length), 'p:group');
  assert.equal(tagClosedAt(t + '</p:group>', t.length), undefined);
  const s = `<p:declare-step ${P} version="3.1"><p:sink/>`;
  assert.equal(tagClosedAt(s, s.length), undefined);
  const a = `<p:declare-step ${P} version="3.1"><p:if test="a > b"`;
  assert.equal(tagClosedAt(a, a.indexOf('>', a.indexOf('test')) + 1), undefined);
});

test('processor: arguments', () => {
  assert.deepEqual(splitArgs('--input:source="a b.xml" x=1 \'y z\''), ['--input:source=a b.xml', 'x=1', 'y z']);
  assert.deepEqual(buildRunArgs(['--debug'], splitArgs('-i source=doc.xml opt=1 --nogo'), 'p.xpl'), ['--debug', '-i', 'source=doc.xml', '--nogo', 'p.xpl', 'opt=1']);
  const doc = parseXml(`<p:declare-step ${P} version="1.0"/>`);
  const r = injectType(doc.text, doc.root!);
  assert.match(r.text, /^<p:declare-step type="vscxv:validate"/);
});
