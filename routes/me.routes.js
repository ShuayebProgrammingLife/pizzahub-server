import { Router } from "express";
import { verifyJWT } from "../middleware/verifyJWT.js";

const router = Router();
router.get("/me", verifyJWT, (req, res) => res.json({ user: req.user }));
export default router;