import { describe, expect, it, vi } from "vitest";
import { OpenGolfApiCourseProvider } from "./course-provider";

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const completeHoles = Array.from({ length: 18 }, (_, index) => ({
  number: index + 1,
  par: index % 3 === 0 ? 3 : 4,
  handicap_index: index + 1,
}));

describe("OpenGolfApiCourseProvider", () => {
  it("maps a real directory result into a complete editable layout", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/courses/search")) {
        return response({
          courses: [{ id: "course-1", name: "Harbor Club", city: "Monterey", state: "CA" }],
        });
      }
      return response({ holes: completeHoles });
    });
    const provider = new OpenGolfApiCourseProvider(fetchImpl, "https://example.test/v1");

    await expect(provider.search("harbor")).resolves.toEqual([
      {
        externalId: "course-1",
        name: "Harbor Club",
        location: "Monterey, CA",
        holes: completeHoles.map((hole) => ({
          hole: hole.number,
          par: hole.par,
          strokeIndex: hole.handicap_index,
        })),
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not return a course when the provider omits a handicap index", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/courses/search")) {
        return response({ courses: [{ id: "course-1", name: "Incomplete Club" }] });
      }
      return response({
        holes: completeHoles.map((hole, index) =>
          index === 17 ? { ...hole, handicap_index: null } : hole,
        ),
      });
    });
    const provider = new OpenGolfApiCourseProvider(fetchImpl, "https://example.test/v1");

    await expect(provider.search("incomplete")).resolves.toEqual([]);
  });

  it("surfaces search API failures so the route can keep fallback entry available", async () => {
    const fetchImpl = vi.fn(async () => response({ error: "down" }, false, 503));
    const provider = new OpenGolfApiCourseProvider(fetchImpl, "https://example.test/v1");

    await expect(provider.search("course")).rejects.toThrow("HTTP 503");
  });
});