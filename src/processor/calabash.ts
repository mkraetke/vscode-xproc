import * as fs from 'fs';
import * as path from 'path';
import { XElement } from '../xml/parser';
import { XProcVersion } from '../xproc/types';

export type ProcessorKind = 'calabash1' | 'calabash3';

export interface ProcessorConfig {
  javaPath: string;
  javaOptions: string[];
  calabash1: { command: string; jar: string; classpath: string[]; arguments: string[]; detectTranspect: boolean };
  calabash3: { command: string; jar: string; arguments: string[] };
}

export interface Invocation {
  command: string;
  args: string[];
  shell: boolean;
  /** how the processor was found */
  source: string;
}

export const PROCESSOR_NAMES: Record<ProcessorKind, string> = {
  calabash1: 'XML Calabash 1',
  calabash3: 'XML Calabash 3',
};

export function processorFor(version: XProcVersion): ProcessorKind {
  return version === '1.0' ? 'calabash1' : 'calabash3';
}

/** Splits a command line into arguments, honouring single and double quotes. */
export function splitArgs(s: string): string[] {
  const result: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+)/g;
  let cur = '';
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const piece = m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3];
    if (last === m.index && result.length) {
      // adjacent pieces (e.g. --input:source="a b.xml") belong to the same argument
      cur = result.pop()! + piece;
    } else {
      cur = piece;
    }
    result.push(cur);
    last = re.lastIndex;
  }
  return result;
}

