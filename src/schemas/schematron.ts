import { getAttr, XElement } from '../xml/parser';
import { a, namesOf, req, SCH_NS, VocabAttrDef, Vocabulary } from './types';

const TF = ['true', 'false'];
const QUERY_BINDINGS = ['xslt3', 'xslt2', 'xslt', 'xpath31', 'xpath3', 'xpath2', 'xpath', 'exslt', 'stx', 'xquery'];
const RICH: VocabAttrDef[] = [a('icon'), a('see'), a('fpi'), a('xml:lang'), a('xml:space', { values: ['preserve', 'default'] })];
const LINKABLE: VocabAttrDef[] = [a('role'), a('subject')];
const TEXT = ['name', 'value-of', 'emph', 'dir', 'span'];

const isSch = (el: XElement | undefined, local: string) => !!el && el.ns === SCH_NS && el.local === local;

export const SCHEMATRON: Vocabulary = {
  ns: SCH_NS,
  name: 'ISO Schematron',
  prefix: 'sch',
  extensions: ['sch'],
  specUrl: 'https://schematron.com/',
  tokenLists: new Set(['diagnostics', 'properties']),
  roots: [{
    local: 'schema', detail: 'ISO Schematron schema',
    attrs: ' queryBinding="${1|xslt3,xslt2,xslt|}"',
    body: pf => `<${pf}pattern>\n\t\t<${pf}rule context="\${2}">\n\t\t\t<${pf}assert test="\${3}">$0</${pf}assert>\n\t\t</${pf}rule>\n\t</${pf}pattern>`,
  }],
  elements: [
    {
      local: 'schema', form: 'block', doc: 'The root element of a Schematron schema.',
      attrs: [a('id'), a('queryBinding', { values: QUERY_BINDINGS }), a('schemaVersion'), a('defaultPhase'), ...RICH],
      children: ['include', 'title', 'ns', 'p', 'let', 'phase', 'pattern', 'diagnostics', 'properties'],
    },
    { local: 'title', form: 'inline', doc: 'The title of the schema or of a pattern.', attrs: [], children: ['dir'] },
    { local: 'ns', form: 'empty', doc: 'Declares a namespace prefix that can be used in the query language expressions.', attrs: [req('prefix'), req('uri')], children: [] },
    { local: 'p', form: 'inline', doc: 'A paragraph of documentation.', attrs: [a('id'), a('class'), a('icon'), a('xml:lang')], children: ['dir', 'emph', 'span'] },
    { local: 'let', form: 'empty', doc: 'Declares a variable (`$name`) whose value is the result of the `value` expression.', attrs: [req('name'), a('value'), a('as')], children: [], snippetAttrs: ['name', 'value'] },
    { local: 'phase', form: 'block', doc: 'A phase: a named set of active patterns, selected for validation with `defaultPhase` or the phase parameter.', attrs: [req('id'), ...RICH], children: ['include', 'p', 'let', 'active'] },
    { local: 'active', form: 'empty', doc: 'Activates a pattern in a phase.', attrs: [req('pattern')], children: ['dir', 'emph', 'span'] },
    {
      local: 'pattern', form: 'block', doc: 'A set of rules. Each node of the document is matched by at most one rule of a pattern.',
      attrs: [a('id'), a('abstract', { values: TF }), a('is-a'), a('documents'), ...RICH], children: ['include', 'title', 'p', 'let', 'rule', 'param'],
    },
    { local: 'param', form: 'empty', doc: 'Passes a parameter to an abstract pattern (in a pattern with `is-a`).', attrs: [req('name'), req('value')], children: [] },
    {
      local: 'rule', form: 'block', doc: 'Specifies the assertions and reports that apply to the nodes matching the `context` expression.',
      attrs: [a('context'), a('id'), a('abstract', { values: TF }), a('flag'), a('visit-each'), ...LINKABLE, ...RICH],
      children: ['include', 'let', 'assert', 'report', 'extends', 'p'], snippetAttrs: ['context'],
    },
    { local: 'extends', form: 'empty', doc: 'Includes the assertions and reports of an abstract rule.', attrs: [a('rule'), a('href')], children: [], snippetAttrs: ['rule'] },
    {
      local: 'assert', form: 'inline', doc: 'An assertion: the message is reported if the `test` expression is **false**.',
      attrs: [req('test'), a('id'), a('flag'), a('diagnostics'), a('properties'), ...LINKABLE, ...RICH], children: TEXT,
    },
    {
      local: 'report', form: 'inline', doc: 'A report: the message is reported if the `test` expression is **true**.',
      attrs: [req('test'), a('id'), a('flag'), a('diagnostics'), a('properties'), ...LINKABLE, ...RICH], children: TEXT,
    },
    { local: 'name', form: 'empty', doc: 'Inserts the name of the context node (or of the node selected by `path`) into the message.', attrs: [a('path')], children: [] },
    { local: 'value-of', form: 'empty', doc: 'Inserts the string value of the `select` expression into the message.', attrs: [req('select')], children: [] },
    { local: 'emph', form: 'inline', doc: 'Emphasized text.', attrs: [], children: [] },
    { local: 'dir', form: 'inline', doc: 'Text with a writing direction.', attrs: [a('value', { values: ['ltr', 'rtl'] })], children: [] },
    { local: 'span', form: 'inline', doc: 'Text with a class.', attrs: [req('class')], children: [] },
    { local: 'diagnostics', form: 'block', doc: 'Contains diagnostic messages referenced by the `diagnostics` attribute of assertions and reports.', attrs: [], children: ['include', 'diagnostic'] },
    { local: 'diagnostic', form: 'inline', doc: 'A detailed diagnostic message for an assertion or report.', attrs: [req('id'), a('role'), ...RICH], children: TEXT },
    { local: 'properties', form: 'block', doc: 'Contains properties referenced by the `properties` attribute of assertions and reports.', attrs: [], children: ['property'] },
    { local: 'property', form: 'inline', doc: 'A property of an assertion or report that is added to the report (e.g. an error code).', attrs: [req('id'), a('role'), a('scheme')], children: TEXT },
    { local: 'include', form: 'empty', doc: 'Includes an external Schematron element.', attrs: [req('href')], children: [] },
  ],

  values({ el, attr, root, add }) {
    if (attr === 'defaultPhase') {
      add('#ALL', 'all patterns');
      namesOf(root, SCH_NS, 'phase', 'id').forEach(n => add(n, 'phase'));
    } else if (attr === 'pattern' && isSch(el, 'active')) {
      namesOf(root, SCH_NS, 'pattern', 'id', e => getAttr(e, 'abstract') !== 'true').forEach(n => add(n, 'pattern'));
    } else if (attr === 'is-a') {
      namesOf(root, SCH_NS, 'pattern', 'id', e => getAttr(e, 'abstract') === 'true').forEach(n => add(n, 'abstract pattern'));
    } else if (attr === 'rule' && isSch(el, 'extends')) {
      namesOf(root, SCH_NS, 'rule', 'id', e => getAttr(e, 'abstract') === 'true').forEach(n => add(n, 'abstract rule'));
    } else if (attr === 'diagnostics') {
      namesOf(root, SCH_NS, 'diagnostic', 'id').forEach(n => add(n, 'diagnostic'));
    } else if (attr === 'properties') {
      namesOf(root, SCH_NS, 'property', 'id').forEach(n => add(n, 'property'));
    } else if (attr === 'prefix' && isSch(el, 'ns')) {
      for (const [p, ns] of el.nsMap) {
        if (p && p !== 'xml' && ns !== SCH_NS) {
          add(p, ns, 'namespace');
        }
      }
    } else if (attr === 'uri' && isSch(el, 'ns')) {
      const ns = el.nsMap.get(getAttr(el, 'prefix') ?? '');
      if (ns) {
        add(ns, undefined, 'namespace');
      }
    }
  },

  /** sch:let variables of the schema, of the enclosing pattern and phase, and of the enclosing rule before el */
  variables({ el, full, root }) {
    const result: { name: string; detail: string }[] = [];
    const add = (l: XElement, detail: string) => {
      const name = getAttr(l, 'name');
      if (name && !result.some(r => r.name === name)) {
        result.push({ name, detail });
      }
    };
    for (let e: XElement | undefined = full; e; e = e.parent) {
      for (const c of e.children) {
        if (c.start >= el.start && e.ns === SCH_NS && e.local === 'rule') {
          break;
        }
        if (isSch(c, 'let') && c.start !== el.start) {
          add(c, `${e.ns === SCH_NS ? e.local : e.name} variable`);
        }
      }
      if (e === root) {
        break;
      }
    }
    return result;
  },
};
