import * as vscode from 'vscode';
import { registerLanguageFeatures } from './languageFeatures';
import { ProcessorService } from './processorService';
import { ModelCache } from './modelCache';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('XProc');
  const models = new ModelCache();
  const processor = new ProcessorService(context, output, models);

  context.subscriptions.push(output, processor);
  registerLanguageFeatures(context, models);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'xproc.showProcessorInfo';
  context.subscriptions.push(statusBar);
  const updateStatus = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !models.isXProcDocument(editor.document)) {
      statusBar.hide();
      return;
    }
    const model = models.get(editor.document);
    statusBar.text = `$(symbol-namespace) XProc ${model.version}`;
    statusBar.tooltip = `${model.versionAttr ? '' : '(no version attribute) '}Runs with ${model.version === '1.0' ? 'XML Calabash 1' : 'XML Calabash 3'} — click for processor configuration`;
    statusBar.show();
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        updateStatus();
      }
    }),
    vscode.workspace.onDidCloseTextDocument(d => models.delete(d)),
  );
  updateStatus();

  context.subscriptions.push(
    vscode.commands.registerCommand('xproc.run', (uri?: vscode.Uri) => processor.run(uri, false)),
    vscode.commands.registerCommand('xproc.runWithArguments', (uri?: vscode.Uri) => processor.run(uri, true)),
    vscode.commands.registerCommand('xproc.validate', (uri?: vscode.Uri) => processor.validateCommand(uri)),
    vscode.commands.registerCommand('xproc.stop', () => processor.stop()),
    vscode.commands.registerCommand('xproc.showProcessorInfo', () => processor.showInfo()),
  );
}

export function deactivate() {
  // nothing to do
}
