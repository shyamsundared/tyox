import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type JwtPayload = { sub: string; iat: number; exp: number };
const jwtSecret = process.env.JWT_SECRET ?? "local-development-only-change-me";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET must be configured in production");
}
if (process.env.NODE_ENV === "production" && Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
}

function signature(input: string) {
    return createHmac("sha256", jwtSecret).update(input).digest("base64url");
}

export function createAccessToken(userId: string, now = Date.now()) {
    const issuedAt = Math.floor(now / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: userId, iat: issuedAt, exp: issuedAt + 60 * 60 * 24 })).toString("base64url");
    const content = `${header}.${payload}`;
    return `${content}.${signature(content)}`;
}

function verifyAccessToken(token: string): string | null {
    const [headerPart, payloadPart, tokenSignature, extra] = token.split(".");
    if (!headerPart || !payloadPart || !tokenSignature || extra !== undefined) return null;

    const content = `${headerPart}.${payloadPart}`;
    const expected = Buffer.from(signature(content));
    const provided = Buffer.from(tokenSignature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

    try {
        const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as { alg?: unknown; typ?: unknown };
        const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Partial<JwtPayload>;
        if (header.alg !== "HS256" || header.typ !== "JWT") return null;
        if (typeof payload.sub !== "string" || !payload.sub) return null;
        if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
        return payload.sub;
    } catch {
        return null;
    }
}

declare global {
    namespace Express {
        interface Request {
            userId?: string;
        }
    }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
    const authorization = req.header("authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    const userId = token ? verifyAccessToken(token) : null;
    if (!userId) {
        res.status(401).json({ error: "authentication required" });
        return;
    }
    req.userId = userId;
    next();
}
