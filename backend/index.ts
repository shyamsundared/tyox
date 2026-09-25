/*
add conversation endpoint
*/
import axios from "axios";
import express from "express";
//import {agentloop }from "../agent/agentloop"
const app=express();
import bcrypt from "bcrypt"
import { db} from '../db/db';
app.use(express.json());
let mp=new Map<string,string>();
app.use(express.json());

app.post("/api/v1/:projectid",async (req,res)=>{
    const {projectid}=req.params;
    const {message}=req.body;
    try{
        const response=await db.orm.public.ConversationHistory.create({
        projectId:projectid
    })
    const resp=await db.orm.public.Conversation.create({
        conversation_id:response.id,
        Content:message,
        From:"USER",
        ConversationType:"TEXT_MESSAGE"
    })
    if(!resp){
        console.log("error pushing to db");
        throw new Error;
    }
    const agentResponse= await axios.post("http://localhost:3002/agent/v1/loop",{
        Conversation_id:response.id,
        message:message,
        projectid:projectid
    },{
        responseType:"stream"
    });
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    agentResponse.data.on("data",(chunk:Buffer)=>{
        res.write(chunk);
    })
    agentResponse.data.on("end",()=>{
        res.end();
    })
        
    

}
    catch(error){
        res.end();
    }

    

}
      
    
);


app.post("/api/v1/signup",async (req,res)=>{
    const {username,password}=req.body();
    const hashpassword=await bcrypt.hash(password,10);
    const response=await db.orm.public.User.create({
        username,
        password:hashpassword
    });
    if(!response){
        res.status
    }



});

app.post("/api/v1/question",async (req,res)=>{
    const correlation_id=crypto.randomUUID();
    const {question}= req.body();
    const response= await("http://api/agent/v1/resume"); 
})
