import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "../../db/db";
import { jwtSecret } from "../middleware/authmiddleware";
import { authSchema } from "../schemas";

function createToken(userId: string): string {
    return jwt.sign({ sub: userId }, jwtSecret, { algorithm: "HS256", expiresIn: "24h" });
}

export async function signup(req: Request, res: Response) {
    const result = authSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }

    try {
        const { username, password } = result.data;
        const existing = await db.orm.public.User.where({ username }).first();
        if (existing) {
            res.status(409).json({ error: "username is already taken" });
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await db.orm.public.User.create({ username, password: hashedPassword });
        res.status(201).json({ id: user.id, username: user.username, token: createToken(user.id) });
    } catch (error) {
        console.error("Signup failed:", error);
        res.status(500).json({ error: "could not create the account" });
    }
}

export async function login(req: Request, res: Response) {
    const result = authSchema.safeParse(req.body);
    if (!result.success) {
        res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
        return;
    }

    try {
        const { username, password } = result.data;
        const user = await db.orm.public.User.where({ username }).first();
        if (!user || !(await bcrypt.compare(password, user.password))) {
            res.status(401).json({ error: "invalid username or password" });
            return;
        }
        res.json({ id: user.id, username: user.username, token: createToken(user.id) });
    } catch (error) {
        console.error("Login failed:", error);
        res.status(500).json({ error: "could not log in" });
    }
}
