import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeScorecardData,
  extractScorecard,
  normalizeExtractedScorecard,
} from "./scorecard-import";

const fixtureDirectory = fileURLToPath(
  new URL("../../test-fixtures/scorecards/", import.meta.url),
);
const expectedPars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4];
const expectedStrokeIndexes = [
  7, 15, 3, 1, 11, 5, 17, 9, 13, 2, 16, 8, 6, 12, 4, 18, 10, 14,
];

const completeExtraction = {
  name: "Copper Ridge Golf Club",
  location: "Bend, Oregon",
  confidence: 0.98,
  holes: expectedPars.map((par, index) => ({
    hole: index + 1,
    par,
    strokeIndex: expectedStrokeIndexes[index],
  })),
};

const fixtures = [
  {
    fileName: "copper-ridge-complete.jpg",
    responseFileName: "copper-ridge-complete.model-response.json",
    mimeType: "image/jpeg",
    scenario: "complete",
  },
  {
    fileName: "copper-ridge-rotated.png",
    responseFileName: "copper-ridge-rotated.model-response.json",
    mimeType: "image/png",
    scenario: "rotated",
  },
  {
    fileName: "copper-ridge-faint.webp",
    responseFileName: "copper-ridge-faint.model-response.json",
    mimeType: "image/webp",
    scenario: "low-confidence",
  },
  {
    fileName: "copper-ridge-partial.pdf",
    responseFileName: "copper-ridge-partial.model-response.json",
    mimeType: "application/pdf",
    scenario: "partial",
  },
] as const;

type RecordedModelResponse = {
  sourceSha256: string;
  response: unknown;
  expected: {
    name: string;
    pars: number[];
    strokeIndexes: number[];
    warningFragments: string[];
  };
};

function fixtureBytes(fileName: string): Buffer {
  return readFileSync(`${fixtureDirectory}${fileName}`);
}

function fixtureData(fileName: string): string {
  return fixtureBytes(fileName).toString("base64");
}

function recordedModelResponse(fileName: string): RecordedModelResponse {
  return JSON.parse(
    readFileSync(`${fixtureDirectory}${fileName}`, "utf8"),
  ) as RecordedModelResponse;
}

function draftFrom(extraction: unknown, sourceDocumentName: string) {
  return normalizeExtractedScorecard(extraction, sourceDocumentName);
}

describe("scorecard draft normalization", () => {
  it("rejects malformed and MIME-mismatched uploads before AI analysis", () => {
    expect(() => decodeScorecardData("not base64!", "image/png")).toThrow(
      "valid base64",
    );
    expect(() =>
      decodeScorecardData(
        Buffer.from("%PDF-1.7").toString("base64"),
        "image/png",
      ),
    ).toThrow("does not match");
  });

  it("returns an editable 18-hole draft and warns about uncertain values", () => {
    const draft = draftFrom(
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
    expect(
      draft.warnings.some((warning) => warning.includes("Course name")),
    ).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("Hole 2"))).toBe(
      true,
    );
    expect(draft.sourceDocumentName).toBe("scorecard.pdf");
  });

  it("adds an explicit warning when model confidence is low", () => {
    const draft = draftFrom(
      {
        name: "Copper Ridge Golf Club",
        confidence: 0.28,
        warnings: ["The back nine is faint."],
        holes: completeExtraction.holes,
      },
      "copper-ridge-faint.webp",
    );

    expect(draft.confidence).toBe(0.28);
    expect(draft.warnings).toContain("The back nine is faint.");
    expect(draft.warnings).toContain(
      "This scorecard was read with low confidence; review every suggested value before saving.",
    );
    expect(draft.holes).toHaveLength(18);
  });

  it("coerces numeric strings from model JSON and warns for unreadable values", () => {
    const draft = draftFrom(
      {
        name: "Copper Ridge Golf Club",
        confidence: "0.64",
        holes: [
          { hole: "1", par: "4", strokeIndex: "7" },
          { hole: "2", par: "N/A", strokeIndex: "15" },
        ],
      },
      "model-response.json",
    );

    expect(draft.confidence).toBe(0.64);
    expect(draft.holes[0]).toEqual({ hole: 1, par: 4, strokeIndex: 7 });
    expect(draft.holes[1]).toEqual({ hole: 2, par: 4, strokeIndex: 15 });
    expect(draft.warnings).toContain(
      "Hole 2 par could not be read; defaulted to 4.",
    );
  });

  it("keeps a partial card editable and warns for every missing hole", () => {
    const draft = draftFrom(
      {
        name: "Copper Ridge Golf Club",
        location: "Bend, Oregon",
        confidence: 0.52,
        warnings: ["Only the front nine was visible."],
        holes: completeExtraction.holes.slice(0, 9),
      },
      "copper-ridge-partial.pdf",
    );

    expect(draft.holes).toHaveLength(18);
    expect(draft.holes.slice(0, 9).map((hole) => hole.par)).toEqual(
      expectedPars.slice(0, 9),
    );
    expect(draft.warnings).toContain("Only the front nine was visible.");
    for (const holeNumber of expectedPars
      .slice(9)
      .map((_, index) => index + 10)) {
      expect(draft.warnings).toContain(
        `Hole ${holeNumber} was not found; review the suggested values.`,
      );
    }
    expect(new Set(draft.holes.map((hole) => hole.strokeIndex)).size).toBe(18);
  });
});

