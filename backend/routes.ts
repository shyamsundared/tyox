import { Router } from "express";
import { login, signup } from "./controllers/auth";
import { answerQuestion, getConversationHistory, sendMessage } from "./controllers/conversations";
import { createProject, getTodos, listUserProjects } from "./controllers/projects";

const routes = Router();

routes.get("/:projectid/todos", getTodos);
routes.post("/projects", createProject);
routes.get("/users/:userid/projects", listUserProjects);
routes.get("/projects/:projectid/conversations", getConversationHistory);
routes.post("/signup", signup);
routes.post("/login", login);
routes.post("/:projectid", sendMessage);
routes.post("/:projectid/answer", answerQuestion);

export { routes };
