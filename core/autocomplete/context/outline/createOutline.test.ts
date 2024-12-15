import fs from "fs";
import path from "path";
import { LanguageId } from "../../../util/languageId";
import { getLanguage, treeToString } from "../../../util/treeSitter";
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../../TabAutocompleteOptions";
import { getAst } from "../../util/ast";
import { ContextRetrievalService } from "../ContextRetrievalService";

describe("createSummary", () => {
  const folderPath = path.join(
    __dirname,
    "autocomplete",
    "context",
    "outline",
    "test",
  );

  const service = new ContextRetrievalService(null as any);

  it("should return an outline of the test file", async () => {
    const fileContents = fs.readFileSync(
      path.join(folderPath, "typescript.ts"),
      "utf8",
    );
    const lineCount = fileContents.split("\n").length;
    const outline = await service.createOutline(
      "test.ts",
      fileContents,
      {
        start: { line: 0, character: 0 },
        end: { line: lineCount + 1, character: 0 },
      },
      {
        options: DEFAULT_AUTOCOMPLETE_OPTS,
        langOptions: DEFAULT_AUTOCOMPLETE_OPTS.defaultLanguageOptions,
        writeLog: () => {},
      },
    );
    // console.log(outline);
    expect(outline).toBe(
      fs.readFileSync(path.join(folderPath, "typescript.txt"), "utf8"),
    );
  });

  it("test-toBeRemoved", async () => {
    const ast = await getAst(
      "foo.ts",
      `function foo(param1: string): void { param1.ab.c}`,
    );
    console.log(treeToString(ast!.rootNode));
    const language = await getLanguage(LanguageId.Typescript);
    const query = language!.query(
      "((function_declaration (identifier) @ident) @function)\n ((identifier) @ident2)",
    );
    const matches = query.matches(ast!.rootNode.namedChild(0)!, {
      maxStartDepth: 0,
    });
    // const matches = query.matches(ast!.rootNode.namedChild(0)!.namedChild(0)!);
    for (const match of matches) {
      match.captures.forEach((capture) => {
        console.log(
          capture.name,
          capture.node.type,
          capture.node.startIndex,
          capture.node.endIndex,
        );
      });
    }
  });
});
