import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as vscode from 'vscode';
import { ModelCache, resolvePathSetting, substituteVariables } from './modelCache';
import {
  buildRunArgs, injectType, Invocation, PROCESSOR_NAMES, ProcessorConfig, ProcessorKind, ProcessorMessage, parseProcessorOutput,
  processorFor, quoteArg, resolveInvocation, splitArgs, validationWrapper,
} from './processor/calabash';
import { elementAt, getAttr } from './xml/parser';
import { isXProc, signatureOf, XProcModel } from './xproc/model';

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}

export class ProcessorService implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('xproc-calabash');
  private running?: ChildProcess;
  private readonly validations = new Map<string, ChildProcess>();
  private readonly reportedConfigErrors = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel, private readonly models: ModelCache) {
    this.disposables.push(
      this.diagnostics,
      vscode.workspace.onDidSaveTextDocument(d => this.onSave(d)),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.contentChanges.length && this.diagnostics.has(e.document.uri)) {
          this.diagnostics.delete(e.document.uri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument(d => this.diagnostics.delete(d.uri)),
    );
  }

  dispose() {
    this.stop();
    for (const p of this.validations.values()) {
      p.kill();
    }
    this.disposables.forEach(d => d.dispose());
  }

  private config(document: vscode.TextDocument): ProcessorConfig {
    const cfg = vscode.workspace.getConfiguration('xproc', document.uri);
    const p = (key: string) => resolvePathSetting(cfg.get<string>(key, ''), document);
    const list = (key: string) => cfg.get<string[]>(key, []).map(s => substituteVariables(s, document));
    return {
      javaPath: p('java.path') || 'java',
      javaOptions: list('java.options'),
      calabash1: {
        command: p('calabash1.command'),
        jar: p('calabash1.jar'),
        classpath: cfg.get<string[]>('calabash1.classpath', []).map(s => resolvePathSetting(s, document)),
        arguments: list('calabash1.arguments'),
        detectTranspect: cfg.get<boolean>('calabash1.detectTranspect', true),
      },
      calabash3: {
        command: p('calabash3.command'),
        jar: p('calabash3.jar'),
        arguments: list('calabash3.arguments'),
      },
    };
  }

  private async documentFor(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
    if (uri) {
      return vscode.workspace.openTextDocument(uri);
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open an XProc pipeline first.');
      return undefined;
    }
    return editor.document;
  }

  private invocation(document: vscode.TextDocument, model: XProcModel): { kind: ProcessorKind; inv?: Invocation; error?: string; extra: string[] } {
    const kind = processorFor(model.version);
    const cfg = this.config(document);
    const r = resolveInvocation(kind, cfg, path.dirname(document.uri.fsPath));
    const extra = kind === 'calabash1' ? cfg.calabash1.arguments : cfg.calabash3.arguments;
    return 'error' in r ? { kind, error: r.error, extra } : { kind, inv: r, extra };
  }

  private async configurationError(kind: ProcessorKind, message: string) {
    const choice = await vscode.window.showErrorMessage(message, 'Open Settings');
    if (choice === 'Open Settings') {
      vscode.commands.executeCommand('workbench.action.openSettings', `xproc.${kind}`);
    }
  }

  private workingDirectory(document: vscode.TextDocument): string {
    const mode = vscode.workspace.getConfiguration('xproc', document.uri).get<string>('run.workingDirectory', 'workspaceFolder');
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return mode === 'workspaceFolder' && folder ? folder.uri.fsPath : path.dirname(document.uri.fsPath);
  }

  private exec(inv: Invocation, args: string[], cwd: string, onData?: (s: string, err: boolean) => void, track?: (p: ChildProcess) => void, token?: vscode.CancellationToken): Promise<ExecResult> {
    return new Promise(resolve => {
      let stdout = '';
      let stderr = '';
      let cancelled = false;
      let child: ChildProcess;
      try {
        child = spawn(inv.command, [...inv.args, ...args].map(a => (inv.shell ? quoteArg(a) : a)), { cwd, shell: inv.shell, env: process.env });
      } catch (e) {
        resolve({ code: -1, stdout: '', stderr: String(e), cancelled: false });
        return;
      }
      track?.(child);
      token?.onCancellationRequested(() => {
        cancelled = true;
        child.kill();
      });
      child.stdout?.on('data', (b: Buffer) => {
        const s = b.toString();
        stdout += s;
        onData?.(s, false);
      });
      child.stderr?.on('data', (b: Buffer) => {
        const s = b.toString();
        stderr += s;
        onData?.(s, true);
      });
      child.on('error', e => {
        stderr += `\n${e.message}\n`;
        onData?.(`${e.message}\n`, true);
      });
      child.on('close', code => resolve({ code, stdout, stderr, cancelled }));
    });
  }

  // ------------------------------------------------------------------------------------------
  // run

  private argsKey(document: vscode.TextDocument) {
    return `xproc.args:${document.uri.toString()}`;
  }

  private argumentTemplate(model: XProcModel, kind: ProcessorKind): string {
    const root = model.doc.root;
    if (!root || !(isXProc(root, 'declare-step') || isXProc(root, 'pipeline'))) {
      return '';
    }
    const sig = signatureOf(root, model.version);
    const parts: string[] = [];
    for (const p of sig.ports.filter(x => x.input && !x.parameter && !x.hasDefault)) {
      parts.push(kind === 'calabash3' ? `--input:${p.port}=` : `-i ${p.port}=`);
    }
    for (const o of sig.options.filter(x => x.required || x.select === undefined)) {
      parts.push(`${o.name}=`);
    }
    return parts.join(' ');
  }

  async run(uri: vscode.Uri | undefined, askArguments: boolean) {
    const document = await this.documentFor(uri);
    if (!document) {
      return;
    }
    if (this.running) {
      const choice = await vscode.window.showWarningMessage('A pipeline is already running.', 'Stop and Run', 'Cancel');
      if (choice !== 'Stop and Run') {
        return;
      }
      this.stop();
    }
    const cfg = vscode.workspace.getConfiguration('xproc', document.uri);
    if (document.isDirty && cfg.get<boolean>('run.saveBeforeRun', true)) {
      await document.save();
    }
    if (document.uri.scheme !== 'file') {
      vscode.window.showErrorMessage('Only pipelines stored in the file system can be run.');
      return;
    }
    const model = this.models.get(document);
    const { kind, inv, error, extra } = this.invocation(document, model);
    if (!inv) {
      await this.configurationError(kind, error!);
      return;
    }

    let userArgs = this.context.workspaceState.get<string>(this.argsKey(document));
    if (askArguments) {
      const value = await vscode.window.showInputBox({
        title: `Run ${path.basename(document.uri.fsPath)} with ${PROCESSOR_NAMES[kind]}`,
        prompt: kind === 'calabash3'
          ? 'Arguments, e.g. --input:source=doc.xml --output:result=out.xml option=value'
          : 'Arguments, e.g. -i source=doc.xml -o result=out.xml option=value',
        value: userArgs ?? this.argumentTemplate(model, kind),
        ignoreFocusOut: true,
      });
      if (value === undefined) {
        return;
      }
      userArgs = value.trim();
      await this.context.workspaceState.update(this.argsKey(document), userArgs);
    }

    const args = buildRunArgs(extra, splitArgs(userArgs ?? ''), document.uri.fsPath);
    const cwd = this.workingDirectory(document);
    this.output.show(true);
    this.output.appendLine('');
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] Running ${path.basename(document.uri.fsPath)} (XProc ${model.version}) with ${PROCESSOR_NAMES[kind]}`);
    this.output.appendLine(`> ${[inv.command, ...inv.args, ...args].map(quoteArg).join(' ')}`);
    this.output.appendLine(`  (cwd: ${cwd})`);
    this.diagnostics.clear();

    const started = Date.now();
    const showResult = cfg.get<boolean>('run.showResultInEditor', true);
    vscode.commands.executeCommand('setContext', 'xproc.running', true);
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Running ${path.basename(document.uri.fsPath)} with ${PROCESSOR_NAMES[kind]}…`,
      cancellable: true,
    }, (_progress, token) => this.exec(inv, args, cwd,
      // stdout is only echoed if it is not shown in an editor
      (s, isErr) => (isErr || !showResult) && this.output.append(s),
      p => (this.running = p), token));
    this.running = undefined;
    vscode.commands.executeCommand('setContext', 'xproc.running', false);

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const messages = parseProcessorOutput(result.stderr + '\n' + (result.code === 0 ? '' : result.stdout));
    this.publish(document, model, messages);
    if (result.cancelled) {
      this.output.appendLine(`Cancelled after ${seconds}s.`);
      return;
    }
    if (result.code === 0) {
      this.output.appendLine(`Finished successfully in ${seconds}s.`);
      if (showResult && result.stdout.trim()) {
        const out = result.stdout.trim();
        const language = out.startsWith('<') ? 'xml' : /^[[{]/.test(out) ? 'json' : 'plaintext';
        const doc = await vscode.workspace.openTextDocument({ content: result.stdout, language });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true });
      } else {
        vscode.window.setStatusBarMessage(`$(check) Pipeline finished in ${seconds}s`, 5000);
      }
    } else {
      if (showResult && result.stdout) {
        this.output.append(result.stdout);
      }
      this.output.appendLine(`Failed with exit code ${result.code} after ${seconds}s.`);
      const choice = await vscode.window.showErrorMessage(
        `Pipeline failed${messages[0] ? `: ${messages[0].code ? `err:${messages[0].code} ` : ''}${messages[0].message}` : ` (exit code ${result.code})`}`, 'Show Output');
      if (choice === 'Show Output') {
        this.output.show();
      }
    }
  }

  stop() {
    if (this.running) {
      this.running.kill();
      this.running = undefined;
      vscode.commands.executeCommand('setContext', 'xproc.running', false);
    }
  }

  // ------------------------------------------------------------------------------------------
  // validation

  private onSave(document: vscode.TextDocument) {
    if (!this.models.isXProcDocument(document) || document.uri.scheme !== 'file') {
      return;
    }
    if (!vscode.workspace.getConfiguration('xproc', document.uri).get<boolean>('validation.processorOnSave', true)) {
      return;
    }
    this.validate(document, true);
  }

  async validateCommand(uri?: vscode.Uri) {
    const document = await this.documentFor(uri);
    if (document) {
      await this.validate(document, false);
    }
  }

  async validate(document: vscode.TextDocument, silent: boolean) {
    if (document.uri.scheme !== 'file') {
      if (!silent) {
        vscode.window.showErrorMessage('Only pipelines stored in the file system can be validated with XML Calabash.');
      }
      return;
    }
    const model = this.models.get(document);
    const root = model.doc.root;
    if (!root || !model.isXProc) {
      if (!silent) {
        vscode.window.showErrorMessage('The document is not an XProc pipeline or library.');
      }
      return;
    }
    const { kind, inv, error, extra } = this.invocation(document, model);
    if (!inv) {
      if (!silent) {
        await this.configurationError(kind, error!);
      } else if (!this.reportedConfigErrors.has(kind)) {
        this.reportedConfigErrors.add(kind);
        this.output.appendLine(`Validation on save skipped: ${error}`);
      }
      return;
    }

    const key = document.uri.toString();
    this.validations.get(key)?.kill();

    const file = document.uri.fsPath;
    const dir = path.dirname(file);
    const isLibrary = root.local === 'library';
    const needsType = kind === 'calabash1' && !isLibrary && !getAttr(root, 'type');
    let tempCopy: string | undefined;
    let wrapper: string | undefined;
    let target = file;
    let shift: { line: number; column: number; length: number } | undefined;
    try {
      if (document.isDirty || needsType) {
        let text = document.getText();
        if (needsType) {
          const injected = injectType(text, root);
          text = injected.text;
          const pos = document.positionAt(injected.offset);
          shift = { line: pos.line + 1, column: pos.character + 1, length: injected.length };
        }
        tempCopy = path.join(dir, `.${path.basename(file, path.extname(file))}.vscode-xproc-${process.pid}-${Date.now()}.xpl`);
        fs.writeFileSync(tempCopy, text, 'utf8');
        target = tempCopy;
      }
      let runTarget = target;
      if (kind === 'calabash1' || isLibrary) {
        wrapper = path.join(os.tmpdir(), `vscode-xproc-validate-${process.pid}-${Date.now()}.xpl`);
        fs.writeFileSync(wrapper, validationWrapper(kind, pathToFileURL(target).href), 'utf8');
        runTarget = wrapper;
      }
      const args = kind === 'calabash3' ? [...extra, '--nogo', runTarget] : [...extra, runTarget];

      const run = this.exec(inv, args, dir, undefined, p => this.validations.set(key, p));
      const result = silent
        ? await run
        : await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Validating with ${PROCESSOR_NAMES[kind]}…` }, () => run);
      if (this.validations.get(key)?.exitCode === null) {
        return; // superseded
      }
      this.validations.delete(key);
      if (result.code === null) {
        return; // killed
      }

      const messages = parseProcessorOutput(result.stderr + '\n' + result.stdout);
      for (const m of messages) {
        const p = m.file ? toPath(m.file) : undefined;
        if (p && wrapper && samePath(p, wrapper)) {
          m.file = file;
          m.line = undefined;
          m.column = undefined;
        } else if (p && tempCopy && samePath(p, tempCopy)) {
          m.file = file;
        } else if (p) {
          m.file = p;
        }
        if (shift && m.file === file && m.line === shift.line && m.column && m.column > shift.column) {
          m.column = Math.max(shift.column, m.column - shift.length);
        }
      }
      if (result.code !== 0 && !messages.length) {
        messages.push({ message: `${PROCESSOR_NAMES[kind]} exited with code ${result.code}: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ')}`, severity: 'error' });
      }
      this.publish(document, model, messages);
      if (!silent || messages.length) {
        this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${PROCESSOR_NAMES[kind]} validation of ${path.basename(file)}: ${messages.length ? `${messages.length} problem(s)` : 'no problems'}`);
        if (messages.length) {
          this.output.append(result.stderr);
        }
      }
      if (!silent) {
        if (messages.length) {
          vscode.window.showWarningMessage(`${PROCESSOR_NAMES[kind]} reported ${messages.length} problem(s) in ${path.basename(file)}.`);
        } else {
          vscode.window.showInformationMessage(`${path.basename(file)} is valid (${PROCESSOR_NAMES[kind]}, XProc ${model.version}).`);
        }
      }
    } catch (e) {
      if (!silent) {
        vscode.window.showErrorMessage(`Validation failed: ${e}`);
      }
    } finally {
      for (const f of [tempCopy, wrapper]) {
        if (f) {
          fs.rm(f, { force: true }, () => undefined);
        }
      }
    }
  }

  private publish(document: vscode.TextDocument, model: XProcModel, messages: ProcessorMessage[]) {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    const docPath = document.uri.fsPath;
    for (const m of messages) {
      const p = m.file ? toPath(m.file) ?? m.file : docPath;
      const isDoc = samePath(p, docPath);
      let range: vscode.Range;
      if (isDoc) {
        range = this.locate(document, model, m);
      } else if (m.line) {
        range = new vscode.Range(m.line - 1, Math.max(0, (m.column ?? 1) - 1), m.line - 1, Number.MAX_SAFE_INTEGER);
      } else {
        range = new vscode.Range(0, 0, 0, 0);
      }
      const diag = new vscode.Diagnostic(range, m.message, m.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      diag.source = 'xml-calabash';
      if (m.code) {
        diag.code = `err:${m.code}`;
      }
      const key = isDoc ? docPath : p;
      byFile.set(key, [...(byFile.get(key) ?? []), diag]);
    }
    this.diagnostics.delete(document.uri);
    for (const [f, diags] of byFile) {
      this.diagnostics.set(vscode.Uri.file(f), diags);
    }
  }

  /** Finds a good range for a processor message in the pipeline document. */
  private locate(document: vscode.TextDocument, model: XProcModel, m: ProcessorMessage): vscode.Range {
    if (m.line) {
      const line = Math.min(m.line - 1, document.lineCount - 1);
      const offset = document.offsetAt(new vscode.Position(line, Math.max(0, (m.column ?? 1) - 1)));
      const el = elementAt(model.doc, Math.max(0, offset - 1));
      if (el && el.start < offset && offset <= el.startTagEnd) {
        return new vscode.Range(document.positionAt(el.start + 1), document.positionAt(el.nameEnd));
      }
      return document.lineAt(line).range;
    }
    // no location: look for names mentioned in the message
    const text = document.getText();
    const candidates = [...m.message.matchAll(/[“"']([^”"']+)[”"']|\b([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b/g)].map(x => x[1] ?? x[2]);
    for (const c of candidates) {
      for (const needle of [`<${c}`, `"${c}"`, `'${c}'`]) {
        const i = text.indexOf(needle);
        if (i >= 0) {
          const start = i + 1;
          return new vscode.Range(document.positionAt(start), document.positionAt(start + c.length));
        }
      }
    }
    const root = model.doc.root;
    return root ? new vscode.Range(document.positionAt(root.start + 1), document.positionAt(root.nameEnd)) : new vscode.Range(0, 0, 0, 0);
  }

  // ------------------------------------------------------------------------------------------

  async showInfo() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.models.isXProcDocument(editor.document)) {
      vscode.window.showInformationMessage('Open an XProc pipeline to see which processor is used.');
      return;
    }
    const document = editor.document;
    const model = this.models.get(document);
    const { kind, inv, error, extra } = this.invocation(document, model);
    this.output.show(true);
    this.output.appendLine('');
    this.output.appendLine(`Pipeline:    ${document.uri.fsPath}`);
    this.output.appendLine(`Version:     XProc ${model.version}${model.versionAttr ? '' : ' (no version attribute, using xproc.defaultVersion)'}`);
    this.output.appendLine(`Processor:   ${PROCESSOR_NAMES[kind]}`);
    if (inv) {
      this.output.appendLine(`Found via:   ${inv.source}`);
      this.output.appendLine(`Command:     ${[inv.command, ...inv.args, ...extra].map(quoteArg).join(' ')} <pipeline>`);
    } else {
      this.output.appendLine(`Error:       ${error}`);
    }
    const catalogs = this.models.catalogsFor(document);
    this.output.appendLine(`Catalogs:    ${catalogs.length ? catalogs.join(', ') : '(none)'}`);
    this.output.appendLine(`Imports:     ${model.imports.length ? model.imports.map(i => `${i.href}${i.error ? ' (unresolved)' : ''}`).join(', ') : '(none)'}`);
    this.output.appendLine(`Steps known from declarations/imports: ${model.steps.size}`);
  }
}

function toPath(f: string): string | undefined {
  if (f.startsWith('file:')) {
    try {
      return fileURLToPath(f);
    } catch {
      return undefined;
    }
  }
  return path.isAbsolute(f) ? f : undefined;
}

function samePath(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}
