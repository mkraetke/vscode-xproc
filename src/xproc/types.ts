export const XPROC_NS = 'http://www.w3.org/ns/xproc';
export const XPROC_STEP_NS = 'http://www.w3.org/ns/xproc-step';
export const XPROC_ERROR_NS = 'http://www.w3.org/ns/xproc-error';
export const CX_NS = 'http://xmlcalabash.com/ns/extensions';
export const PXF_NS = 'http://exproc.org/proposed/steps/file';
export const PXP_NS = 'http://exproc.org/proposed/steps';
export const POS_NS = 'http://exproc.org/proposed/steps/os';

export type XProcVersion = '1.0' | '3.0' | '3.1';

export function isV3(v: XProcVersion): boolean {
  return v !== '1.0';
}

export interface PortDef {
  port: string;
  input: boolean;
  primary: boolean;
  sequence: boolean;
  parameter?: boolean;
  /** the port has a default binding (does not need to be connected) */
  hasDefault?: boolean;
}

export interface OptionDef {
  name: string;
  required?: boolean;
  select?: string;
  values?: string[];
  as?: string;
  doc?: string;
}

export interface StepDef {
  ns: string;
  local: string;
  /** preferred prefix */
  prefix: string;
  ports: PortDef[];
  options: OptionDef[];
  doc?: string;
  /** library the step belongs to (e.g. "standard", "file", "calabash", or a file path for declared steps) */
  group: string;
  specUrl?: string;
  declaredIn?: { uri: string; start: number; end: number };
}

export const clark = (ns: string, local: string) => `{${ns}}${local}`;

/**
 * Port notation: '<' input, '>' output, followed by the port name and flags:
 * '*' sequence, '-' explicitly not primary, '+' explicitly primary,
 * '%' parameter input (XProc 1.0), '~' has a default binding.
 * Without flags the first document input / first output is primary.
 */
export function parsePorts(spec: string): PortDef[] {
  const ports: PortDef[] = [];
  let firstIn = true;
  let firstOut = true;
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    const input = tok[0] === '<';
    const m = /^[<>]([\w.-]*[\w.])([*\-+%~]*)$/.exec(tok);
    if (!m) {
      throw new Error(`bad port spec ${tok}`);
    }
    const flags = m[2];
    const parameter = flags.includes('%');
    let primary: boolean;
    if (flags.includes('+')) {
      primary = true;
    } else if (flags.includes('-') || parameter) {
      primary = false;
    } else {
      primary = input ? firstIn : firstOut;
    }
    if (!parameter) {
      if (input) {
        firstIn = false;
      } else {
        firstOut = false;
      }
    }
    ports.push({ port: m[1], input, primary, sequence: flags.includes('*'), parameter: parameter || undefined, hasDefault: flags.includes('~') || undefined });
  }
  return ports;
}

/** Option notation: name[!][:v1|v2|…][=default]; '!' marks required options. */
export function parseOption(spec: string | OptionDef): OptionDef {
  if (typeof spec !== 'string') {
    return spec;
  }
  const m = /^([\w.-]+)(!?)(?::([^=]*))?(?:=(.*))?$/.exec(spec);
  if (!m) {
    throw new Error(`bad option spec ${spec}`);
  }
  return {
    name: m[1],
    required: m[2] === '!' || undefined,
    values: m[3] ? m[3].split('|') : undefined,
    select: m[4],
  };
}

export const BOOL = 'true|false';

export interface StepSpecGroup {
  group: string;
  ns: string;
  prefix: string;
  specBase?: string;
}

export function makeSteps(g: StepSpecGroup, defs: [string, string, string, (string | OptionDef)[]][]): StepDef[] {
  return defs.map(([local, doc, ports, options]) => ({
    ns: g.ns,
    local,
    prefix: g.prefix,
    doc,
    ports: parsePorts(ports),
    options: options.map(parseOption),
    group: g.group,
    specUrl: g.specBase ? `${g.specBase}#c.${local}` : undefined,
  }));
}

export interface AttrDef {
  name: string;
  required?: boolean;
  values?: string[];
  doc?: string;
}

export interface CoreElementDef {
  local: string;
  doc: string;
  attrs: AttrDef[];
  /** allowed XProc children (local names) */
  children: string[];
  /** may contain steps (a subpipeline) */
  steps?: boolean;
  /** arbitrary content (p:inline, p:documentation, p:pipeinfo) */
  anyContent?: boolean;
  /** compound step or pipeline container that may be named and referenced */
  container?: boolean;
  /** element that usually has content (used for snippets) */
  block?: boolean;
  specUrl?: string;
}
