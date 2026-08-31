import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roundsRouter from "./rounds";
import coursesRouter from "./courses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roundsRouter);
router.use(coursesRouter);

export default router;
