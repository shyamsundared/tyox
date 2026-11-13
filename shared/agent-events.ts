export type AgentClientEvent={event:"update",data:{message:string}}|{
    event:"question",data:{conversation_id:string,call_id:string,question:string}
}|{
    event:"complete",data:{message:string}}|{event:"preview",data:{url:string}}|{event:"error",data:{message:string}}

export function formatSseEvent(event:AgentClientEvent):string{
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
}
export function parseSseEvent(stream:string):AgentClientEvent|null{
    const[eventline,dataline]=stream.split('\n');
    if(!eventline || !dataline){
        return null
    }
    if(eventline.startsWith("event: ") && dataline.startsWith("data: ")){
        const parsedevent=eventline.slice("event: ".length)
        try{
        const parsededata=JSON.parse(dataline.slice("data: ".length))
    return{event:parsedevent,data:parsededata }as AgentClientEvent
}
    catch{
        return null

        
    }}
    else{
       return null
    }
}