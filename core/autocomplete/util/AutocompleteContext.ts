import Parser from "web-tree-sitter";
import { IDE } from "../..";
import {
  countTokens,
  pruneLinesFromBottom,
  pruneLinesFromTop,
} from "../../llm/countTokens";
import { languageForFilepath, LanguageId } from "../../util/languageId";
import { positionToIndex } from "../../util/ranges";
import {
  AutocompleteLanguageInfo,
  getAutocompleteLanguageInfo,
} from "../constants/AutocompleteLanguageInfo";
import {
  TabAutocompleteLanguageOptions,
  TabAutocompleteOptions,
} from "../TabAutocompleteOptions";

import { AstPath, getAst, getTreePathAtCursor } from "./ast";
import { AutocompleteInput } from "./types";

export type LogWriter = (message: string) => void;
/** A subset of the context sufficient for logging. Allows easier testing */
export interface AutocompleteLoggingContext {
  options: TabAutocompleteOptions;
  langOptions: TabAutocompleteLanguageOptions;
  writeLog: LogWriter;
}

/**
 * A collection of variables that are often accessed throughout the autocomplete pipeline
 * It's noisy to re-calculate all the time or inject them into each function
 */
export class AutocompleteContext implements AutocompleteLoggingContext {
  languageId: LanguageId;
  languageInfo: AutocompleteLanguageInfo;
  langOptions: TabAutocompleteLanguageOptions;
  treePath: AstPath | undefined;

  private _fileContents!: string;
  private _cursorIndex!: number;
  private _fileLines!: string[];
  private _fullPrefix!: string;
  private _fullSuffix!: string;
  private _prunedPrefix!: string;
  private _prunedSuffix!: string;
  private _ast: Parser.Tree | undefined;

  private constructor(
    public readonly input: AutocompleteInput,
    public readonly options: TabAutocompleteOptions,
    public readonly modelName: string,
    public readonly ide: IDE,
    public readonly writeLog: LogWriter,
  ) {
    this.languageId = languageForFilepath(input.filepath);
    this.languageInfo = getAutocompleteLanguageInfo(this.languageId);
    this.langOptions = {
      ...options.defaultLanguageOptions,
      ...options.languageOptions[this.languageInfo.id],
    };
  }

  static async create(
    input: AutocompleteInput,
    options: TabAutocompleteOptions,
    modelName: string,
    ide: IDE,
    writeLog: (message: string) => void,
  ): Promise<AutocompleteContext> {
    const instance = new AutocompleteContext(
      input,
      options,
      modelName,
      ide,
      writeLog,
    );
    await instance.init();
    return instance;
  }

  private async init() {
    this._fileContents =
      this.input.manuallyPassFileContents ??
      (await this.ide.readFile(this.filepath));

    this._fileLines = this._fileContents.split("\n");

    // Construct full prefix/suffix
    this._cursorIndex = positionToIndex(this._fileContents, this.input.pos);
    this._fullPrefix = this._fileContents.substring(0, this._cursorIndex);
    this._fullSuffix = this._fileContents.substring(this._cursorIndex);

    // construct the pruned prefix/suffix
    {
      const maxPrefixTokens =
        this.options.maxPromptTokens * this.options.prefixPercentage;

      this._prunedPrefix = pruneLinesFromTop(
        this.fullPrefix + (this.input.selectedCompletionInfo?.text ?? ""),
        maxPrefixTokens,
        this.modelName,
      );

      // Construct suffix
      const maxSuffixTokens = Math.min(
        this.options.maxPromptTokens -
          countTokens(this._prunedPrefix, this.modelName),
        this.options.maxSuffixPercentage * this.options.maxPromptTokens,
      );
      this._prunedSuffix = pruneLinesFromBottom(
        this.fullSuffix,
        maxSuffixTokens,
        this.modelName,
      );
    }

    try {
      this._ast = await getAst(this.filepath, this._fileContents);
      if (this._ast) {
        this.treePath = await getTreePathAtCursor(
          this._ast,
          this._fullPrefix.length,
        );
      }
    } catch (e) {
      console.error("Failed to parse AST", e);
    }
  }

  // Fast access
  get filepath() {
    return this.input.filepath;
  }
  get pos() {
    return this.input.pos;
  }

  get prunedCaretWindow() {
    return this.prunedPrefix + this.prunedSuffix;
  }

  // Getters for lazy access
  get fileContents(): string {
    return this._fileContents;
  }

  get fileLines(): string[] {
    return this._fileLines;
  }

  get fullPrefix(): string {
    return this._fullPrefix;
  }

  get fullSuffix(): string {
    return this._fullSuffix;
  }

  /** the prefix before the caret which fits into the maxPromptTokens, including the selectedCompletion  */
  get prunedPrefix(): string {
    return this._prunedPrefix;
  }

  /** the suffix after the caret which fits into the maxPromptTokens  */
  get prunedSuffix(): string {
    return this._prunedSuffix;
  }

  get ast(): Parser.Tree | undefined {
    return this._ast;
  }

  get cursorIndex(): number {
    return this._cursorIndex;
  }
}