describe("sanitized scorecard fixtures", () => {
  it.each(fixtures)(
    "matches and normalizes the recorded $scenario $mimeType extraction",
    ({ fileName, responseFileName, mimeType }) => {
      const bytes = fixtureBytes(fileName);
      const recording = recordedModelResponse(responseFileName);
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");

      expect(sourceSha256).toBe(recording.sourceSha256);
      expect(() =>
        decodeScorecardData(bytes.toString("base64"), mimeType),
      ).not.toThrow();
      const draft = draftFrom(recording.response, fileName);

      expect(draft.name.toLocaleLowerCase()).toBe(recording.expected.name);
      expect(draft.holes).toHaveLength(18);
      expect(draft.holes.map((hole) => hole.par)).toEqual(
        recording.expected.pars,
      );
      expect(draft.holes.map((hole) => hole.strokeIndex)).toEqual(
        recording.expected.strokeIndexes,
      );
      expect(new Set(draft.holes.map((hole) => hole.strokeIndex)).size).toBe(
        18,
      );
      for (const fragment of recording.expected.warningFragments) {
        expect(
          draft.warnings.some((warning) => warning.includes(fragment)),
        ).toBe(true);
      }
      if (!recording.expected.warningFragments.length) {
        expect(draft.warnings).toEqual([]);
      }
    },
  );
});

const liveFixtureLimit = Math.min(
  fixtures.length,
  Math.max(
    1,
    Number.parseInt(process.env.SCORECARD_IMPORT_LIVE_LIMIT ?? "1", 10) || 1,
  ),
);
const liveDescribe =
  process.env.RUN_SCORECARD_IMPORT_INTEGRATION === "1"
    ? describe
    : describe.skip;

liveDescribe("managed Gemini scorecard extraction (opt-in)", () => {
  it(
    `extracts the selected scorecard fixtures (up to ${liveFixtureLimit} paid request${liveFixtureLimit === 1 ? "" : "s"})`,
    { timeout: 120_000 },
    async () => {
      for (const fixture of fixtures.slice(0, liveFixtureLimit)) {
        const draft = await extractScorecard(
          fixtureData(fixture.fileName),
          fixture.mimeType,
          fixture.fileName,
        );

        expect(draft.source).toBe("upload");
        expect(draft.sourceDocumentName).toBe(fixture.fileName);
        expect(draft.holes).toHaveLength(18);
        expect(new Set(draft.holes.map((hole) => hole.strokeIndex)).size).toBe(
          18,
        );

        if (fixture.scenario === "complete" || fixture.scenario === "rotated") {
          expect(draft.name.toLocaleLowerCase()).toBe("copper ridge golf club");
          expect(draft.holes.map((hole) => hole.par)).toEqual(expectedPars);
          expect(draft.holes.map((hole) => hole.strokeIndex)).toEqual(
            expectedStrokeIndexes,
          );
        }
        if (fixture.scenario === "partial") {
          expect(draft.warnings.length).toBeGreaterThan(0);
          expect(
            draft.warnings.some((warning) =>
              /not found|partial|visible/i.test(warning),
            ),
          ).toBe(true);
        }
        if (fixture.scenario === "low-confidence") {
          expect(draft.warnings.length).toBeGreaterThan(0);
          expect(draft.confidence).not.toBeNull();
        }
      }
    },
  );
});
