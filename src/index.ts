import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { INotebookTracker } from '@jupyterlab/notebook';
import { CodeMirrorEditor } from '@jupyterlab/codemirror';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { ISettingRegistry } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';

import { FileEditorJumper } from '@krassowski/jupyterlab_go_to_definition/lib/jumpers/fileeditor';
import { NotebookJumper } from '@krassowski/jupyterlab_go_to_definition/lib/jumpers/notebook';

import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/hint/show-hint';
import '../style/index.css';

import 'lsp-editor-adapter/lib/codemirror-lsp.css';
import { ICompletionManager } from '@jupyterlab/completer';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { NotebookAdapter } from './adapters/jupyterlab/notebook';
import { FileEditorAdapter } from './adapters/jupyterlab/file_editor';
import { lsp_features } from './adapters/jupyterlab/jl_adapter';
import { IFeatureCommand } from './adapters/codemirror/feature';
import {
  file_editor_adapters,
  FileEditorCommandManager,
  notebook_adapters,
  NotebookCommandManager
} from './command_manager';

const lsp_commands: Array<IFeatureCommand> = [].concat(
  ...lsp_features.map(feature => feature.commands)
);

/**
 * The plugin registration information.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@krassowski/jupyterlab-lsp:plugin',
  requires: [
    IEditorTracker,
    INotebookTracker,
    ISettingRegistry,
    ICommandPalette,
    IDocumentManager,
    ICompletionManager,
    IRenderMimeRegistry
  ],
  activate: (
    app: JupyterFrontEnd,
    fileEditorTracker: IEditorTracker,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry,
    palette: ICommandPalette,
    documentManager: IDocumentManager,
    completion_manager: ICompletionManager,
    rendermime_registry: IRenderMimeRegistry
  ) => {
    fileEditorTracker.widgetUpdated.connect((sender, widget) => {
      console.log(sender);
      console.log(widget);
      // TODO?
      // adapter.remove();
      // connection.close();
    });

    fileEditorTracker.widgetAdded.connect((sender, widget) => {
      let fileEditor = widget.content;

      if (fileEditor.editor instanceof CodeMirrorEditor) {
        let jumper = new FileEditorJumper(widget, documentManager);
        let adapter = new FileEditorAdapter(
          widget,
          jumper,
          app,
          completion_manager,
          rendermime_registry
        );
        file_editor_adapters.set(fileEditor.id, adapter);
      }
    });

    let command_manager = new FileEditorCommandManager(
      app,
      fileEditorTracker,
      'file_editor'
    );
    command_manager.add(lsp_commands);

    notebookTracker.widgetAdded.connect((sender, widget) => {
      // NOTE: assuming that the default cells content factory produces CodeMirror editors(!)
      let jumper = new NotebookJumper(widget, documentManager);
      let adapter = new NotebookAdapter(
        widget,
        jumper,
        app,
        completion_manager,
        rendermime_registry
      );
      notebook_adapters.set(widget.id, adapter);
    });

    // TODO de-duplicate commands creation, use some kind of an interface or factory

    // position context menu entries after 10th but before 11th default entry
    // this lets it be before "Clear outputs" which is the last entry of the
    // CodeCell contextmenu and plays nicely with the first notebook entry
    // ('Clear all outputs') thus should stay as the last one.
    // see https://github.com/blink1073/jupyterlab/blob/3592afd328116a588e3307b4cdd9bcabc7fe92bb/packages/notebook-extension/src/index.ts#L802
    // TODO: PR bumping rank of clear all outputs instead?
    let notebook_command_manager = new NotebookCommandManager(
      app,
      notebookTracker,
      'notebook',
      10,
      lsp_commands.length + 2
    );
    notebook_command_manager.add_context_separator(Number.EPSILON);
    notebook_command_manager.add(lsp_commands);

    function updateOptions(settings: ISettingRegistry.ISettings): void {
      // let options = settings.composite;
      // Object.keys(options).forEach((key) => {
      //  if (key === 'modifier') {
      //    // let modifier = options[key] as KeyModifier;
      //    CodeMirrorExtension.modifierKey = modifier;
      //  }
      // });
    }

    settingRegistry
      .load(plugin.id)
      .then(settings => {
        updateOptions(settings);
        settings.changed.connect(() => {
          updateOptions(settings);
        });
      })
      .catch((reason: Error) => {
        console.error(reason.message);
      });
  },
  autoStart: true
};

/**
 * Export the plugin as default.
 */
export default plugin;
