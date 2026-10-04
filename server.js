const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3001;

app.use(express.static(__dirname));

let rooms = {};

const friendSockets = new Map();


// 🔐 AR Connect Meeting Passwords - Persistent Storage
const meetingsFile = path.join(__dirname, "meetings.json");

let meetingPasswords = {
  TEST: "1234"
};

try {
  if (fs.existsSync(meetingsFile)) {
    const saved = JSON.parse(fs.readFileSync(meetingsFile, "utf8"));
    if (saved && typeof saved === "object") {
      meetingPasswords = { ...meetingPasswords, ...saved };
    }
  }
} catch (err) {
  console.error("⚠️ Could not load meetings.json:", err.message);
}

function saveMeetingPasswords() {
  try {
    fs.writeFileSync(
      meetingsFile,
      JSON.stringify(meetingPasswords, null, 2),
      "utf8"
    );
    console.log("💾 Meeting data saved");
  } catch (err) {
    console.error("❌ Could not save meetings:", err.message);
  }
}

// Existing AR Connect meeting
meetingPasswords["AR-A79A23AC"] = "0f0e86";
saveMeetingPasswords();

// 🚀 Create a new private AR Connect meeting
app.post("/api/create-meeting", express.json(), (req, res) => {
  const crypto = require("crypto");

  const meetingId =
    "AR-" +
    crypto.randomBytes(4).toString("hex").toUpperCase();

  const password =
    crypto.randomBytes(3).toString("hex");

  meetingPasswords[meetingId] = password;
  saveMeetingPasswords();

  console.log("🚀 Meeting created:", meetingId);

  res.json({
    success: true,
    meetingId,
    password
  });
});

app.post("/api/verify-meeting-password", express.json(), (req, res) => {
  const meetingId = String(req.body?.meetingId || "").trim();
  const password = String(req.body?.password || "");

  if (!meetingId) {
    return res.status(400).json({success:false,message:"Meeting ID required"});
  }

  const savedPassword = meetingPasswords[meetingId];

  if (!savedPassword) {
    return res.status(404).json({success:false,message:"Meeting not found"});
  }

  if (password !== savedPassword) {
    return res.status(401).json({success:false,message:"Wrong password"});
  }

  res.json({success:true});
});

io.on('connection', (socket) => {
  socket.on('join-room', (data) => {
    const meetingId = data.meetingId || data.roomId || 'main';
    const userId = data.userId || socket.id;

    if (!rooms[meetingId]) rooms[meetingId] = [];

    if (!rooms[meetingId].includes(socket.id)) {
      rooms[meetingId].push(socket.id);
    }

    socket.join(meetingId);

    socket.to(meetingId).emit('user-joined', userId);

    const existingUsers = rooms[meetingId]
      .filter(id => id !== socket.id);

    socket.emit('existing-users', existingUsers);

    io.to(meetingId).emit(
      'room-users',
      rooms[meetingId].length
    );

    console.log(
      `User ${socket.id} joined ${meetingId} | Total: ${rooms[meetingId].length}`
    );
  });

  socket.on('friend-request', (data) => {
    if (!data || !data.friendId) return;

    const friendId = String(data.friendId).trim();

    // Register this browser's Friend ID
    friendSockets.set(friendId, socket.id);
    socket.friendId = friendId;

    console.log('👤 Friend registered:', friendId, '->', socket.id);

    // Tell the requester that registration succeeded
    socket.emit('friend-ready', {
      friendId,
      socketId: socket.id
    });
  });

  socket.on('call-friend', (data) => {
    if (!data || !data.friendId) return;

    const targetSocketId = friendSockets.get(String(data.friendId).trim());

    if (!targetSocketId) {
      socket.emit('friend-error', {
        message: 'Friend is not online'
      });
      return;
    }

    console.log('📞 Friend call:', socket.id, '->', targetSocketId);

    io.to(targetSocketId).emit('incoming-friend-call', {
      from: socket.id,
      friendId: String(data.friendId).trim()
    });
  });

  socket.on('friend-call-accepted', (data) => {
  if (!data || !data.callerSocketId) return;

  const callerSocketId = String(data.callerSocketId).trim();

  console.log('✅ Friend call accepted:', socket.id, '->', callerSocketId);

  io.to(callerSocketId).emit('friend-call-accepted', {
    from: socket.id
  });
});

socket.on('register-peer', (data) => {
  const meetingId = data?.meetingId;
  const peerId = data?.peerId;

  if (!meetingId || !peerId) return;

  socket.data.meetingId = meetingId;
  socket.data.peerId = peerId;

  if (!rooms[meetingId]) rooms[meetingId] = [];

  // Make sure this socket is in the room
  if (!rooms[meetingId].includes(socket.id)) {
    rooms[meetingId].push(socket.id);
  }

  const peerIds = rooms[meetingId]
    .filter(id => id !== socket.id)
    .map(id => io.sockets.sockets.get(id)?.data?.peerId)
    .filter(Boolean);

  // Tell the newly registered participant about existing peers
  socket.emit('existing-peers', peerIds);

  // Tell existing participants about the new peer
  socket.to(meetingId).emit('new-peer', {
    peerId,
    socketId: socket.id
  });

  console.log(
    `📡 Peer registered ${peerId} in ${meetingId} | Existing peers: ${peerIds.length}`
  );
});

socket.on('signal', (data) => {
    if (!data || !data.to) return;

    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal
    });
  });

  socket.on('calculator-update', (data) => {
    if (!data || !data.meetingId) return;

    socket.to(data.meetingId).emit('calculator-update', {
      expression: String(data.expression || ''),
      result: data.result !== undefined ? String(data.result) : null,
      userId: socket.id
    });
  });

  socket.on('chat', (data) => {
    const meetingId =
      data?.meetingId ||
      data?.roomId ||
      [...socket.rooms].find(r => r !== socket.id);

    if (meetingId) {
      io.to(meetingId).emit('chat', data);
    }
  });

  socket.on('disconnect', () => {
    if (socket.friendId) {
      friendSockets.delete(socket.friendId);
      console.log('👤 Friend offline:', socket.friendId);
    }
    for (const roomId of Object.keys(rooms)) {
      if (!rooms[roomId]) continue;

      rooms[roomId] =
        rooms[roomId].filter(id => id !== socket.id);

      socket.to(roomId).emit('user-left', socket.id);

      io.to(roomId).emit(
        'room-users',
        rooms[roomId].length
      );

      if (rooms[roomId].length === 0) {
        delete rooms[roomId];
      }
    }

    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 AR Connect Server running on port ${PORT}`);
});
