const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.get('/', (req, res) => {
    res.send('Hello World!');
});

const port = process.env.PORT || 9609;
server.listen(port, () => {
    console.log(`Server is running on ${port}`);
});

// ==============================
// CHANNEL KEY HELPER
// ==============================
function channelKey(c) {
    if (!c) return "world";
    if (c.type === "world") return "world";
    if (c.type === "league") return `league:${c.leagueId}`;
    if (c.type === "club") return `club:${c.leagueId}:${c.clubId}`;
    if (c.type === "room") return `room:${c.leagueId}:${c.roomId}`;
    return "world";
}

// Store authenticated clients
// socket.id → { user_id, channel }
const clients = new Map();

// ==============================
// AUTH VALIDATOR
// ==============================
async function validateUser(user_id, csrf) {
    const resp = await fetch("https://hadihub.page.gd/fanplus/api/validate-csrf.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `user_id=${user_id}&csrf=${csrf}`
    });

    try {
        const d = await resp.json();
        console.log(d)
        return d.valid === true;
    } catch (e) {
        console.log(e)
        return false;
    }
}

// ==============================
// MAIN SOCKET.IO HANDLER
// ==============================
io.on("connection", (socket) => {
    let authed = false;

    // Handle raw-style "message"
    socket.on("message", async (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (_) {
            return;
        }

        // MUST AUTH FIRST
        if (!authed) {
            if (data.type !== "auth") return socket.disconnect(true);

            authed = true;

            clients.set(socket.id, {
                user_id: data.user_id,
                channel: { type: "world" }
            });

            socket.join("world");
            socket.send(JSON.stringify({ type: "auth_ok" }));
            return;
        }

        const client = clients.get(socket.id);
        if (!client) return;

        // ==========================
        // SUBSCRIBE TO CHANNEL
        // ==========================
        if (data.type === "subscribe") {
            const oldKey = channelKey(client.channel);
            socket.leave(oldKey);

            client.channel = data.channel;

            const newKey = channelKey(client.channel);
            socket.join(newKey);
            return;
        }

        // ==========================
        // CHAT MESSAGE
        // ==========================
        if (data.type === "chat_message") {
            const key = channelKey(client.channel);

            io.to(key).emit(
                "message",
                JSON.stringify({
                    type: "chat_message",
                    channel: client.channel,
                    message: {
                        user_id: client.user_id,
                        username: data.username,
                        nickname: data.nickname,
                        avatar: data.avatar,
                        message: data.message,
                        created_at: data.created_at
                    }
                })
            );
            return;
        }

        // ==========================
        // PROFILE UPDATE
        // ==========================
        if (data.type === "profile_update") {
            io.emit(
                "message",
                JSON.stringify({
                    type: "profile_update",
                    user_id: client.user_id,
                    username: data.username,
                    nickname: data.nickname,
                    avatar: data.avatar
                })
            );
            return;
        }

        // ==========================
        // ROOM CREATED
        // ==========================
        if (data.type === "room_created") {
            io.emit(
                "message",
                JSON.stringify({
                    type: "room_created",
                    room: data.room
                })
            );
            return;
        }

        // ==========================
        // ROOM DELETED
        // ==========================
        if (data.type === "room_deleted") {
            io.emit(
                "message",
                JSON.stringify({
                    type: "room_deleted",
                    room_id: data.room_id
                })
            );
            return;
        }

        // ==========================
        // ROOM UPDATE
        // ==========================
        if (data.type === "room_update") {
            io.emit(
                "message",
                JSON.stringify({
                    type: "room_update",
                    room: data.room
                })
            );
            return;
        }

        // ==========================
        // ROOM MEMBERS UPDATE
        // ==========================
        if (data.type === "room_members_update") {
            const roomKey = `room:${data.leagueId}:${data.roomId}`;

            io.to(roomKey).emit(
                "message",
                JSON.stringify({
                    type: "room_members_update",
                    members: data.members
                })
            );
            return;
        }
    });

    socket.on("disconnect", () => {
        clients.delete(socket.id);
    });
});

