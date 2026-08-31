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

// Intentionally provider-neutral. A real provider can be connected later without
// changing the public API or returning fabricated course data in the meantime.
export const courseProvider: CourseProvider | null = null;