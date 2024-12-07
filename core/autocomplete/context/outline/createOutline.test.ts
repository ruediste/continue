import fs from "fs";
import path from "path";
import { createOutline } from "./createOutline";

describe("createSummary", () => {
  const folderPath = path.join(
    __dirname,
    "autocomplete",
    "context",
    "outline",
    "test",
  );

  it("should return a summary of the test results", async () => {
    const fileContents = fs.readFileSync(
      path.join(folderPath, "typescript.ts"),
      "utf8",
    );
    const lineCount = fileContents.split("\n").length;
    const outline = await createOutline("test.ts", fileContents, {
      start: { line: 0, character: 0 },
      end: { line: lineCount + 1, character: 0 },
    });
    // console.log(outline);
    expect(outline).toBe(
      fs.readFileSync(path.join(folderPath, "typescript.txt"), "utf8"),
    );
  });
});
