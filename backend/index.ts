/*
add conversation endpoint
*/
import express from "express";
//import {agentloop }from "../agent/agentloop"
const app=express();
import bcrypt from "bcrypt"
import { db} from '../db/db';
app.use(express.json());

app.post("/api/v1/conversation",async (req,res)=>{
   const{prompt}=req.body();
    res.writeHead(200,{
        "content-type":'text/event-stream',
        "cache-control":"no-cache",
        "connection":"keep-alive",
    })
   
    
    
})

app.post("/api/v1/signup",async (req,res)=>{
    const {username,password}=req.body();
    const hashpassword=await bcrypt.hash(password,10);
    const response=await db.orm.public.User.create({
        username,
        password:hashpassword
    });
    if(!response){
        
    }


});
