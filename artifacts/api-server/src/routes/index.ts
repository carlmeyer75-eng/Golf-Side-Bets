import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roundsRouter from "./rounds";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roundsRouter);

export default router;
