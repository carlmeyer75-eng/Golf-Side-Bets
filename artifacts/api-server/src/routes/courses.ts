import {
  CreateCourseBody,
  DeleteCourseParams,
  GetCourseParams,
  ImportScorecardBody,
  ListCoursesQueryParams,
  SearchExternalCoursesQueryParams,
  UpdateCourseBody,
  UpdateCourseParams,
} from "@workspace/api-zod";
import { coursesTable, db, type CourseHole, type CourseSource } from "@workspace/db";
import { asc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { courseProvider } from "../lib/course-provider";
import { extractScorecard } from "../lib/scorecard-import";

const router: IRouter = Router();
const importAttempts = new Map<string, number[]>();
const IMPORT_WINDOW_MS = 10 * 60 * 1000;
const IMPORT_LIMIT = 3;

function allowScorecardImport(client: string): boolean {
  const now = Date.now();
  const recent = (importAttempts.get(client) ?? []).filter(
    (timestamp) => now - timestamp < IMPORT_WINDOW_MS,
  );
  if (recent.length >= IMPORT_LIMIT) {
    importAttempts.set(client, recent);
    return false;
  }
  importAttempts.set(client, [...recent, now]);
  return true;
}

function normalizeLayout(holes: CourseHole[]): CourseHole[] {
  const normalized = [...holes].sort((left, right) => left.hole - right.hole);
  const holeNumbers = new Set(normalized.map((hole) => hole.hole));
  const strokeIndexes = new Set(normalized.map((hole) => hole.strokeIndex));

  if (
    normalized.length !== 18 ||
    holeNumbers.size !== 18 ||
    !normalized.every(
      (hole, index) =>
        hole.hole === index + 1 &&
        Number.isInteger(hole.par) &&
        hole.par >= 3 &&
        hole.par <= 6,
    )
  ) {
    throw new Error(
      "A course must contain holes 1 through 18 exactly once, each with a whole-number par from 3 to 6.",
    );
  }

  if (
    strokeIndexes.size !== 18 ||
    !Array.from({ length: 18 }, (_, index) => index + 1).every((value) =>
      strokeIndexes.has(value),
    )
  ) {
    throw new Error("Course handicap values must use every number from 1 through 18 once.");
  }

  return normalized;
}

function serializeCourse(course: typeof coursesTable.$inferSelect) {
  return {
    ...course,
    source: course.source as CourseSource,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
  };
}

router.get("/courses", async (req, res) => {
  const { search } = ListCoursesQueryParams.parse(req.query);
  const query = search?.trim();
  const where = query
    ? or(ilike(coursesTable.name, `%${query}%`), ilike(coursesTable.location, `%${query}%`))
    : undefined;
  const courses = await db
    .select()
    .from(coursesTable)
    .where(where)
    .orderBy(asc(coursesTable.name));
  res.json(courses.map(serializeCourse));
});

router.get("/courses/external-search", async (req, res) => {
  const { query } = SearchExternalCoursesQueryParams.parse(req.query);
  if (!courseProvider) {
    return res.json({
      available: false,
      provider: null,
      message:
        "External course search is not configured yet. Add courses manually or import a scorecard.",
      courses: [],
    });
  }

  const courses = await courseProvider.search(query.trim());
  return res.json({
    available: true,
    provider: courseProvider.name,
    message: courses.length ? "Courses found." : "No matching courses were found.",
    courses,
  });
});

router.post("/courses", async (req, res) => {
  const body = CreateCourseBody.parse(req.body);
  if (!body.name.trim()) {
    return res.status(400).json({ error: "Course name is required." });
  }
  let holes: CourseHole[];
  try {
    holes = normalizeLayout(body.holes);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  const [course] = await db
    .insert(coursesTable)
    .values({
      name: body.name.trim(),
      location: body.location?.trim() ?? "",
      holes,
      source: body.source ?? "manual",
      sourceDocumentName: body.sourceDocumentName ?? null,
    })
    .returning();
  return res.status(201).json(serializeCourse(course));
});

router.get("/courses/:courseId", async (req, res) => {
  const { courseId } = GetCourseParams.parse(req.params);
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId));
  if (!course) return res.status(404).json({ error: "Course not found" });
  return res.json(serializeCourse(course));
});

router.patch("/courses/:courseId", async (req, res) => {
  const { courseId } = UpdateCourseParams.parse(req.params);
  const body = UpdateCourseBody.parse(req.body);
  if (body.name !== undefined && !body.name.trim()) {
    return res.status(400).json({ error: "Course name is required." });
  }
  let holes: CourseHole[] | undefined;
  try {
    holes = body.holes ? normalizeLayout(body.holes) : undefined;
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }

  const [course] = await db
    .update(coursesTable)
    .set({
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.location !== undefined ? { location: body.location.trim() } : {}),
      ...(holes ? { holes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(coursesTable.id, courseId))
    .returning();
  if (!course) return res.status(404).json({ error: "Course not found" });
  return res.json(serializeCourse(course));
});

router.delete("/courses/:courseId", async (req, res) => {
  const { courseId } = DeleteCourseParams.parse(req.params);
  const [course] = await db
    .delete(coursesTable)
    .where(eq(coursesTable.id, courseId))
    .returning({ id: coursesTable.id });
  if (!course) return res.status(404).json({ error: "Course not found" });
  return res.status(204).send();
});

router.post("/courses/import-scorecard", async (req, res) => {
  if (!allowScorecardImport(req.ip ?? req.socket.remoteAddress ?? "unknown")) {
    return res
      .status(429)
      .json({ error: "Too many scorecard imports. Please wait a few minutes and try again." });
  }
  const body = ImportScorecardBody.parse(req.body);
  try {
    const draft = await extractScorecard(body.data, body.mimeType, body.fileName);
    return res.json(draft);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scorecard extraction failed.";
    const status = message.includes("MB") || message.startsWith("Upload") ? 400 : 502;
    return res.status(status).json({ error: message });
  }
});

export default router;