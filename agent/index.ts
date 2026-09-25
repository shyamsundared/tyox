import express from "express";
import { main } from "./output";
import cors from "cors";
import {db} from "../db/db";
import {z} from "zod"
const app = express();


app.use(express.json());
app.use(cors());

app.post('/api/v1/agent/loop', async (req, res) => {
    // Set headers for Server-Sent Events (SSE) streaming
        const {conversation_id,answer,project_id}=req.body;
        const stored=await db.orm.public.ConversationHistory.first({
            projectId:project_id,
            id:conversation_id
        });
        const stored_convo:cntxt[]= await db.orm.public.Conversation.all();
       res.setHeader('Content-type','application/json');
       res.setHeader('Transfer encoding','chunked');
        
        
        const ctype=z.object({
            id:z.string(),
            Content:z.string(),

        })
        type cntxt=z.infer<typeof ctype>;
        // Pass the response object ('res') into your main function 
        // so it can write stream tokens out using res.write()
        const qn=await main(answer,stored_convo);
        res.json({message:"wrote"});
    
});
app.post("api/v1/agent/resume",async (req,res)=>{
    const {answer}=req.body;
    await main(answer);
})
// Update the port to 3001
app.listen(3001, () => {
    console.log("Agent backend listening on http://localhost:3001");
});

/*
having a redis pub sub that publishes to my backend and webscoket all the events from
agent worker is ideal . currently everything is synchronous calls


*/