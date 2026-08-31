import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import app from "../app";

const holes = Array.from({ length: 18 }, (_, index) => ({
  hole: index + 1,
  par: index % 3 === 0 ? 3 : index % 3 === 1 ? 4 : 5,
  strokeIndex: index + 1,
}));

describe("course library", () => {
  let courseId: number | undefined;
  let roundId: number | undefined;

  afterAll(async () => {
    if (roundId) await request(app).delete(`/api/rounds/${roundId}`);
    if (courseId) await request(app).delete(`/api/courses/${courseId}`);
  });

  it("rejects duplicate stroke indexes", async () => {
    const invalid = holes.map((hole) => ({ ...hole, strokeIndex: 1 }));
    const response = await request(app)
      .post("/api/courses")
      .send({ name: "Invalid Course", holes: invalid });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("every number");
  });

  it("rejects fractional pars", async () => {
    const invalid = holes.map((hole) =>
      hole.hole === 1 ? { ...hole, par: 3.5 } : hole,
    );
    const response = await request(app)
      .post("/api/courses")
      .send({ name: "Fractional Par Course", holes: invalid });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("whole-number par");
  });

  it("creates, searches, and updates an 18-hole course", async () => {
    const createResponse = await request(app)
      .post("/api/courses")
      .send({
        name: "Snapshot Test Club",
        location: "Monterey, CA",
        holes,
        source: "manual",
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.holes).toHaveLength(18);
    courseId = createResponse.body.id;

    const searchResponse = await request(app).get("/api/courses?search=Snapshot");
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body.some((course: { id: number }) => course.id === courseId)).toBe(true);

    const updateResponse = await request(app)
      .patch(`/api/courses/${courseId}`)
      .send({ name: "Snapshot Test Club Updated" });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.name).toBe("Snapshot Test Club Updated");
  });

  it("preserves fallback entry when the external provider is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "unavailable" }),
      })),
    );

    try {
      const response = await request(app).get("/api/courses/external-search?query=pebble");

      expect(response.status).toBe(200);
      expect(response.body.available).toBe(false);
      expect(response.body.provider).toBe("OpenGolfAPI");
      expect(response.body.message).toContain("manually or import a scorecard");
      expect(response.body.courses).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a round layout snapshot after its saved course changes", async () => {
    const createRoundResponse = await request(app)
      .post("/api/rounds")
      .send({
        name: "Course Snapshot Round",
        course: "Snapshot Test Club Updated",
        playedAt: "2026-08-31",
        gameTypes: ["wolf"],
        stake: 1,
        players: [{ name: "Ann" }, { name: "Ben" }],
        holePars: holes.map((hole) => hole.par),
        holeStrokeIndex: holes.map((hole) => hole.strokeIndex),
      });

    expect(createRoundResponse.status).toBe(201);
    roundId = createRoundResponse.body.id;

    const changedHoles = holes.map((hole) => ({
      ...hole,
      par: hole.hole === 1 ? 6 : hole.par,
    }));
    const updateCourseResponse = await request(app)
      .patch(`/api/courses/${courseId}`)
      .send({ holes: changedHoles });
    expect(updateCourseResponse.status).toBe(200);

    const roundResponse = await request(app).get(`/api/rounds/${roundId}`);
    expect(roundResponse.status).toBe(200);
    expect(roundResponse.body.holePars).toEqual(holes.map((hole) => hole.par));
    expect(roundResponse.body.holeStrokeIndex).toEqual(
      holes.map((hole) => hole.strokeIndex),
    );
  });
});