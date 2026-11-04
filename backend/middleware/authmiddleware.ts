
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
const jwtSecret = process.env.JWT_SECRET ?? "local-development-only-change-me";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in production");
}

if (process.env.NODE_ENV === "production" && Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
    const authorization = req.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    let userId: string | undefined;

    if (token) {
        try {
            const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
            if (
                typeof payload !== "string" &&
                typeof payload.sub === "string" &&
                payload.sub &&
                typeof payload.exp === "number"
            ) {
                userId = payload.sub;
            }
        } catch {
            // Invalid, expired, or incorrectly signed tokens are unauthenticated.
        }
    }

    if (!userId) {
        res.status(401).json({ error: "authentication required" });
        return;
    }

    req.userId = userId;
    next();
}

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}
