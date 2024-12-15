import { LanguageId } from "../util/languageId";

export interface TabAutocompleteLanguageOptions {
  enableRootPathSnippets: boolean;
  enableImportSnippets: boolean;
  enableDiffSnippets: boolean;
  enableClipboardSnippets: boolean;
  enableSurroundingSymbolsSnippets: boolean;
  outlineNodeReplacements: { [key: string]: string };
  outlineTypeRootNodes: string[];
  filterMaxRepeatingLines: number;
}

export interface TabAutocompleteOptions {
  disable: boolean;
  maxPromptTokens: number;
  debounceDelay: number;
  maxSuffixPercentage: number;
  prefixPercentage: number;
  transform?: boolean;
  template?: string;
  multilineCompletions: "always" | "never" | "auto";
  slidingWindowPrefixPercentage: number;
  slidingWindowSize: number;
  useCache: boolean;
  onlyMyCode: boolean;
  useRecentlyEdited: boolean;
  disableInFiles?: string[];
  logDisableInFiles: boolean;
  useImports?: boolean;
  showWhateverWeHaveAtXMs: number;

  logCompletionCache: boolean;

  logSnippetLimiting: boolean;
  logSnippetTimeouts: boolean;
  logOutlineCreation: boolean;

  logCompletionStop: boolean;
  logDroppedLinesFilter: boolean;

  logPostprocessing: any;
  logCompletionOutcome: any;

  logRootPathSnippets: boolean;
  logImportSnippets: boolean;
  logDiffSnippets: boolean;
  logClipboardSnippets: boolean;
  logSurroundingSymbolsSnippets: boolean;

  defaultLanguageOptions: TabAutocompleteLanguageOptions;
  languageOptions: {
    [languageId in LanguageId]?: TabAutocompleteLanguageOptions;
  };
}

export const DEFAULT_AUTOCOMPLETE_OPTS: TabAutocompleteOptions = {
  disable: false,
  maxPromptTokens: 1024,
  prefixPercentage: 0.3,
  maxSuffixPercentage: 0.2,
  debounceDelay: 350,
  multilineCompletions: "auto",
  // @deprecated TO BE REMOVED
  slidingWindowPrefixPercentage: 0.75,
  // @deprecated TO BE REMOVED
  slidingWindowSize: 500,
  useCache: true,
  onlyMyCode: true,
  useRecentlyEdited: true,
  disableInFiles: undefined,
  logDisableInFiles: false,
  useImports: true,
  transform: true,
  showWhateverWeHaveAtXMs: 300,

  logCompletionCache: false,

  logSnippetLimiting: false,
  logSnippetTimeouts: false,
  logOutlineCreation: false,

  logRootPathSnippets: false,
  logImportSnippets: false,
  logDiffSnippets: false,
  logClipboardSnippets: false,
  logSurroundingSymbolsSnippets: false,

  logCompletionStop: false,
  logDroppedLinesFilter: false,
  logPostprocessing: false,
  logCompletionOutcome: false,

  defaultLanguageOptions: {
    enableRootPathSnippets: true,
    enableImportSnippets: true,
    enableDiffSnippets: true,
    enableClipboardSnippets: true,
    enableSurroundingSymbolsSnippets: true,
    outlineNodeReplacements: {
      statement_block: "{...}",
    },
    outlineTypeRootNodes: [],
    filterMaxRepeatingLines: 3,
  },
  languageOptions: {},
};
