import { z } from "zod"
export const userschema=z.object({
    username:z.string().min(1,"name is required"),
    password:z.string().min(7,"minimum seven characters")
})
export type user=z.infer<typeof userschema>
