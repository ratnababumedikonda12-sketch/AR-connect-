const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static(path.join(__dirname)));
let rooms = {};
io.on('connection', (socket) => {
  socket.on('join-room', ({ meetingId, userId }) => {
    socket.join(meetingId);
    if (!rooms[meetingId]) rooms[meetingId] = [];
    rooms[meetingId].push(socket.id);
    io.to(meetingId).emit('room-users', rooms[meetingId].length);
  });
  socket.on('register-peer', ({ meetingId, peerId }) => {
    socket.meetingId = meetingId;
    socket.peerId = peerId;
    socket.join(meetingId);
    const peers = [];
    for (let [id, s] of io.sockets.sockets) {
      if (s.meetingId === meetingId && s.peerId && s.peerId !== peerId) peers.push(s.peerId);
    }
    socket.emit('existing-peers', peers);
    socket.to(meetingId).emit('new-peer', { peerId });
  });
  socket.on('reaction', ({ meetingId, emoji }) => {
    socket.to(meetingId).emit('reaction', { emoji });
  });
  socket.on('raise-hand', ({ meetingId, user }) => {
    io.to(meetingId).emit('raise-hand', { user });
  });
  socket.on('caption', ({ meetingId, user, text, trans }) => {
    socket.to(meetingId).emit('caption', { user, text, trans });
  });
  socket.on('chat-message', ({ meetingId, msg }) => {
    io.to(meetingId).emit('chat-message', { user: 'Friend', msg });
  });
  socket.on('disconnect', () => {
    if (socket.meetingId && rooms[socket.meetingId]) {
      rooms[socket.meetingId] = rooms[socket.meetingId].filter(id => id !== socket.id);
      io.to(socket.meetingId).emit('room-users', rooms[socket.meetingId].length);
    }
  });
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log('AR Connect PRO running on', PORT));
