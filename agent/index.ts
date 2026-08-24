import express from "express"
const app=express();
app.use(express.json());
app.post('api/v1/agent',async (req,res)=>{
    res.writeHead(200,{
        "cache-control":"no-cache",
        "connection":"keep-alive",
        "content-type":"text/event-stream"

    })
    
})
