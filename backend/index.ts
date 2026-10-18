import cors from "cors";
import express from "express";
import { routes } from "./routes";

const app = express();
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3002";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());
app.use("/api/v1", routes);

if (import.meta.main) {
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, "0.0.0.0", () => {
        console.log(`Backend listening on port ${port}`);
    });
}

app.get("/health", (_req, res) => res.status(200).send("ok"));

export { app };
