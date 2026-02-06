const express = require('express');
const app = express();
const http = require("http");
const path = require('path');
const socketio = require("socket.io");

const server = http.createServer(app);

// ✅ CORS good for deployment + sockets
const io = socketio(server, {
    cors: {
        origin: "*"
    }
});

// ✅ View Engine
app.set("view engine", "ejs");

// ✅ Static Middleware
app.use(express.static(path.join(__dirname, "public")));

io.on("connection", function(socket) {
    console.log("New connection:", socket.id);

    socket.on("join-room", function(room) {
        socket.join(room);
        console.log(`User ${socket.id} joined room: ${room}`);
    });

    socket.on("send-location", function(data) {
        const { room, ...locationData } = data;
        if (room) {
            io.to(room).emit("receive-location", { id: socket.id, ...locationData });
        } else {
            io.emit("receive-location", { id: socket.id, ...locationData });
        }
    });

    socket.on("disconnect", function() {
        io.emit("user-disconnected", socket.id);
    });

});

app.get("/", function(req, res) {
    res.render("index");
});

// ✅ IMPORTANT FOR RENDER / CLOUD
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
