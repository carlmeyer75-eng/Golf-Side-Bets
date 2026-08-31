import { z } from "zod";

const SIX_MEGABYTES = 6 * 1024 * 1024;
const LOW_CONFIDENCE_THRESHOLD = 0.75;
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extractedNumber = z.preprocess((value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
}, z.number().optional());

const extractedHoleSchema = z.object({
  hole: extractedNumber,
  par: extractedNumber,
  strokeIndex: extractedNumber,
  uncertain: z.boolean().optional(),
});

const extractedScorecardSchema = z.object({
  name: z.string().optional(),
  location: z.string().optional(),
  confidence: extractedNumber,
  warnings: z.array(z.string()).optional(),
  holes: z.array(extractedHoleSchema).optional(),
});

export type ScorecardDraft = {
  name: string;
  location: string;
  holes: Array<{ hole: number; par: number; strokeIndex: number }>;
  source: "upload";
  sourceDocumentName: string;
  warnings: string[];
  confidence: number | null;
};

export function decodeScorecardData(data: string, mimeType: string): string {
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new Error("Upload a PDF, JPG, PNG, or WebP scorecard.");
  }

  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  if (
    !base64 ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) ||
    base64.length > 8 * 1024 * 1024
  ) {
    throw new Error("The uploaded scorecard data is not valid base64.");
  }
  const bytes = Buffer.from(base64, "base64");

  if (!bytes.length) {
    throw new Error("The uploaded scorecard is empty.");
  }
  if (bytes.length > SIX_MEGABYTES) {
    throw new Error("Scorecard uploads must be 6 MB or smaller.");
  }
  if (bytes.toString("base64") !== base64) {
    throw new Error("The uploaded scorecard data is not valid base64.");
  }

  const matchesMimeType =
    (mimeType === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-") ||
    (mimeType === "image/jpeg" &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (mimeType === "image/png" &&
      bytes
        .subarray(0, 8)
        .equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )) ||
    (mimeType === "image/webp" &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP");

  if (!matchesMimeType) {
    throw new Error(
      "The uploaded file content does not match its PDF or image type.",
    );
  }

  return base64;
}

export function normalizeExtractedScorecard(
  raw: unknown,
  sourceDocumentName: string,
): ScorecardDraft {
  const parsed = extractedScorecardSchema.parse(raw);
  const warnings = [...(parsed.warnings ?? [])];
  if (
    typeof parsed.confidence === "number" &&
    parsed.confidence < LOW_CONFIDENCE_THRESHOLD
  ) {
    warnings.push(
      "This scorecard was read with low confidence; review every suggested value before saving.",
    );
  }
  const byHole = new Map(
    (parsed.holes ?? [])
      .filter(
        (hole) =>
          Number.isInteger(hole.hole) && hole.hole! >= 1 && hole.hole! <= 18,
      )
      .map((hole) => [hole.hole!, hole]),
  );

  const usedStrokeIndexes = new Set<number>();
  const holes = Array.from({ length: 18 }, (_, index) => {
    const holeNumber = index + 1;
    const extracted = byHole.get(holeNumber);
    const validPar =
      Number.isInteger(extracted?.par) &&
      extracted!.par! >= 3 &&
      extracted!.par! <= 6;
    const validStrokeIndex =
      Number.isInteger(extracted?.strokeIndex) &&
      extracted!.strokeIndex! >= 1 &&
      extracted!.strokeIndex! <= 18 &&
      !usedStrokeIndexes.has(extracted!.strokeIndex!);

    if (!extracted) {
      warnings.push(
        `Hole ${holeNumber} was not found; review the suggested values.`,
      );
    } else if (extracted.uncertain) {
      warnings.push(
        `Hole ${holeNumber} was marked uncertain; verify par and handicap.`,
      );
    }
    if (!validPar) {
      warnings.push(
        `Hole ${holeNumber} par could not be read; defaulted to 4.`,
      );
    }

    if (validStrokeIndex) {
      usedStrokeIndexes.add(extracted!.strokeIndex!);
    } else {
      warnings.push(
        `Hole ${holeNumber} handicap could not be read uniquely; a placeholder was assigned.`,
      );
    }

    return {
      hole: holeNumber,
      par: validPar ? extracted!.par! : 4,
      strokeIndex: validStrokeIndex ? extracted!.strokeIndex! : 0,
    };
  });

  const availableStrokeIndexes = Array.from(
    { length: 18 },
    (_, index) => index + 1,
  ).filter((strokeIndex) => !usedStrokeIndexes.has(strokeIndex));
  let availableIndex = 0;
  for (const hole of holes) {
    if (!hole.strokeIndex) {
      hole.strokeIndex = availableStrokeIndexes[availableIndex++];
    }
  }

  if (!parsed.name?.trim()) {
    warnings.unshift("Course name was not found; enter it before saving.");
  }

  return {
    name: parsed.name?.trim() ?? "",
    location: parsed.location?.trim() ?? "",
    holes,
    source: "upload",
    sourceDocumentName,
    warnings: [...new Set(warnings)],
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : null,
  };
}

export async function extractScorecard(
  data: string,
  mimeType: string,
  fileName: string,
): Promise<ScorecardDraft> {
  const base64 = decodeScorecardData(data, mimeType);
  const { ai } = await import("@workspace/integrations-gemini-ai");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "Read this golf scorecard. Return JSON only with: name (course name), location, confidence from 0 to 1, warnings, and holes. Holes must contain hole, par, strokeIndex for all visible holes. strokeIndex means handicap/SI and must preserve the number printed on the card. Mark a hole uncertain when any value is unclear. Never invent a course name or printed value; omit uncertain values instead.",
          },
          { inlineData: { data: base64, mimeType } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0,
    },
  });

  if (!response.text) {
    throw new Error("No course data could be read from that scorecard.");
  }

  return normalizeExtractedScorecard(JSON.parse(response.text), fileName);
}
