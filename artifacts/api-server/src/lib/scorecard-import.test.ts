import { describe, expect, it } from "vitest";
import { decodeScorecardData, normalizeExtractedScorecard } from "./scorecard-import";

describe("scorecard draft normalization", () => {
  it("rejects malformed and MIME-mismatched uploads before AI analysis", () => {
    expect(() => decodeScorecardData("not base64!", "image/png")).toThrow("valid base64");
    expect(() =>
      decodeScorecardData(Buffer.from("%PDF-1.7").toString("base64"), "image/png"),
    ).toThrow("does not match");
  });

  it("returns an editable 18-hole draft and warns about uncertain values", () => {
    const draft = normalizeExtractedScorecard(
      {
        name: "",
        confidence: 0.7,
        holes: [
          { hole: 1, par: 4, strokeIndex: 8 },
          { hole: 2, par: 9, strokeIndex: 8, uncertain: true },
        ],
      },
      "scorecard.pdf",
    );

    expect(draft.holes).toHaveLength(18);
    expect(draft.holes[0]).toEqual({ hole: 1, par: 4, strokeIndex: 8 });
    expect(draft.holes[1].par).toBe(4);
    expect(new Set(draft.holes.map((hole) => hole.strokeIndex)).size).toBe(18);
    expect(draft.warnings.some((warning) => warning.includes("Course name"))).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("Hole 2"))).toBe(true);
    expect(draft.sourceDocumentName).toBe("scorecard.pdf");
  });
});