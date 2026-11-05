import cors from "cors";
import express from "express";
import { routes } from "./routes";

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3002" }));
app.use(express.json());
app.get("/health", (_req, res) => {
    res.send("ok");
});
app.use("/api/v1", routes);

export { app };

if (import.meta.main) {
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, "0.0.0.0", () => {
        console.log(`Backend listening on port ${port}`);
    });
}
