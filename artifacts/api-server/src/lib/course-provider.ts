import type { CourseHole } from "@workspace/db";

export type ExternalCourse = {
  externalId: string;
  name: string;
  location: string;
  holes: CourseHole[];
};

export interface CourseProvider {
  readonly name: string;
  search(query: string): Promise<ExternalCourse[]>;
}

type OpenGolfSearchCourse = {
  id?: unknown;
  name?: unknown;
  course_name?: unknown;
  city?: unknown;
  state?: unknown;
};

type OpenGolfSearchResponse = {
  courses?: unknown;
};

type OpenGolfHole = {
  number?: unknown;
  par?: unknown;
  handicap_index?: unknown;
};

type OpenGolfHolesResponse = {
  holes?: unknown;
};

const OPENGOLF_API_URL = "https://api.opengolfapi.org/v1";
const MAX_RESULTS = 8;
const REQUEST_TIMEOUT_MS = 8_000;

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function normalizeHoles(payload: unknown): CourseHole[] | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as OpenGolfHolesResponse).holes)
  ) {
    return null;
  }

  const holes = (payload as OpenGolfHolesResponse).holes as OpenGolfHole[];
  if (holes.length !== 18) return null;

  const normalized = holes.map((hole) => ({
    hole: hole.number as number,
    par: hole.par as number,
    strokeIndex: hole.handicap_index as number,
  }));

  const holeNumbers = new Set(normalized.map((hole) => hole.hole));
  const strokeIndexes = new Set(normalized.map((hole) => hole.strokeIndex));

  if (
    !normalized.every(
      (hole) =>
        isIntegerInRange(hole.hole, 1, 18) &&
        isIntegerInRange(hole.par, 3, 6) &&
        isIntegerInRange(hole.strokeIndex, 1, 18),
    ) ||
    holeNumbers.size !== 18 ||
    strokeIndexes.size !== 18
  ) {
    return null;
  }

  return normalized.sort((left, right) => left.hole - right.hole);
}

function getLocation(course: OpenGolfSearchCourse): string {
  const city = typeof course.city === "string" ? course.city.trim() : "";
  const state = typeof course.state === "string" ? course.state.trim() : "";
  return [city, state].filter(Boolean).join(", ");
}

function getCourseName(course: OpenGolfSearchCourse): string {
  const name = typeof course.name === "string" ? course.name.trim() : "";
  if (name) return name;
  return typeof course.course_name === "string" ? course.course_name.trim() : "";
}

export class OpenGolfApiCourseProvider implements CourseProvider {
  readonly name = "OpenGolfAPI";

  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly apiUrl = OPENGOLF_API_URL,
  ) {}

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`OpenGolfAPI returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  }

  async search(query: string): Promise<ExternalCourse[]> {
    const searchUrl = new URL(`${this.apiUrl}/courses/search`);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("limit", String(MAX_RESULTS));
    const searchPayload = await this.getJson<OpenGolfSearchResponse>(searchUrl.toString());
    if (!Array.isArray(searchPayload.courses)) {
      throw new Error("OpenGolfAPI returned an invalid course search response.");
    }

    const candidates = (searchPayload.courses as OpenGolfSearchCourse[]).filter(
      (course) =>
        typeof course.id === "string" &&
        Boolean(getCourseName(course)),
    );
    const results = await Promise.all(
      candidates.map(async (course): Promise<ExternalCourse | null> => {
        try {
          const holesPayload = await this.getJson<OpenGolfHolesResponse>(
            `${this.apiUrl}/courses/${encodeURIComponent(course.id as string)}/holes`,
          );
          const holes = normalizeHoles(holesPayload);
          if (!holes) return null;

          return {
            externalId: course.id as string,
            name: getCourseName(course),
            location: getLocation(course),
            holes,
          };
        } catch {
          // A missing or incomplete scorecard is not safe to turn into a saved
          // course. Omit just that result while preserving the other matches.
          return null;
        }
      }),
    );

    return results.filter((course): course is ExternalCourse => course !== null);
  }
}

// OpenGolfAPI is a public, no-key directory. Layouts are still validated by the
// adapter so incomplete provider records are never presented as saveable data.
export const courseProvider: CourseProvider = new OpenGolfApiCourseProvider();