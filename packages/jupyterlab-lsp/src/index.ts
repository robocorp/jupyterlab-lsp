import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { Signal } from '@lumino/signaling';
import { LanguageServerManager } from './manager';
import '../style/index.css';
import { ContextCommandManager } from './command_manager';
import { IStatusBar } from '@jupyterlab/statusbar';
import { LSPStatus } from './components/statusbar';
import { DocumentConnectionManager } from './connection_manager';
import {
  IAdapterTypeOptions,
  ILSPAdapterManager,
  ILSPCodeExtractorsManager,
  ILSPFeatureManager,
  ILSPVirtualEditorManager,
  PLUGIN_ID,
  TLanguageServerConfigurations
} from './tokens';
import { IFeature } from './feature';
import { JUMP_PLUGIN } from './features/jump_to';
import { SIGNATURE_PLUGIN } from './features/signature';
import { HOVER_PLUGIN } from './features/hover';
import { RENAME_PLUGIN } from './features/rename';
import { HIGHLIGHTS_PLUGIN } from './features/highlights';
import { WIDGET_ADAPTER_MANAGER } from './adapter_manager';
import { FILE_EDITOR_ADAPTER } from './adapters/file_editor';
import { NOTEBOOK_ADAPTER } from './adapters/notebook';
import { VIRTUAL_EDITOR_MANAGER } from './virtual/editor';
import IPaths = JupyterFrontEnd.IPaths;
import { CODEMIRROR_VIRTUAL_EDITOR } from './virtual/codemirror_editor';
import { LabIcon } from '@jupyterlab/ui-components';
import codeCheckSvg from '../style/icons/code-check.svg';
import { DIAGNOSTICS_PLUGIN } from './features/diagnostics';
import { COMPLETION_PLUGIN } from './features/completion';
import { CODE_EXTRACTORS_MANAGER } from './extractors/manager';
import { IForeignCodeExtractorsRegistry } from './extractors/types';
import {
  ILSPCodeOverridesManager,
  ICodeOverridesRegistry
} from './overrides/tokens';
import { DEFAULT_TRANSCLUSIONS } from './transclusions/defaults';
import { SYNTAX_HIGHLIGHTING_PLUGIN } from './features/syntax_highlighting';
import { COMPLETION_THEME_MANAGER } from '@krassowski/completion-theme';
import { plugin as THEME_VSCODE } from '@krassowski/theme-vscode';
import { plugin as THEME_MATERIAL } from '@krassowski/theme-material';
import { CODE_OVERRIDES_MANAGER } from './overrides';

export * from './tokens';

export const codeCheckIcon = new LabIcon({
  name: 'lsp:codeCheck',
  svgstr: codeCheckSvg
});

export interface IFeatureOptions {
  /**
   * The feature to be registered.
   */
  feature: IFeature;
  /**
   * Identifiers (values of `JupyterFrontEndPlugin.id` field) of the features
   * that your feature wants to disable; use it to override the default feature
   * implementations with your custom implementation (e.g. a custom completer)
   */
  supersedes?: string[];
}

export class FeatureManager implements ILSPFeatureManager {
  features: Array<IFeature> = [];
  private command_managers: Array<ContextCommandManager> = [];
  private command_manager_registered: Signal<
    FeatureManager,
    ContextCommandManager
  >;

  constructor() {
    this.command_manager_registered = new Signal(this);
  }

  register(options: IFeatureOptions): void {
    if (options.supersedes) {
      for (let option of options.supersedes) {
        this.features = this.features.filter(feature => feature.id != option);
      }
    }
    this.features.push(options.feature);

    if (options.feature.commands) {
      for (let command_manager of this.command_managers) {
        command_manager.add(options.feature.commands);
      }
      this.command_manager_registered.connect(
        (feature_manager, command_manager) => {
          command_manager.add(options.feature.commands);
        }
      );
    }
  }

  registerCommandManager(manager: ContextCommandManager) {
    this.command_managers.push(manager);
    this.command_manager_registered.emit(manager);
  }
}

export interface ILSPExtension {
  app: JupyterFrontEnd;
  connection_manager: DocumentConnectionManager;
  language_server_manager: LanguageServerManager;
  feature_manager: ILSPFeatureManager;
  editor_type_manager: ILSPVirtualEditorManager;
  foreign_code_extractors: IForeignCodeExtractorsRegistry;
  code_overrides: ICodeOverridesRegistry;
}

export class LSPExtension implements ILSPExtension {
  connection_manager: DocumentConnectionManager;
  language_server_manager: LanguageServerManager;
  feature_manager: ILSPFeatureManager;

