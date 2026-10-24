const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(express.static(__dirname));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
io.on('connection',socket=>{
socket.on('join-room',roomId=>{
socket.join(roomId);
socket.to(roomId).emit('user-joined');
const size=io.sockets.adapter.rooms.get(roomId)?.size||1;
io.to(roomId).emit('user-count',size);
});
socket.on('offer',d=>socket.to(d.roomId).emit('offer',d));
socket.on('answer',d=>socket.to(d.roomId).emit('answer',d));
socket.on('ice-candidate',d=>socket.to(d.roomId).emit('ice-candidate',d.candidate));
socket.on('disconnecting',()=>{
for(const room of socket.rooms){
const size=(io.sockets.adapter.rooms.get(room)?.size||1)-1;
io.to(room).emit('user-count',size);
}
});
});
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log('AR Connect 2-way on '+PORT));