export function quoteArg(a: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`;
}

function commandInvocation(cmd: string, source: string): Invocation {
  let command = cmd;
  let args: string[] = [];
  if (!fs.existsSync(cmd)) {
    const parts = splitArgs(cmd);
    if (parts.length > 1) {
      command = parts[0];
      args = parts.slice(1);
    }
  }
  const isWin = process.platform === 'win32';
  if (isWin && /\.(bat|cmd)$/i.test(command)) {
    return { command: `"${command}"`, args, shell: true, source };
  }
  if (!isWin && /\.sh$/.test(command)) {
    let executable = false;
    try {
      fs.accessSync(command, fs.constants.X_OK);
      executable = true;
    } catch {
      // not executable
    }
    if (!executable) {
      return { command: 'bash', args: [command, ...args], shell: false, source };
    }
  }
  return { command, args, shell: false, source };
}

/** Searches the folders above the pipeline for a transpect-style calabash/calabash.sh launcher. */
export function findTranspectLauncher(startDir: string): string | undefined {
  const script = process.platform === 'win32' ? 'calabash.bat' : 'calabash.sh';
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(dir, 'calabash', script);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

export function resolveInvocation(kind: ProcessorKind, cfg: ProcessorConfig, pipelineDir: string): Invocation | { error: string } {
  if (kind === 'calabash1') {
    const c = cfg.calabash1;
    if (c.command) {
      return commandInvocation(c.command, 'setting xproc.calabash1.command');
    }
    if (c.jar) {
      if (!fs.existsSync(c.jar)) {
        return { error: `XML Calabash 1 jar not found: ${c.jar}` };
      }
      const cp = [c.jar, ...c.classpath].join(path.delimiter);
      return { command: cfg.javaPath, args: [...cfg.javaOptions, '-cp', cp, 'com.xmlcalabash.drivers.Main'], shell: false, source: 'setting xproc.calabash1.jar' };
    }
    if (c.detectTranspect) {
      const launcher = findTranspectLauncher(pipelineDir);
      if (launcher) {
        return commandInvocation(launcher, `transpect launcher ${launcher}`);
      }
    }
    return { error: 'XML Calabash 1 is not configured. Set "xproc.calabash1.command" (e.g. a calabash.sh launcher) or "xproc.calabash1.jar".' };
  }
  const c = cfg.calabash3;
  if (c.command) {
    return commandInvocation(c.command, 'setting xproc.calabash3.command');
  }
  if (c.jar) {
    if (!fs.existsSync(c.jar)) {
      return { error: `XML Calabash 3 jar not found: ${c.jar}` };
    }
    return { command: cfg.javaPath, args: [...cfg.javaOptions, '-jar', c.jar], shell: false, source: 'setting xproc.calabash3.jar' };
  }
  return { error: 'XML Calabash 3 is not configured. Set "xproc.calabash3.jar" (xmlcalabash-app-3.x.jar) or "xproc.calabash3.command".' };
}

/**
 * Arranges the run arguments: flags go before the pipeline, option assignments (name=value) after it.
 * Single-letter flags (Calabash 1 style, e.g. "-i source=doc.xml") take the following token as value.
 */
export function buildRunArgs(extraArgs: string[], userArgs: string[], pipeline: string): string[] {
  const pre: string[] = [];
  const post: string[] = [];
  for (let i = 0; i < userArgs.length; i++) {
    const t = userArgs[i];
    if (t.startsWith('-')) {
      pre.push(t);
      if (/^-[A-Za-z]$/.test(t) && i + 1 < userArgs.length) {
        pre.push(userArgs[++i]);
      }
    } else if (/^[^=\s]+=/.test(t)) {
      post.push(t);
    } else {
      pre.push(t);
    }
  }
  return [...extraArgs, ...pre, pipeline, ...post];
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** A pipeline that only imports the given pipeline/library, so that the processor compiles it without running it. */
export function validationWrapper(kind: ProcessorKind, href: string): string {
  return kind === 'calabash1'
    ? `<p:declare-step xmlns:p="http://www.w3.org/ns/xproc" version="1.0"><p:import href="${escapeXml(href)}"/><p:sink><p:input port="source"><p:empty/></p:input></p:sink></p:declare-step>\n`
    : `<p:declare-step xmlns:p="http://www.w3.org/ns/xproc" version="3.1"><p:import href="${escapeXml(href)}"/><p:sink><p:with-input><p:empty/></p:with-input></p:sink></p:declare-step>\n`;
}

export const INJECTED_TYPE = ' type="vscxv:validate" xmlns:vscxv="urn:x-vscode-xproc:validate"';

/** XProc 1.0 can only import pipelines with a type: inserts a type attribute (on the same line, so line numbers stay intact). */
export function injectType(text: string, root: XElement): { text: string; offset: number; length: number } {
  const offset = root.nameEnd;
  return { text: text.substring(0, offset) + INJECTED_TYPE + text.substring(offset), offset, length: INJECTED_TYPE.length };
}

export interface ProcessorMessage {
  /** file URI or path */
  file?: string;
  /** 1-based */
  line?: number;
  /** 1-based */
  column?: number;
  code?: string;
  message: string;
  severity: 'error' | 'warning';
}

export function parseProcessorOutput(output: string): ProcessorMessage[] {
  const result: ProcessorMessage[] = [];
  let last: ProcessorMessage | undefined;
  let explained = false;
  const push = (m: ProcessorMessage) => {
    m.message = m.message.trim();
    if (!result.some(r => r.file === m.file && r.line === m.line && r.message === m.message)) {
      result.push(m);
      last = m;
      explained = false;
    }
  };
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      continue;
    }
    let m: RegExpExecArray | null;
    // XML Calabash 3: "Error: err:XS0044 at file:/x.xpl:5:15: No declaration for step …"
    if ((m = /err:([A-Za-z]+\d{4})\s+at\s+(\S+?):(\d+):(\d+):?\s*(.*)$/.exec(line))) {
      push({ code: m[1], file: m[2], line: +m[3], column: +m[4], message: m[5], severity: 'error' });
      continue;
    }
    // XML Calabash 1 with location: "ERROR: file:/x.xpl:1:68:err:XS0053:No type attribute …"
    if ((m = /((?:file|https?):\S+?):(-?\d+):(-?\d+):\s*(?:err:)?([A-Za-z]+\d{4})?:?\s*(.*)$/.exec(line))) {
      push({ file: m[1], line: +m[2] > 0 ? +m[2] : undefined, column: +m[3] > 0 ? +m[3] : undefined, code: m[4], message: m[5], severity: 'error' });
      continue;
    }
    // SAX parse errors
    if ((m = /systemId:\s*(\S+?);\s*lineNumber:\s*(\d+);\s*columnNumber:\s*(\d+);\s*(.*)$/.exec(line))) {
      push({ file: m[1], line: +m[2], column: +m[3], message: m[4], severity: 'error', code: last?.code });
      continue;
    }
    // without location: "ERROR: err:XS0044:Unexpected step name: p:identty" / "Error: err:XD0011 …"
    if ((m = /^(?:\w+:\s*)?err:([A-Za-z]+\d{4})\s*:?\s*(.*)$/.exec(line))) {
      push({ code: m[1], message: m[2], severity: 'error' });
      continue;
    }
    if (last && !explained && /^ERROR:\s+\S/.test(line) && !/^ERROR:\s+(cause|Underlying)/.test(line)) {
      const text = line.replace(/^ERROR:\s*/, '');
      if (text !== 'Unknown error') {
        last.message += ` — ${text}`;
      }
      explained = true;
    }
  }
  return result;
}