  constructor(
    public app: JupyterFrontEnd,
    private setting_registry: ISettingRegistry,
    private palette: ICommandPalette,
    documentManager: IDocumentManager,
    paths: IPaths,
    status_bar: IStatusBar,
    adapterManager: ILSPAdapterManager,
    public editor_type_manager: ILSPVirtualEditorManager,
    private code_extractors_manager: ILSPCodeExtractorsManager,
    private code_overrides_manager: ILSPCodeOverridesManager
  ) {
    this.language_server_manager = new LanguageServerManager({});
    this.connection_manager = new DocumentConnectionManager({
      language_server_manager: this.language_server_manager
    });

    const status_bar_item = new LSPStatus(adapterManager);
    status_bar_item.model.language_server_manager = this.language_server_manager;
    status_bar_item.model.connection_manager = this.connection_manager;

    status_bar.registerStatusItem(PLUGIN_ID + ':language-server-status', {
      item: status_bar_item,
      align: 'left',
      rank: 1,
      isActive: () => adapterManager.isAnyActive()
    });

    this.feature_manager = new FeatureManager();

    this.setting_registry
      .load(plugin.id)
      .then(settings => {
        // Store the initial server settings, to be sent asynchronously
        // when the servers are initialized.
        this.connection_manager.initial_configurations = (settings.composite
          .language_servers || {}) as TLanguageServerConfigurations;

        settings.changed.connect(() => {
          this.updateOptions(settings);
        });
      })
      .catch((reason: Error) => {
        console.error(reason.message);
      });

    adapterManager.registerExtension(this);
  }

  registerAdapterType(
    adapterManager: ILSPAdapterManager,
    type: IAdapterTypeOptions<IDocumentWidget>
  ): void {
    let command_manger = new ContextCommandManager({
      adapter_manager: adapterManager,
      app: this.app,
      palette: this.palette,
      tracker: type.tracker,
      suffix: type.name,
      entry_point: type.entrypoint,
      ...type.context_menu
    });
    this.feature_manager.registerCommandManager(command_manger);
  }

  get foreign_code_extractors() {
    return this.code_extractors_manager.registry;
  }

  get code_overrides() {
    return this.code_overrides_manager.registry;
  }

  private updateOptions(settings: ISettingRegistry.ISettings) {
    const options = settings.composite;

    const languageServerSettings = (options.language_servers ||
      {}) as TLanguageServerConfigurations;
    this.connection_manager.updateServerConfigurations(languageServerSettings);
  }
}

/**
 * The plugin registration information.
 */
const plugin: JupyterFrontEndPlugin<ILSPFeatureManager> = {
  id: PLUGIN_ID + ':plugin',
  requires: [
    ISettingRegistry,
    ICommandPalette,
    IDocumentManager,
    IPaths,
    IStatusBar,
    ILSPAdapterManager,
    ILSPVirtualEditorManager,
    ILSPCodeExtractorsManager,
    ILSPCodeOverridesManager
  ],
  activate: (app, ...args) => {
    let extension = new LSPExtension(
      app,
      ...(args as [
        ISettingRegistry,
        ICommandPalette,
        IDocumentManager,
        IPaths,
        IStatusBar,
        ILSPAdapterManager,
        ILSPVirtualEditorManager,
        ILSPCodeExtractorsManager,
        ILSPCodeOverridesManager
      ])
    );
    return extension.feature_manager;
  },
  provides: ILSPFeatureManager,
  autoStart: true
};

const default_features: JupyterFrontEndPlugin<void>[] = [
  JUMP_PLUGIN,
  COMPLETION_PLUGIN,
  SIGNATURE_PLUGIN,
  HOVER_PLUGIN,
  RENAME_PLUGIN,
  HIGHLIGHTS_PLUGIN,
  DIAGNOSTICS_PLUGIN,
  SYNTAX_HIGHLIGHTING_PLUGIN
];

const plugins: JupyterFrontEndPlugin<any>[] = [
  CODE_EXTRACTORS_MANAGER,
  WIDGET_ADAPTER_MANAGER,
  NOTEBOOK_ADAPTER,
  FILE_EDITOR_ADAPTER,
  VIRTUAL_EDITOR_MANAGER,
  CODEMIRROR_VIRTUAL_EDITOR,
  COMPLETION_THEME_MANAGER,
  THEME_VSCODE,
  THEME_MATERIAL,
  CODE_OVERRIDES_MANAGER,
  plugin,
  ...DEFAULT_TRANSCLUSIONS,
  ...default_features
];

/**
 * Export the plugins as default.
 */
export default plugins;
