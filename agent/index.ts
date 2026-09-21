import express from "express";
import { main } from "./output";
import cors from "cors";
const app = express();


app.use(express.json());
app.use(cors());
// 1. FIXED: Added the missing leading forward slash '/'
app.post('/api/v1/agent/start', async (req, res) => {
    // Set headers for Server-Sent Events (SSE) streaming
    

        res.writeHead(200,{
            'content-type':'text/event-stream',
            'connection':'keep-alive',
            'cache-control':'no-cache'

        });
        
        const message = req.body.message as string;
        
        

        // Pass the response object ('res') into your main function 
        // so it can write stream tokens out using res.write()
        await main(message);
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