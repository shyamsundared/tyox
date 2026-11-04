import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { userschema } from "../types/types";
import jwt from "jsonwebtoken";
const jwtSecret = process.env.JWT_SECRET ?? "local-development-only-change-me";
export async function signup(req: Request, res: Response) {
    try {
        const result = userschema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
            return;
        }

        const { username, password } = result.data;
        const hashpassword = await bcrypt.hash(password, 10);
        const user = await db.orm.public.User.create({ username, password: hashpassword });
        const token = jwt.sign({ sub: user.id }, jwtSecret, {
            algorithm: "HS256",
            expiresIn: "24h",
        });
        res.status(201).json({ id: user.id, username: user.username, token });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}

export async function login(req: Request, res: Response) {
    try {
        const result = userschema.safeParse(req.body);
        if (!result.success) {
            res.status(400).json({ error: result.error.issues.map((issue) => issue.message).join(". ") });
            return;
        }

        const { username, password } = result.data;
        const user = await db.orm.public.User.where({ username }).first();
        if (!user || !(await bcrypt.compare(password, user.password))) {
            res.status(401).json({ error: "invalid username or password" });
            return;
        }
        const token = jwt.sign({ sub: user.id }, jwtSecret, {
            algorithm: "HS256",
            expiresIn: "24h",
        });
        res.json({ id: user.id, username: user.username, token });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}
