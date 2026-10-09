import { password } from "bun"
import { title } from "node:process"
import {z }from "zod"
export const userschema=z.object({
    username:z.string().min(1,"name is required"),
    password:z.string().min(7,"minimum seven characters")
})
export type user=z.infer<typeof userschema>
export const initialproject=z.object({
    user_id:z.string().min(1),
    title:z.string().min(1,"title cannot be empty"),
    initialPrompt:z.string().min(1,"need to type something")
})