import cors from "cors";
import express from "express";
import { routes } from "./routes";

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3002";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());
app.use("/api/v1", routes);

if (import.meta.main) {
    app.listen(3000, () => {
        console.log("Backend listening on http://localhost:3000");
    });
}

export { app };
