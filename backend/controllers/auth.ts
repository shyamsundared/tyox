import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { db } from "../../db/db";
import { userschema } from "../types/types";
import { createAccessToken } from "../middleware/authmiddleware";

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
        res.status(201).json({ id: user.id, username: user.username, token: createAccessToken(user.id) });
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
        res.json({ id: user.id, username: user.username, token: createAccessToken(user.id) });
    } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
}
