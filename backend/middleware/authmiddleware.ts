import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export const jwtSecret = process.env.JWT_SECRET ?? "local-development-only-change-me";

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || jwtSecret.length < 32)) {
    throw new Error("JWT_SECRET must be set to at least 32 characters in production");
}

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
    const token = req.header("authorization")?.replace("Bearer ", "") ?? "";

    try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
        if (typeof payload === "string" || !payload.sub) throw new Error("invalid token");
        req.userId = payload.sub;
        next();
    } catch {
        res.status(401).json({ error: "authentication required" });
    }
}
