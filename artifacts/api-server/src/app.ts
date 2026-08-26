import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

// Duck-typed rather than `instanceof ZodError`: generated schema code and this file can end up
// resolving distinct copies of the "zod" module (different entry points/bundling), which makes
// `instanceof` checks against imported classes unreliable across that boundary.
function isZodError(err: unknown): err is { name: "ZodError"; issues: unknown[] } {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Zod validation failures (malformed request bodies/params) and any other thrown error must
// come back as JSON, not Express's default HTML error page, so API clients can handle them.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (isZodError(err)) {
    return res.status(400).json({ error: "Invalid request", issues: err.issues });
  }
  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
});

export default app;
