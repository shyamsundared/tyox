import { Router } from "express";
import { login, signup } from "./controllers/auth";
import { answerQuestion, getConversationHistory, sendMessage } from "./controllers/conversations";
import { createProject, getTodos, listUserProjects } from "./controllers/projects";
import { authenticate } from "./middleware/authmiddleware";

const routes = Router();

routes.post("/signup", signup);
routes.post("/login", login);
routes.use(authenticate);
routes.get("/:projectid/todos", getTodos);
routes.post("/projects", createProject);
routes.get("/users/:userid/projects", listUserProjects);
routes.get("/projects/:projectid/conversations", getConversationHistory);
routes.post("/:projectid", sendMessage);
routes.post("/:projectid/answer", answerQuestion);

export { routes };
